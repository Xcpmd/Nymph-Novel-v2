/**
 * AI 链路冒烟测试。
 *
 * 在本机起一个模拟的 OpenAI 兼容流式接口，临时注册成供应商，
 * 跑通一次完整生成，校验 SSE 事件里是否依次包含：
 * meta（模型标识）→ usage（输入侧用量）→ reasoning（思考内容）→ delta（正文）→ done。
 * 结束后删除临时供应商与临时小说，并把默认模型还原。
 *
 * 用法：node scripts/smoke-ai.mjs [baseUrl]
 */
import http from 'node:http';

const base = process.argv[2] ?? 'http://127.0.0.1:5461';
const PORT = 5477;
const NOVEL_TITLE = '__AI冒烟__';

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

/** 模拟模型：先吐思考内容，再吐固定 JSON 正文，最后补一个 usage 分片。 */
function startMockModel() {
  const payload = {
    title: '第1章 冒烟',
    summary: '用于验证流式解析',
    content: '雨下了一整夜。\n\n「这不是石头。」',
    tags: ['冒烟'],
    postprocess: [],
    nextOutline: '',
  };
  const full = JSON.stringify(payload);

  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      if (request.url?.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'mock-reasoner' }] }));
        return;
      }
      if (!request.url?.includes('/chat/completions')) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (chunk) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);

      // 思考内容分两片
      send({ choices: [{ delta: { reasoning_content: '先确定叙事视角。' } }] });
      send({ choices: [{ delta: { reasoning_content: '再把开场放在雨夜。' } }] });
      // 正文按 20 字符切片
      for (let index = 0; index < full.length; index += 20) {
        send({ choices: [{ delta: { content: full.slice(index, index + 20) } }] });
      }
      send({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 },
      });
      response.write('data: [DONE]\n\n');
      response.end();
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startMockModel();
  console.log(`模拟模型已启动：http://127.0.0.1:${PORT}/v1`);

  const before = await call('GET', '/api/providers');
  const originalDefault = before.providers.find((provider) => provider.isDefault)?.id ?? '';

  let providerId = '';
  let novelId = '';

  try {
    const created = await call('POST', '/api/providers', {
      action: 'save',
      name: '冒烟模型',
      baseUrl: `http://127.0.0.1:${PORT}/v1`,
      model: 'mock-reasoner',
      apiKey: 'sk-smoke',
      stream: true,
    });
    providerId = created.provider.id;
    await call('POST', '/api/providers', { action: 'setDefault', providerId });

    const novel = await call('POST', '/api/novels', { title: NOVEL_TITLE, genre: '冒烟' });
    novelId = novel.novel.id;
    const chapter = await call('POST', `/api/novels/${novelId}/chapters`, {
      indexNo: 1,
      volIndex: 1,
      title: '第1章',
    });

    console.log('\n[A] 流式事件顺序');
    const response = await fetch(`${base}/api/novels/${novelId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: chapter.chapter.ref, persist: true }),
    });
    const text = await response.text();
    const events = text
      .split('\n\n')
      .map((line) => line.split('\n').find((item) => item.startsWith('data:')))
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(5).trim()));

    const types = events.map((event) => event.type);
    check('返回 SSE 流', response.ok && events.length > 0, `status=${response.status}`);
    check('首个事件是 meta', types[0] === 'meta', types.slice(0, 3).join(','));
    check('包含 reasoning 事件', types.includes('reasoning'));
    check('包含 delta 事件', types.includes('delta'));
    check('以 done 收尾', types[types.length - 1] === 'done', types[types.length - 1]);

    const meta = events.find((event) => event.type === 'meta')?.meta;
    check('meta 带出模型标识', Boolean(meta?.model) && Boolean(meta?.icon), JSON.stringify(meta));
    check('识别为推理模型', meta?.reasoning === true);

    const reasoning = events
      .filter((event) => event.type === 'reasoning')
      .map((event) => event.text)
      .join('');
    check('思考内容完整送达', reasoning.includes('先确定叙事视角') && reasoning.includes('再把开场放在雨夜'), reasoning);

    const content = events
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    check('正文增量可拼接', content.includes('雨下了一整夜'), content.slice(0, 40));

    const usages = events.filter((event) => event.type === 'usage').map((event) => event.usage);
    check('过程中多次汇报用量', usages.length >= 2, `${usages.length} 次`);
    check('首帧给出输入侧用量', (usages[0]?.promptTokens ?? 0) > 0);

    const final = events[events.length - 1]?.usage;
    check('结束帧使用接口返回的真实用量', final?.totalTokens === 1801, JSON.stringify(final));
    check('真实用量标记为非估算', final?.estimated === false);

    console.log('\n[B] 落盘结果');
    const detail = await call('GET', `/api/novels/${novelId}/chapters/${encodeURIComponent('1:1')}`);
    check('正文已写入章节', detail.chapter.content.includes('这不是石头'));
    check('状态标记为草稿', detail.chapter.status === 'draft');
    check('标题由返回结果更新', detail.chapter.title === '冒烟' || detail.chapter.title === '第1章 冒烟', detail.chapter.title);

    const usage = await call('GET', `/api/novels/${novelId}/usage`);
    check('用量已记账', usage.summary.calls === 1 && usage.summary.totalTokens === 1801, JSON.stringify(usage.summary.totalTokens));
  } finally {
    if (novelId) await call('DELETE', `/api/novels/${novelId}`).catch(() => undefined);
    if (providerId) await call('DELETE', `/api/providers?id=${providerId}`).catch(() => undefined);
    if (originalDefault) {
      await call('POST', '/api/providers', { action: 'setDefault', providerId: originalDefault }).catch(
        () => undefined,
      );
    }
    server.close();
    console.log('\n已清理临时供应商与临时小说');
  }

  console.log(failures === 0 ? '\nAI 链路冒烟全部通过。' : `\nAI 链路冒烟有 ${failures} 项未通过。`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`AI 链路冒烟异常：${error.message}`);
  process.exit(1);
});
