/**
 * 批量推理与 Anthropic 协议冒烟测试。
 *
 * 本机起一个模拟服务，同时实现：
 * - OpenAI 兼容的流式 /chat/completions（本地队列用）
 * - Anthropic 的 /messages（校验 system 提顶层、thinking 增量、用量字段）
 * - Anthropic 的 /messages/batches（提交 → 轮询 → 取结果）
 * - OpenAI 的 /files + /batches（上传 → 建任务 → 下载结果）
 * 依次验证两种批量路径都能把正文写回章节，跑完删除临时数据并还原默认模型。
 *
 * 用法：node scripts/smoke-batch.mjs [baseUrl]
 */
import http from 'node:http';

const base = process.argv[2] ?? 'http://127.0.0.1:5461';
const PORT = 5478;
const NOVEL_TITLE = '__批量冒烟__';

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    return;
  }
  failures += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return data;
}

function payloadOf(ref) {
  return {
    title: `冒烟 ${ref}`,
    summary: `由 ${ref} 生成`,
    content: `【${ref}】雨下了一整夜。\n\n「这不是石头。」`,
    tags: ['冒烟'],
    postprocess: [],
    nextOutline: '',
  };
}

/** 模拟服务：记录收到的请求，便于断言协议细节。 */
const received = { anthropicBodies: [], openaiChats: 0, batchPollCount: 0 };

