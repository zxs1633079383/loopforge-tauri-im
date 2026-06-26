// render-board 泳道台账板 fixture 快照测试 —— 纯 Node 22，零依赖。
// 运行：node test/orchestration/render-board.test.mjs
//
// 可证伪铁律（C008 / HX-C011）：每个「绿」断言都配一个「破坏即红」对偶——
// 故意改坏 fixture（把某行从 BOUND_GREEN 抽走 / 清空 log）→ 断言泳道输出随之变化，
// 证明脚本真在读 log 算状态，而非吐死字符串。不靠墙钟、不靠 sleep；纯结构/计数证不变量。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'render-board.sh');

let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.error(`  ✗ ${name}`); }
}

// 在临时目录铺一组 fixture 三 log，返回目录路径。
function mkFixture(ready, green, need) {
  const dir = mkdtempSync(join(tmpdir(), 'lf-board-'));
  const hdr = (w) => `# 单写者 append-only · 列: <ts>\\t<apply_name>\\t<writer>\\t<note> · 写者=${w}\n`;
  writeFileSync(join(dir, 'HELIX_READY.log'),
    hdr('B') + ready.map((n) => `2026-06-26T10:00:00Z\t${n}\tB\tre-pin merged`).join('\n') + (ready.length ? '\n' : ''));
  writeFileSync(join(dir, 'BOUND_GREEN.log'),
    hdr('A2') + green.map((n) => `2026-06-26T11:00:00Z\t${n}\tA2\treducer green`).join('\n') + (green.length ? '\n' : ''));
  writeFileSync(join(dir, 'NEED_HELIX.log'),
    hdr('A2') + need.map((n) => `2026-06-26T10:30:00Z\t${n}\tA2\tneed render-ready`).join('\n') + (need.length ? '\n' : ''));
  return dir;
}

function run(dir) {
  return execFileSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
}

// ── 1. 空 log → PENDING 19 / 🟦0 / 🟨0 / 🟩0 ──────────────────────────────
{
  const dir = mkFixture([], [], []);
  const out = run(dir);
  check('空 log 汇总行 = PENDING 19 / 🟦0 / 🟨0 / 🟩0',
    out.includes('PENDING 19 / 🟦0 / 🟨0 / 🟩0'));
  check('空 log 每行皆 ⬛ PENDING（19 行）',
    (out.match(/⬛/g) || []).length === 19);
  check('空 log 无 🟩 行', !out.includes('🟩 apply'));
  rmSync(dir, { recursive: true, force: true });
}

// ── 2. 已 HELIX_READY/已 BOUND_GREEN 几行 → 泳道分布正确 ────────────────────
{
  const ready = ['applyMessageItem', 'applyMembersSnapshot', 'applyDialogList', 'applyOlderLoaded', 'applyMemberUpdated'];
  const green = ['applyMessageItem', 'applyDialogList'];
  const dir = mkFixture(ready, green, []);
  const out = run(dir);

  // 5 ready, 2 of them green → PENDING 14 / 🟦5(累计解锁) / 🟨3(可绑) / 🟩2(绿)
  check('汇总行 = PENDING 14 / 🟦5 / 🟨3 / 🟩2',
    out.includes('PENDING 14 / 🟦5 / 🟨3 / 🟩2'));
  // 行级：green 行标 🟩
  check('applyMessageItem 行标 🟩 BOUND_GREEN',
    /🟩 applyMessageItem\b.*BOUND_GREEN/.test(out));
  check('applyDialogList 行标 🟩 BOUND_GREEN',
    /🟩 applyDialogList\b.*BOUND_GREEN/.test(out));
  // 行级：ready-not-green 行标 🟨 BINDABLE
  check('applyMembersSnapshot 行标 🟨 BINDABLE',
    /🟨 applyMembersSnapshot\b.*BINDABLE/.test(out));
  check('applyOlderLoaded 行标 🟨 BINDABLE',
    /🟨 applyOlderLoaded\b.*BINDABLE/.test(out));
  // 行级：未解锁行标 ⬛ PENDING
  check('applyChannelClosed 行标 ⬛ PENDING',
    /⬛ applyChannelClosed\b.*PENDING/.test(out));
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. 可证伪对偶：抽掉一行 green → 汇总必随之变化（证明非死字符串）─────────
{
  const ready = ['applyMessageItem', 'applyMembersSnapshot', 'applyDialogList', 'applyOlderLoaded', 'applyMemberUpdated'];
  const dirA = mkFixture(ready, ['applyMessageItem', 'applyDialogList'], []);
  const dirB = mkFixture(ready, ['applyMessageItem'], []); // 抽掉 applyDialogList 的绿
  const outA = run(dirA);
  const outB = run(dirB);
  check('破坏即变：抽掉一行 green 后 🟩 计数 2→1',
    outA.includes('🟩2') && outB.includes('🟩1'));
  check('破坏即变：抽掉一行 green 后该行从 🟩 退回 🟨',
    /🟩 applyDialogList/.test(outA) && /🟨 applyDialogList/.test(outB));
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
}

// ── 4. 注释行/空行不计入（健壮性）──────────────────────────────────────────
{
  const dir = mkFixture(['applyMessageItem'], [], []);
  const out = run(dir);
  check('注释/空行不污染计数（1 ready → 🟦1 🟨1）',
    out.includes('PENDING 18 / 🟦1 / 🟨1 / 🟩0'));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nrender-board fixture 快照: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) { console.error('失败用例: ' + fails.join('; ')); process.exit(1); }
