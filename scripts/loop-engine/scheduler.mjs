// scheduler.mjs — 深模块⑥ Scheduler（loop-engine LE-2 · SPEC §2/§9）
//
// 角色：每 pass 顶算「拓扑前沿」(ready-set) + phase barrier 串行 + 环检测。
//
// SPEC §2 回路：
//   frontier = readySet(phase)               # blockers 全绿才入（拓扑前沿）
//   while frontier && 预算 ... :
//      pipeline(frontier 独立项 并行)          # 独立项并行·依赖项串行
//      frontier = readySet(phase)             # 新绿解锁 → 重算前沿
//   phase 全绿 → tag(barrier)；否则 park 余下 break
//
// SPEC §9：⑥ Scheduler 在 JS（控制面·确定性·agent 改不了）；每 pass 触发。
// SPEC §10 STATE_SCHEMA：issues:[{n, phase, blockers[], state}]。
//
// 本模块是**纯函数**（无 IO·无副作用），便于 node:test 断言（C008 可证伪：破坏即 fail）。
// 控制面禁触（SPEC §8）：调度逻辑在 agent 外，绝不读写 events.jsonl。

/** issue 终态：通过。blockers 全 GREEN 才解锁下游。 */
export const GREEN = 'green';
/** issue 被泊：需人决策/被阻塞，永不自动入 ready-set（SPEC §3 可逆性人线）。 */
export const PARKED = 'parked';

/**
 * 把 issues 数组建索引（n → issue），跳过缺合法整数 n 的脏项。
 * @param {Array<{n:number}>} issues
 * @returns {Map<number, object>}
 */
function indexByNum(issues) {
  const byNum = new Map();
  for (const it of issues) {
    if (it && Number.isInteger(it.n)) byNum.set(it.n, it);
  }
  return byNum;
}

/**
 * 某 issue 的全部 blockers 是否都已 GREEN。
 * 缺失引用的 blocker（不在 byNum）当作「未绿」→ 该 issue 不入前沿（宽松·不抛）；
 * 结构性缺失由 validateGraph 显式出账（不静默掩盖·C008）。
 * @param {object} it
 * @param {Map<number, object>} byNum
 * @returns {boolean}
 */
function blockersAllGreen(it, byNum) {
  const blockers = Array.isArray(it.blockers) ? it.blockers : [];
  return blockers.every((b) => {
    const dep = byNum.get(b);
    return dep != null && dep.state === GREEN;
  });
}

/**
 * 拓扑前沿（ready-set）：给定 phase，返回该 phase 内「blockers 全绿、自身未绿未泊」的 issue 号。
 *
 * - 独立项（无 blockers 或 blockers 全绿）→ 同时出现在前沿 = 可并行派发。
 * - 依赖项 → blocker 未绿则不入；blocker 转绿后下一次调用才入 = 串行。
 * - 跨 phase blocker：byNum 是全局索引，自然支持「前一 phase 的 issue 作 blocker」。
 *
 * @param {number|string} phase  目标 phase（与 issue.phase 全等比较）
 * @param {Array<{n:number, phase:any, blockers?:number[], state?:string}>} issues
 * @returns {number[]} 拓扑前沿 issue 号（保持 issues 原序）
 */
export function readySet(phase, issues) {
  if (phase === undefined || phase === null) {
    throw new TypeError('readySet: phase 必填（不可为 undefined/null）');
  }
  if (!Array.isArray(issues)) {
    throw new TypeError('readySet: issues 必须是数组');
  }
  const byNum = indexByNum(issues);
  const ready = [];
  for (const it of issues) {
    if (!it || it.phase !== phase) continue; // 只看本 phase
    if (it.state === GREEN) continue; // 已绿 → 不重复派发
    if (it.state === PARKED) continue; // 已泊 → 不自动入前沿
    if (blockersAllGreen(it, byNum)) ready.push(it.n);
  }
  return ready;
}

/**
 * Phase barrier：某 phase 是否「全绿」（→ 可进下一 phase）。
 *
 * SPEC §2：「phase 全绿 → tag agent(barrier)；否则 park 余下 break」。
 * 全绿 = phase 内全部 issue.state === GREEN（parked / pending 任一存在即未过）。
 * 空 phase（total=0）判定 passed=false：没有 issue 不构成「已完成的 phase」。
 *
 * @param {number|string} phase
 * @param {Array<{n:number, phase:any, state?:string}>} issues
 * @returns {{phase:any, total:number, green:number, parked:number, pending:number, passed:boolean}}
 */
export function phaseBarrier(phase, issues) {
  if (phase === undefined || phase === null) {
    throw new TypeError('phaseBarrier: phase 必填');
  }
  if (!Array.isArray(issues)) {
    throw new TypeError('phaseBarrier: issues 必须是数组');
  }
  const inPhase = issues.filter((it) => it && it.phase === phase);
  let green = 0;
  let parked = 0;
  let pending = 0;
  for (const it of inPhase) {
    if (it.state === GREEN) green++;
    else if (it.state === PARKED) parked++;
    else pending++;
  }
  const total = inPhase.length;
  const passed = total > 0 && green === total;
  return { phase, total, green, parked, pending, passed };
}

/**
 * 环检测（DFS 三色）：在 blocker 依赖图上找有向环。
 * 边方向：issue → 它的每个 blocker（「依赖」边）。环 = 死锁（互相 block，永不解锁）。
 * 缺失引用的 blocker 不计入环（由 validateGraph 单独出账）。
 *
 * @param {Array<{n:number, blockers?:number[]}>} issues
 * @returns {number[][]} 每个环一条路径（首尾闭合，如 [a, b, a]）
 */
