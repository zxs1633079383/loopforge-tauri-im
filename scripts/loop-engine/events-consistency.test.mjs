// events-consistency.test.mjs — node:test 真断言（C008 可证伪：破坏即 fail）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents, collectGapEmits, checkConsistency } from './events-consistency.mjs';

test('parseEvents 跳过空行并解析合法 JSONL', () => {
  const text = '{"type":"a"}\n\n   \n{"type":"b"}\n';
  const { events, errors } = parseEvents(text);
  assert.equal(events.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(events[0].type, 'a');
  assert.equal(events[1].type, 'b');
});

test('parseEvents 把坏 JSON 收集到 errors（不静默吞）', () => {
  const text = '{"type":"ok"}\n{not json}\n';
  const { events, errors } = parseEvents(text);
  assert.equal(events.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
});

test('collectGapEmits 只挑 gap_emit', () => {
  const events = [
    { type: 'issue_green', issue: 10 },
    { type: 'gap_emit', sig: 'a1b2', issue: 52, kind: 'ui-design' },
    { type: 'gap_emit', sig: 'c3d4', issue: 53, kind: 'logic' },
    { type: 'metrics', pass: 1 },
  ];
  const gaps = collectGapEmits(events);
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps[0], { sig: 'a1b2', issue: 52, kind: 'ui-design' });
});

test('空 events 文本 → ok（尚无 run）', () => {
  const r = checkConsistency({ eventsText: '', openIssues: [1, 2] });
  assert.equal(r.ok, true);
  assert.equal(r.gapCount, 0);
  assert.equal(r.dangling.length, 0);
});

test('全部 gap issue 仍 open → ok=true', () => {
  const eventsText =
    '{"type":"gap_emit","sig":"a1b2","issue":52,"kind":"ui-design"}\n' +
    '{"type":"gap_emit","sig":"c3d4","issue":53,"kind":"logic"}\n';
  const r = checkConsistency({ eventsText, openIssues: [52, 53, 99] });
  assert.equal(r.ok, true);
  assert.equal(r.gapCount, 2);
  assert.equal(r.crossChecked, true);
  assert.equal(r.dangling.length, 0);
});

test('gap issue 已关闭 → 悬挂 → ok=false 且列出该 issue', () => {
  const eventsText =
    '{"type":"gap_emit","sig":"a1b2","issue":52,"kind":"ui-design"}\n' +
    '{"type":"gap_emit","sig":"c3d4","issue":53,"kind":"logic"}\n';
  const r = checkConsistency({ eventsText, openIssues: [52] }); // 53 已关
  assert.equal(r.ok, false);
  assert.equal(r.dangling.length, 1);
  assert.deepEqual(r.dangling[0], { sig: 'c3d4', issue: 53 });
});

test('gap_emit 缺 issue 号 → 结构错 → ok=false', () => {
  const eventsText = '{"type":"gap_emit","sig":"a1b2","kind":"ui-design"}\n';
  const r = checkConsistency({ eventsText, openIssues: [52] });
  assert.equal(r.ok, false);
  assert.equal(r.structural.length, 1);
  assert.match(r.structural[0].reason, /缺合法 issue/);
});

test('gap_emit 缺 sig → 结构错 → ok=false', () => {
  const eventsText = '{"type":"gap_emit","issue":52,"kind":"logic"}\n';
  const r = checkConsistency({ eventsText, openIssues: [52] });
  assert.equal(r.ok, false);
  assert.equal(r.structural.length, 1);
  assert.match(r.structural[0].reason, /缺 sig/);
});

test('openIssues=null → 跳过交叉校验（离线降级），仅结构 OK 即 ok=true', () => {
  const eventsText = '{"type":"gap_emit","sig":"a1b2","issue":52,"kind":"logic"}\n';
  const r = checkConsistency({ eventsText, openIssues: null });
  assert.equal(r.crossChecked, false);
  assert.equal(r.ok, true);
  assert.equal(r.dangling.length, 0);
});

test('openIssues=null 但结构错仍要 fail（降级不掩盖结构错）', () => {
  const eventsText = '{"type":"gap_emit","sig":"a1b2","kind":"logic"}\n';
  const r = checkConsistency({ eventsText, openIssues: null });
  assert.equal(r.crossChecked, false);
  assert.equal(r.ok, false);
  assert.equal(r.structural.length, 1);
});

test('坏 JSON 行 → ok=false（解析错不放过）', () => {
  const eventsText = '{"type":"gap_emit","sig":"a","issue":1}\n{broken}\n';
  const r = checkConsistency({ eventsText, openIssues: [1] });
  assert.equal(r.ok, false);
  assert.equal(r.parseErrors.length, 1);
});
