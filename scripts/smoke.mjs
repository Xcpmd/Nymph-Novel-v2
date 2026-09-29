/**
 * 端到端冒烟测试。
 *
 * 在运行中的服务上新建一部临时小说，跑通章节排序、大纲拆分与「上一章全文」注入，
 * 校验正文文件、标签、书签、大纲是否一起跟着搬家，结束后删除这部临时小说，
 * 不影响已有的作品。
 *
 * 用法：node scripts/smoke.mjs [baseUrl]
 */
const base = process.argv[2] ?? 'http://localhost:5400';
const NOVEL_TITLE = '__冒烟测试__';

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

const ref = (ref) => encodeURIComponent(ref);

async function main() {
  // 清理上次残留
  const existing = await call('GET', '/api/novels');
  for (const novel of existing.novels.filter((item) => item.title === NOVEL_TITLE)) {
    await call('DELETE', `/api/novels/${novel.id}`);
  }

  const { novel } = await call('POST', '/api/novels', { title: NOVEL_TITLE, genre: '冒烟' });
  const id = novel.id;
  console.log(`临时小说：${id}`);

  try {
    /* ------------------------------ 准备数据 ------------------------------ */
    const seeds = [
      { title: '第1章 甲', content: '第一章的正文。\n\n「甲。」' },
      { title: '第2章 乙', content: '第二章的正文。\n\n「乙。」' },
      { title: '第3章 丙', content: '第三章的正文。\n\n「丙。」' },
    ];
    for (const [index, seed] of seeds.entries()) {
      const created = await call('POST', `/api/novels/${id}/chapters`, {
        indexNo: index + 1,
        volIndex: 1,
        title: seed.title,
      });
      await call('PATCH', `/api/novels/${id}/chapters/${ref(created.chapter.ref)}`, {
        content: seed.content,
        status: 'done',
      });
    }
    await call('POST', `/api/novels/${id}/data`, {
      resource: 'tags',
      action: 'assign',
      ref: '1:1',
      tag: '甲章标签',
    });
    await call('PATCH', `/api/novels/${id}/chapters/${ref('1:3')}`, {
      action: 'toggleBookmark',
      bookmarkNote: '丙的书签',
    });

    /* --------------------------- 一、章节手动排序 --------------------------- */
    console.log('\n[1] 章节手动排序');
    const before = await call('GET', `/api/novels/${id}/chapters`);
    check('初始顺序为 1,2,3', before.chapters.map((item) => item.indexNo).join(',') === '1,2,3');

    // 把第 3 章拖到最前面
    await call('POST', `/api/novels/${id}/chapters`, {
      action: 'reorder',
      order: [
        { ref: '1:3', volIndex: 1 },
        { ref: '1:1', volIndex: 1 },
        { ref: '1:2', volIndex: 1 },
      ],
    });

    const after = await call('GET', `/api/novels/${id}/chapters`);
    const titles = after.chapters.map((item) => item.title);
    check('顺序变为 丙,甲,乙', titles.join(',') === '第1章 丙,第2章 甲,第3章 乙', titles.join(','));

    const first = await call('GET', `/api/novels/${id}/chapters/${ref('1:1')}`);
    check('正文跟着章节走（新第 1 章是丙的内容）', first.chapter.content.includes('第三章的正文'), first.chapter.content.slice(0, 40));

    const tagMoved = await call('GET', `/api/novels/${id}/search?q=`);
    const tag = tagMoved.tags.find((item) => item.name === '甲章标签');
    check('标签跟着章节走（甲章标签落在 1:2）', tag?.refs.join(',') === '1:2', tag?.refs.join(','));

    const bookmarkMoved = tagMoved.bookmarks[0];
    check('书签跟着章节走（丙的书签落在 1:1）', bookmarkMoved?.ref === '1:1', bookmarkMoved?.ref);

    /* ---------------------------- 二、大纲拆分 ---------------------------- */
    console.log('\n[2] 大纲拆分为章节');
    await call('POST', `/api/novels/${id}/outline`, {
      action: 'save',
      text: [
        '第1章 丙：雨夜的开端',
        '第2章 甲：第一次对话',
        '第3章 乙：矿井塌方',
        '第4章 丁：新的伏笔',
        '第5章 戊：收束',
      ].join('\n'),
    });

    const split = await call('POST', `/api/novels/${id}/outline`, {
      action: 'split',
      indexes: [4, 5],
    });
    check('只拆分勾选的两行', split.created === 2, `created=${split.created}`);

    const chaptersAfterSplit = await call('GET', `/api/novels/${id}/chapters`);
    check(
      '新增章节标题来自大纲',
      chaptersAfterSplit.chapters.some((item) => item.title === '第4章 丁') &&
        chaptersAfterSplit.chapters.some((item) => item.title === '第5章 戊'),
      chaptersAfterSplit.chapters.map((item) => item.title).join(','),
    );
    check(
      '已有章节的标题也被对齐',
      chaptersAfterSplit.chapters.find((item) => item.indexNo === 3)?.title === '第3章 乙',
      chaptersAfterSplit.chapters.find((item) => item.indexNo === 3)?.title,
    );
    /* --------------------- 三、上一章全文作为可勾选规则 --------------------- */
    console.log('\n[3] 上一章全文注入');
    const rules = await call('GET', `/api/novels/${id}/rules`);
    const binding = [...rules.checklist.system, ...rules.checklist.user, ...rules.checklist.assistant].find(
      (item) => item.title === '上一章全文',
    );
    check('规则清单里出现「上一章全文」', Boolean(binding));
    check('默认不勾选，避免上下文膨胀', binding?.enabled === false);

    const contextOff = await call('GET', `/api/novels/${id}/context?ref=${ref('1:2')}`);
    check(
      '未勾选时不注入上一章全文',
      !contextOff.preview.segments.some((segment) => segment.text.includes('### 第一章')),
      contextOff.preview.segments.map((segment) => segment.key).join(','),
    );

    await call('POST', `/api/novels/${id}/rules`, {
      action: 'bindings',
      updates: [{ id: binding.id, category: 'system', sortOrder: 99, enabled: true }],
    });
    const rulesOn = await call('GET', `/api/novels/${id}/rules`);
    const enabled = [...rulesOn.checklist.system, ...rulesOn.checklist.user, ...rulesOn.checklist.assistant].find(
      (item) => item.title === '上一章全文',
    );
    check('勾选状态被保存', enabled?.enabled === true);

    const contextOn = await call('GET', `/api/novels/${id}/context?ref=${ref('1:2')}`);
    const previousSegment = contextOn.preview.segments.find((segment) => segment.key === 'base-previous-chapter');
    check(
      '勾选后注入上一章全文',
      Boolean(previousSegment) && previousSegment.text.includes('第三章的正文'),
      previousSegment?.text.slice(0, 80),
    );

    check(
      '勾选后上下文 token 明显增加',
      contextOn.preview.totalTokens > contextOff.preview.totalTokens,
      `${contextOff.preview.totalTokens} → ${contextOn.preview.totalTokens}`,
    );
  } finally {
    await call('DELETE', `/api/novels/${id}`);
    console.log('\n已清理临时小说');
  }

  console.log(failures === 0 ? '\n冒烟测试全部通过。' : `\n冒烟测试有 ${failures} 项未通过。`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`冒烟测试异常：${error.message}`);
  process.exit(1);
});