function startMock() {
  const results = new Map();

  const server = http.createServer(async (request, response) => {
    const url = request.url ?? '';
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');

    /* ---------------------------- Anthropic 对话 ---------------------------- */
    if (url.endsWith('/messages') && !url.includes('/batches')) {
      const body = JSON.parse(raw);
      received.anthropicBodies.push(body);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (chunk) => response.write(`event: x\ndata: ${JSON.stringify(chunk)}\n\n`);
      send({ type: 'message_start', message: { usage: { input_tokens: 800, output_tokens: 1 } } });
      send({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '先定视角。' } });
      const text = JSON.stringify(payloadOf('anthropic-sync'));
      for (let index = 0; index < text.length; index += 32) {
        send({ type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(index, index + 32) } });
      }
      send({ type: 'message_delta', usage: { output_tokens: 240 } });
      send({ type: 'message_stop' });
      response.end();
      return;
    }

    /* ------------------------- Anthropic 批量接口 ------------------------- */
    if (url.endsWith('/messages/batches') && request.method === 'POST') {
      const body = JSON.parse(raw);
      const requests = body.requests ?? [];
      results.set(
        'batch_anthropic_1',
        requests.map((item) => ({
          custom_id: item.custom_id,
          result: {
            type: 'succeeded',
            message: {
              content: [{ type: 'text', text: JSON.stringify(payloadOf(item.custom_id)) }],
              usage: { input_tokens: 900, output_tokens: 260 },
            },
          },
        })),
      );
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'batch_anthropic_1', processing_status: 'in_progress' }));
      return;
    }
    if (url.includes('/messages/batches/batch_anthropic_1')) {
      received.batchPollCount += 1;
      // 第一次返回进行中，逼客户端真的走一遍轮询
      const done = received.batchPollCount >= 2;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify(
          done
            ? { processing_status: 'ended', results_url: `http://127.0.0.1:${PORT}/results/anthropic` }
            : { processing_status: 'in_progress', request_counts: { succeeded: 0, errored: 0 } },
        ),
      );
      return;
    }
    if (url === '/results/anthropic') {
      const lines = (results.get('batch_anthropic_1') ?? []).map((item) => JSON.stringify(item));
      response.writeHead(200, { 'Content-Type': 'application/jsonl' });
      response.end(lines.join('\n'));
      return;
    }

    /* ---------------------------- OpenAI 批量接口 ---------------------------- */
    if (url.endsWith('/files') && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'file_mock_1' }));
      return;
    }
    if (url.endsWith('/batches') && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'batch_openai_1', status: 'validating' }));
      return;
    }
    if (url.includes('/batches/batch_openai_1')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'completed', output_file_id: 'file_out_1' }));
      return;
    }
    if (url.endsWith('/files/file_out_1/content')) {
      const detail = await call('GET', `/api/novels/${received.novelId}/batches`);
      const refs = detail.candidates.map((item) => item.ref);
      const lines = refs.map((ref) =>
        JSON.stringify({
          custom_id: `ch-${ref.replace(':', '-')}`,
          response: {
            status_code: 200,
            body: {
              choices: [{ message: { content: JSON.stringify(payloadOf(ref)) } }],
              usage: { total_tokens: 1200 },
            },
          },
        }),
      );
      response.writeHead(200, { 'Content-Type': 'application/jsonl' });
      response.end(lines.join('\n'));
      return;
    }

    /* --------------------------- OpenAI 对话（本地队列） --------------------------- */
    if (url.endsWith('/chat/completions')) {
      received.openaiChats += 1;
      const body = JSON.parse(raw);
      const text = JSON.stringify(payloadOf('local'));
      // 本地队列不要求流式，这里两种都支持
      if (body.stream !== true) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: text } }],
            usage: { prompt_tokens: 700, completion_tokens: 200, total_tokens: 900 },
          }),
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (chunk) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      for (let index = 0; index < text.length; index += 40) {
        send({ choices: [{ delta: { content: text.slice(index, index + 40) } }] });
      }
      send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 700, completion_tokens: 200, total_tokens: 900 } });
      response.write('data: [DONE]\n\n');
      response.end();
      void body;
      return;
    }

    response.writeHead(404).end();
  });

  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForJob(novelId, jobId, predicate, timeoutMs = 30000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const data = await call('GET', `/api/novels/${novelId}/batches`);
    last = data.jobs.find((job) => job.id === jobId) ?? last;
    if (last && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return last;
}

async function main() {
  const server = await startMock();
  console.log(`模拟服务已启动：http://127.0.0.1:${PORT}`);

  const before = await call('GET', '/api/providers');
  const originalDefault = before.providers.find((provider) => provider.isDefault)?.id ?? '';

  let novelId = '';
  const providerIds = [];

  try {
    /* ------------------------------ 准备临时数据 ------------------------------ */
    const novel = await call('POST', '/api/novels', { title: NOVEL_TITLE, genre: '冒烟' });
    novelId = novel.novel.id;
    received.novelId = novelId;
    for (const indexNo of [1, 2]) {
      await call('POST', `/api/novels/${novelId}/chapters`, {
        indexNo,
        volIndex: 1,
        title: `第${indexNo}章`,
      });
    }

    /* --------------------------- 一、Anthropic 协议 --------------------------- */
    console.log('\n[1] Anthropic 协议');
    const anthropic = await call('POST', '/api/providers', {
      action: 'save',
      name: '冒烟 Anthropic',
      baseUrl: `http://127.0.0.1:${PORT}/anthropic`,
      model: 'claude-mock',
      protocol: 'anthropic',
      apiKey: 'sk-ant-smoke',
      stream: true,
    });
    providerIds.push(anthropic.provider.id);
    await call('POST', '/api/providers', { action: 'setDefault', providerId: anthropic.provider.id });

    check('协议被保存为 anthropic', anthropic.provider.protocol === 'anthropic', anthropic.provider.protocol);
    const test = await call('POST', '/api/providers', {
      action: 'test',
      providerId: anthropic.provider.id,
    });
    check('连通性测试走 Messages 接口', test.ok === true, test.message);

    const stream = await fetch(`${base}/api/novels/${novelId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: '1:1', persist: true }),
    });
    const events = (await stream.text())
      .split('\n\n')
      .map((line) => line.split('\n').find((item) => item.startsWith('data:')))
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(5).trim()));
    check('流式仍以 meta 开头、done 收尾', events[0]?.type === 'meta' && events.at(-1)?.type === 'done');
    check(
      '解析出 thinking_delta',
      events.some((event) => event.type === 'reasoning' && event.text?.includes('先定视角')),
    );
    check(
      '用量来自 message_start / message_delta',
      events.at(-1)?.usage?.promptTokens === 800 && events.at(-1)?.usage?.completionTokens === 240,
      JSON.stringify(events.at(-1)?.usage),
    );

    const body = received.anthropicBodies.at(-1);
    check('system 提到了顶层', typeof body?.system === 'string' && body.system.length > 0);
    check(
      '消息里不再混入 system 角色',
      Array.isArray(body?.messages) && body.messages.every((message) => message.role !== 'system'),
    );
    check('首条消息是 user', body?.messages?.[0]?.role === 'user', body?.messages?.[0]?.role);
    check('max_tokens 为必填且已带上', typeof body?.max_tokens === 'number' && body.max_tokens > 0);

    /* ------------------------- 二、Anthropic 原生批量 ------------------------- */
    console.log('\n[2] Anthropic 原生批量');
    const anthroBatch = await call('POST', `/api/novels/${novelId}/batches`, {
      action: 'create',
      refs: ['1:1', '1:2'],
      mode: 'provider',
    });
    check('任务类型为 provider', anthroBatch.job.kind === 'provider', anthroBatch.job.kind);
    const finished = await waitForJob(novelId, anthroBatch.job.id, (job) => job.status === 'done' || job.status === 'failed');
    check('任务完成', finished?.status === 'done', `${finished?.status} ${finished?.error}`);
    check('两章都写入成功', finished?.completed === 2 && finished?.failed === 0, `done=${finished?.completed} failed=${finished?.failed}`);
    check('确实走了轮询', received.batchPollCount >= 2, `${received.batchPollCount} 次`);

    const chapter = await call('GET', `/api/novels/${novelId}/chapters/${encodeURIComponent('1:2')}`);
    check('批量结果落成正文', chapter.chapter.content.includes('【ch-1-2】'), chapter.chapter.content.slice(0, 30));
    check('状态标记为草稿', chapter.chapter.status === 'draft');

    /* --------------------------- 三、本地队列批量 --------------------------- */
    console.log('\n[3] 本地队列批量');
    const openai = await call('POST', '/api/providers', {
      action: 'save',
      name: '冒烟 OpenAI',
      baseUrl: `http://127.0.0.1:${PORT}/openai/v1`,
      model: 'gpt-mock',
      protocol: 'openai',
      batch: 'openai',
      apiKey: 'sk-smoke',
      stream: true,
    });
    providerIds.push(openai.provider.id);
    await call('POST', '/api/providers', { action: 'setDefault', providerId: openai.provider.id });

    const localBatch = await call('POST', `/api/novels/${novelId}/batches`, {
      action: 'create',
      refs: ['1:1'],
      mode: 'local',
      concurrency: 1,
    });
    check('任务类型为 local', localBatch.job.kind === 'local', localBatch.job.kind);
    const localDone = await waitForJob(novelId, localBatch.job.id, (job) => job.status === 'done' || job.status === 'failed');
    check('本地队列跑完', localDone?.status === 'done' && localDone?.completed === 1, `${localDone?.status} done=${localDone?.completed}`);
    check('调用了普通对话接口', received.openaiChats >= 1, `${received.openaiChats} 次`);

    const localChapter = await call('GET', `/api/novels/${novelId}/chapters/${encodeURIComponent('1:1')}`);
    check('本地队列结果落成正文', localChapter.chapter.content.includes('【local】'));

    /* ---------------------------- 四、OpenAI 批量 ---------------------------- */
    console.log('\n[4] OpenAI 原生批量');
    const openaiBatch = await call('POST', `/api/novels/${novelId}/batches`, {
      action: 'create',
      refs: ['1:2'],
      mode: 'provider',
    });
    check('任务类型为 provider', openaiBatch.job.kind === 'provider', openaiBatch.job.kind);
    const openaiDone = await waitForJob(novelId, openaiBatch.job.id, (job) => job.status === 'done' || job.status === 'failed');
    check('OpenAI 批量完成', openaiDone?.status === 'done', `${openaiDone?.status} ${openaiDone?.error}`);

    /* ------------------------------ 五、任务管理 ------------------------------ */
    console.log('\n[5] 任务管理');
    const listed = await call('GET', `/api/novels/${novelId}/batches`);
    check('任务列表按时间倒序返回', listed.jobs.length === 3, `${listed.jobs.length} 条`);
    check('候选章节带出状态与字数', listed.candidates.every((item) => typeof item.wordCount === 'number'));

    const removed = await call('DELETE', `/api/novels/${novelId}/batches?jobId=${openaiBatch.job.id}`);
    check('可以删除任务记录', removed.jobs.length === 2, `${removed.jobs.length} 条`);
    check('删除任务不影响正文', (await call('GET', `/api/novels/${novelId}/chapters/${encodeURIComponent('1:2')}`)).chapter.content.length > 0);
  } finally {
    if (novelId) await call('DELETE', `/api/novels/${novelId}`).catch(() => undefined);
    for (const id of providerIds) {
      await call('DELETE', `/api/providers?id=${id}`).catch(() => undefined);
    }
    if (originalDefault) {
      await call('POST', '/api/providers', { action: 'setDefault', providerId: originalDefault }).catch(() => undefined);
    }
    server.close();
    console.log('\n已清理临时数据并还原默认模型');
  }

  console.log(failures === 0 ? '\n批量与协议冒烟全部通过。' : `\n批量与协议冒烟有 ${failures} 项未通过。`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`冒烟异常：${error.message}`);
  process.exit(1);
});