export function detectCycles(issues) {
  if (!Array.isArray(issues)) {
    throw new TypeError('detectCycles: issues 必须是数组');
  }
  const byNum = indexByNum(issues);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const n of byNum.keys()) color.set(n, WHITE);
  const cycles = [];
  const stack = [];

  function dfs(n) {
    color.set(n, GRAY);
    stack.push(n);
    const it = byNum.get(n);
    const blockers = it && Array.isArray(it.blockers) ? it.blockers : [];
    for (const b of blockers) {
      if (!byNum.has(b)) continue; // 缺失引用 → validateGraph 负责
      const c = color.get(b);
      if (c === GRAY) {
        const idx = stack.indexOf(b);
        cycles.push(stack.slice(idx).concat(b)); // 闭合路径
      } else if (c === WHITE) {
        dfs(b);
      }
    }
    stack.pop();
    color.set(n, BLACK);
  }

  for (const n of byNum.keys()) {
    if (color.get(n) === WHITE) dfs(n);
  }
  return cycles;
}

/**
 * 图完整性校验（错误处理总闸）：重复 n / 缺合法 n / 自我阻塞 / 缺失 blocker 引用 / 环。
 * 纯函数·不抛（非数组例外）：收集所有错误一次性返回，便于 agent 一眼看全。
 *
 * @param {Array<{n:number, phase?:any, blockers?:number[]}>} issues
 * @returns {{ok:boolean, errors:object[], cycles:number[][]}}
 */
export function validateGraph(issues) {
  if (!Array.isArray(issues)) {
    return { ok: false, errors: [{ kind: 'type', message: 'issues 必须是数组' }], cycles: [] };
  }
  const errors = [];
  const byNum = new Map();
  for (const it of issues) {
    if (!it || !Number.isInteger(it.n)) {
      errors.push({ kind: 'shape', message: `issue 缺合法整数 n: ${JSON.stringify(it)}` });
      continue;
    }
    if (byNum.has(it.n)) {
      errors.push({ kind: 'duplicate', issue: it.n, message: `重复 issue 号 ${it.n}` });
    }
    byNum.set(it.n, it);
  }
  for (const it of issues) {
    if (!it || !Number.isInteger(it.n)) continue;
    const blockers = Array.isArray(it.blockers) ? it.blockers : [];
    for (const b of blockers) {
      if (b === it.n) {
        errors.push({ kind: 'self-ref', issue: it.n, message: `issue ${it.n} 自我阻塞` });
      }
      if (!byNum.has(b)) {
        errors.push({
          kind: 'missing-blocker',
          issue: it.n,
          blocker: b,
          message: `issue ${it.n} 的 blocker ${b} 不存在于 issues`,
        });
      }
    }
  }
  const cycles = detectCycles(issues);
  for (const cyc of cycles) {
    errors.push({ kind: 'cycle', cycle: cyc, message: `依赖环: ${cyc.join(' → ')}` });
  }
  return { ok: errors.length === 0, errors, cycles };
}

/**
 * phase 升序去重列表（驱动 §2 phase 间 barrier 串行的迭代序）。
 * 数字 phase 按数值排，非数字按字符串排（数字优先）。
 * @param {Array<{phase:any}>} issues
 * @returns {any[]}
 */
export function phasesInOrder(issues) {
  if (!Array.isArray(issues)) {
    throw new TypeError('phasesInOrder: issues 必须是数组');
  }
  const seen = new Set();
  const phases = [];
  for (const it of issues) {
    if (!it || it.phase === undefined || it.phase === null) continue;
    if (!seen.has(it.phase)) {
      seen.add(it.phase);
      phases.push(it.phase);
    }
  }
  return phases.sort((a, b) => {
    const an = typeof a === 'number';
    const bn = typeof b === 'number';
    if (an && bn) return a - b;
    if (an) return -1;
    if (bn) return 1;
    return String(a).localeCompare(String(b));
  });
}

// ── CLI 入口（按需读盘·被 import 时不触发）─────────────────────────────────
// 用法：node scheduler.mjs <issues.json 路径> [phase]
// issues.json = STATE_SCHEMA.issues 数组。打印 validateGraph + 指定/各 phase 的 ready-set。
// 退出码：0 = 图合法；1 = 图有错（重复/缺引用/环）。
async function main(argv) {
  const fs = await import('node:fs');
  const path = argv[2];
  if (!path) {
    console.error('用法: node scheduler.mjs <issues.json 路径> [phase]');
    return 2;
  }
  if (!fs.existsSync(path)) {
    console.error(`  ❌ ${path} 不存在`);
    return 2;
  }
  let issues;
  try {
    issues = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`  ❌ ${path} 不是合法 JSON: ${e.message}`);
    return 2;
  }
  const v = validateGraph(issues);
  if (!v.ok) {
    for (const err of v.errors) console.error(`  ❌ ${err.kind}: ${err.message}`);
    return 1;
  }
  console.log(`  ✅ 图合法（${Array.isArray(issues) ? issues.length : 0} issues·无环）`);

  const phaseArg = argv[3];
  if (phaseArg !== undefined) {
    const phase = /^-?\d+$/.test(phaseArg) ? Number(phaseArg) : phaseArg;
    const bar = phaseBarrier(phase, issues);
    console.log(
      `  phase ${phase}: ready=[${readySet(phase, issues).join(', ')}] · ` +
        `barrier ${bar.green}/${bar.total} 绿 (parked ${bar.parked}) → ${bar.passed ? '过' : '未过'}`
    );
  } else {
    for (const phase of phasesInOrder(issues)) {
      const bar = phaseBarrier(phase, issues);
      console.log(
        `  phase ${phase}: ready=[${readySet(phase, issues).join(', ')}] · ` +
          `barrier ${bar.green}/${bar.total} 绿 → ${bar.passed ? '过' : '未过'}`
      );
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}
