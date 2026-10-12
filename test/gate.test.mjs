/**
 * dsh-subagent-model-config — 视频队员名闸门（assertVideoNamed）独立单测
 *
 * 测的是「执行模型必须人工点名可控」这条硬要求的执行点：队员名带视频前缀
 * 却未命中任何规则 ⇒ 抛错、不启动，绝不静默继承默认模型。
 *
 * 说明：断言「拒绝」的用例会往插件目录的 .probe.jsonl 追加一行取证
 * （spawn-rejected-unrouted-video），这是闸门的既有行为，不是副作用泄漏。
 * 本文件不依赖 cordis、不依赖运行时，可直接 `node --test` 复现。
 *
 * 点名式前缀**从 config.json 动态取**——规则表是唯一事实源，增删规则不必改测试
 * （写死清单曾与规则表脱节，导致本套件在现行配置下必红）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertVideoNamed, videoNameHint, UNROUTED_VIDEO_CODE } from '../lib/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(HERE, '..', 'config.json'), 'utf8'));

/** 点名式前缀（去通配尾星）：直接来自 config.json 的 video- 规则。 */
const NAMED = (CONFIG.rules ?? [])
  .map((rule) => (typeof rule?.match === 'string' ? rule.match.trim() : ''))
  .filter((match) => /^video[-_]/i.test(match))
  .map((match) => match.replace(/\*+$/, ''));

/** 捕获同步抛错的辅助。 */
function catchError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe('闸门 — 点名式视频队员名一律放行', () => {
  it('规则表至少有一条 video- 通配（前置断言）', () => {
    assert.ok(NAMED.length > 0, 'config.json 里应至少有一条 video- 前缀规则');
  });

  for (const prefix of NAMED) {
    it(`${prefix}-1 放行`, () => {
      assert.doesNotThrow(() => assertVideoNamed(`${prefix}-1`, CONFIG));
      assert.doesNotThrow(() => assertVideoNamed(prefix, CONFIG));
    });
  }

  it('非视频队员名不受影响（含未命中任何规则的普通名字）', () => {
    for (const name of ['verifier', 'verifier-1', 'test-crew', 'reviewer-a', 'no-match-name', 'plan-x']) {
      assert.doesNotThrow(() => assertVideoNamed(name, CONFIG), name);
    }
  });

  it('取不到队员名（非编队路径）一律放行', () => {
    for (const name of [undefined, null, '', 42, {}, []]) {
      assert.doesNotThrow(() => assertVideoNamed(name, CONFIG), JSON.stringify(name));
    }
  });

  it('大小写不敏感：前缀大写后仍按同一规则命中', () => {
    const prefix = NAMED[0];
    const upper = `V${prefix.slice(1)}`;
    assert.doesNotThrow(() => assertVideoNamed(`${upper}-1`, CONFIG));
    const error = catchError(() => assertVideoNamed('Video-Unknown-Off-1', CONFIG));
    assert.ok(error, '大写前缀的野名字同样必须被拦下');
  });
});

describe('闸门 — 视频前缀但未命中规则 ⇒ 抛错拒绝启动', () => {
  const WILD = ['video-x', 'video-doubao-x', 'video-flash-1', 'video-fact-a', 'video-pro-1', 'video_typo', 'video-'];

  for (const name of WILD) {
    it(`${name} 被拒绝`, () => {
      const error = catchError(() => assertVideoNamed(name, CONFIG));
      assert.ok(error, `${name} 应当抛错`);
      assert.equal(error.code, UNROUTED_VIDEO_CODE);
      assert.match(error.message, /拒绝启动视频队员/);
      assert.ok(error.message.includes(name), '报错必须点名是哪个队员名');
    });
  }

  it('报错给出的合法名字清单＝当前规则表的 video- 前缀（不写死）', () => {
    const error = catchError(() => assertVideoNamed('video-zzz-unrouted-1', CONFIG));
    assert.ok(error);
    for (const prefix of NAMED) {
      assert.ok(error.message.includes(`${prefix}-<序号>`), `报错清单应含 ${prefix}-<序号>`);
    }
    assert.equal(videoNameHint(CONFIG).includes('<序号>'), true);
  });

  it('规则表为空 ⇒ 任何视频前缀名字都被拒绝', () => {
    const empty = { enabled: true, debug: false, rules: [] };
    for (const prefix of NAMED) {
      assert.equal(catchError(() => assertVideoNamed(`${prefix}-1`, empty))?.code, UNROUTED_VIDEO_CODE, prefix);
    }
  });

  it('显式配了兜底规则时放行（闸门只解决「无规则命中」，不判断规则好坏）', () => {
    const withFallback = { enabled: true, debug: false, rules: [{ match: 'video-*', model: 'm' }] };
    assert.doesNotThrow(() => assertVideoNamed('video-anything-1', withFallback));
  });
});

describe('闸门 — 关闭开关与降级语义', () => {
  it('enabled:false ⇒ 闸门整体关闭（与未装插件的语义一致）', () => {
    const off = { enabled: false, debug: false, rules: [] };
    assert.doesNotThrow(() => assertVideoNamed('video-x', off));
    assert.doesNotThrow(() => assertVideoNamed('video-unknown-1', off));
  });

  it('config 读不出来（null / 非对象 / 空规则）⇒ 视频名一律拒绝：fail-closed', () => {
    for (const config of [null, undefined, 'x', 42, true, {}]) {
      const error = catchError(() => assertVideoNamed('video-x', config));
      assert.equal(error?.code, UNROUTED_VIDEO_CODE, JSON.stringify(config));
    }
  });

  it('命中规则但规则没有路由字段（待指定模型）⇒ 闸门视为已点名，放行', () => {
    const pending = { enabled: true, debug: false, rules: [{ match: `${NAMED[0]}*` }] };
    assert.doesNotThrow(() => assertVideoNamed(`${NAMED[0]}-1`, pending));
  });

  it('videoNameHint：空规则表给出可行动提示，而非空串', () => {
    assert.equal(videoNameHint({ rules: [] }).includes('没有 video- 前缀规则'), true);
    assert.equal(videoNameHint(null).includes('没有 video- 前缀规则'), true);
  });
});
