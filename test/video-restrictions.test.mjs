/**
 * 视频预设下的队员侧限制 —— 判定与白名单契约用例。
 *
 * 为什么这些用例必须存在：
 *   · 判定错 → 要么队员没被限制（fail-open），要么其它模式的子代理被误伤；
 *   · 白名单错 → tools.restrict() 抛 "unknown global tool" 直接让队员起不来。
 * 两条都是「派单当场失败」级别的事故，故用用例钉死。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { videoTeammateRestrictions, VIDEO_PRESET_ID } from '../lib/index.js';

/** 造一个假父 Agent：composedPreset 返回给定 preset。 */
const fakeParent = (preset) => ({
  ctx: {
    get: (key) => (key === 'agentPresets' ? { composedPreset: () => preset } : undefined),
  },
});

test('非 video 预设一律不注入（保护其它模式）', () => {
  assert.equal(videoTeammateRestrictions(undefined), null);
  assert.equal(videoTeammateRestrictions({}), null);
  assert.equal(videoTeammateRestrictions(fakeParent('standard')), null);
  assert.equal(videoTeammateRestrictions(fakeParent('cordis')), null);
  assert.equal(videoTeammateRestrictions(fakeParent('minimal')), null);
  assert.equal(videoTeammateRestrictions(fakeParent(null)), null);
});

test('video 预设注入 persona 遮蔽 + allow 白名单（无 deny，fail-closed）', () => {
  const r = videoTeammateRestrictions(fakeParent(VIDEO_PRESET_ID));
  assert.ok(r, 'video 预设应产出限制对象');
  assert.match(r.persona, /视频事实提取员/);
  assert.match(r.persona, /不得自建目录/);
  assert.ok(Array.isArray(r.toolFilter.allow) && r.toolFilter.allow.length > 0);
  assert.equal(r.toolFilter.deny, undefined, 'allow 形态不应同时给 deny');
});

test('白名单不含 own 层团队工具（否则 restrict 报 unknown global tool）', () => {
  const allow = videoTeammateRestrictions(fakeParent('video')).toolFilter.allow;
  const ownLayerTools = [
    'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'spawn_teammate',
    'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ];
  for (const name of ownLayerTools) {
    assert.ok(!allow.includes(name), `${name} 注册在成员 own 层：天然保留且不可列入`);
  }
});

test('白名单覆盖视频解析必需工具', () => {
  const allow = videoTeammateRestrictions(fakeParent('video')).toolFilter.allow;
  for (const name of ['watch_video', 'read', 'write', 'edit', 'glob', 'grep', 'pwsh', 'job_list', 'job_output', 'job_kill', 'skill', 'todo_write']) {
    assert.ok(allow.includes(name), `白名单缺 ${name}`);
  }
});

test('白名单不含联网 / 记忆 / 派单 / 装配类工具', () => {
  const allow = videoTeammateRestrictions(fakeParent('video')).toolFilter.allow;
  const banned = [
    'doubao_search', 'web_search', 'web_fetch', 'overseas_drama_radar',
    'mcp__zai-search__web_search_prime', 'mcp__zai-reader__webReader', 'mcp__zread__read_file',
    'mcp__openviking__search', 'mcp__openviking__remember',
    'subagent', 'subagent_fork', 'workflow', 'plugin_manager', 'present', 'ask_user_question',
  ];
  for (const name of banned) {
    assert.ok(!allow.includes(name), `不应放行 ${name}`);
  }
});

test('preset 读取异常时安全降级为不注入（不阻断派单）', () => {
  const throwing = { ctx: { get: () => { throw new Error('without inject'); } } };
  assert.equal(videoTeammateRestrictions(throwing), null);
  assert.equal(videoTeammateRestrictions({ ctx: { get: () => ({}) } }), null);
  assert.equal(videoTeammateRestrictions({ ctx: {} }), null);
});
