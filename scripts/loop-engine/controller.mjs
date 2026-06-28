// controller.mjs — loop-engine 深模块:Controller / 安全阀(LE-3 · SPEC §8)
//
// 六个安全阀 = 纯决策函数(over state → trip 决策),零 IO、零副作用、零随机,
// 因此每个阀的边界值都能被 node:test 钉死(C008 可证伪:破坏阈值即 fail)。
//
// 控制面禁触(SPEC §8):本模块只**判断**是否跳闸,绝不就地改 gate.sh / 冻结契约 /
// 六不变量 / 标签策略 / 增益包络。熔断决策在 agent 之外(controller 是脚本不是 agent 自律)。
//
// | 阀 | 触发 | 动作 |
// |---|---|---|
// | budgetGuard      | remaining < 15%        | stop(落盘 + 写 STATUS,不丢状态) |
// | failureCap       | 单 issue 连败 ≥ 3      | park(跳下一个 issue,防卡死整夜) |
// | regenQuarantine  | 同 sig 第 3 次复燃     | quarantine → ready-for-human    |
// | settled          | 连 2 pass 无新绿无新 gap | converge(不动点,别空转)      |
// | antiThrash       | 同 UC 一 pass 已碰 ≥1   | block(防 X↔Y 来回改)          |
// | flakyGate        | 红 → 先重试 1 次再判    | retry / gap(抖动不污染 ledger)  |

/** 安全阀阈值(冻结)。改阈值 = 改控制策略,须显式传参或改这里(单一真源)。 */
export const THRESHOLDS = Object.freeze({
  BUDGET_RESERVE: 0.15, // remaining < 15% → stop
  FAILURE_CAP: 3, // 单 issue 连败 ≥ 3 → park
  REGEN_QUARANTINE: 3, // 同 sig 第 3 次复燃 → quarantine
  SETTLED_PASSES: 2, // 连 2 pass 无进展 → converge
  THRASH_MAX_TOUCH: 1, // 同 UC 一 pass 内最多碰 1 次
  FLAKY_RETRIES: 1, // 红 → 重试 1 次再判
});

const VALID_VERDICTS = Object.freeze(['red', 'green']);

// ── 输入校验(系统边界 fail-fast;不信外部数据)──────────────────────────────
function assertFraction(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new TypeError(`${name} 必须是有限数(fraction 0..1),收到 ${typeof x}:${x}`);
  }
  if (x < 0 || x > 1) {
    throw new RangeError(`${name} 必须在 [0,1] 区间(fraction,非百分数),收到 ${x}`);
  }
}

function assertNonNegInt(x, name) {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 0) {
    throw new TypeError(`${name} 必须是非负整数,收到 ${typeof x}:${x}`);
  }
}

function assertPosInt(x, name) {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 1) {
    throw new TypeError(`${name} 必须是正整数(≥1),收到 ${typeof x}:${x}`);
  }
}

const pct = (f) => `${(f * 100).toFixed(1)}%`;

// ── ① budgetGuard:预算储备熔断 ───────────────────────────────────────────
/**
 * remaining < threshold → stop。边界:remaining === threshold 不跳闸(保留余量恰好到线视为安全)。
 * @param {number} remaining 剩余预算 fraction(0..1)
 * @param {number} [threshold=0.15]
 * @returns {{valve:'budgetGuard', trip:boolean, action:'stop'|'continue', remaining:number, threshold:number, reason:string}}
 */
export function budgetGuard(remaining, threshold = THRESHOLDS.BUDGET_RESERVE) {
  assertFraction(remaining, 'remaining');
  assertFraction(threshold, 'threshold');
  const trip = remaining < threshold;
  return {
    valve: 'budgetGuard',
    trip,
    action: trip ? 'stop' : 'continue',
    remaining,
    threshold,
    reason: trip
      ? `预算储备 ${pct(remaining)} < ${pct(threshold)} → 停(落盘 + 写 STATUS)`
      : `预算储备 ${pct(remaining)} ≥ ${pct(threshold)} → 继续`,
  };
}

// ── ② failureCap:单 issue 连败熔断 ──────────────────────────────────────
/**
 * consecutiveFailures ≥ cap → park。边界:cap-1 不跳闸,cap 跳闸。
 * @param {number} consecutiveFailures 该 issue 当前连续失败次数
 * @param {number} [cap=3]
 * @returns {{valve:'failureCap', trip:boolean, action:'park'|'continue', consecutiveFailures:number, cap:number, reason:string}}
 */
export function failureCap(consecutiveFailures, cap = THRESHOLDS.FAILURE_CAP) {
  assertNonNegInt(consecutiveFailures, 'consecutiveFailures');
  assertPosInt(cap, 'cap');
  const trip = consecutiveFailures >= cap;
  return {
    valve: 'failureCap',
    trip,
    action: trip ? 'park' : 'continue',
    consecutiveFailures,
    cap,
    reason: trip
      ? `连败 ${consecutiveFailures} ≥ ${cap} → park(跳下一个 issue)`
      : `连败 ${consecutiveFailures} < ${cap} → 继续重试`,
  };
}

// ── ③ regenQuarantine:再生隔离 ──────────────────────────────────────────
/**
 * 同一 sig 第 threshold 次复燃 → quarantine(转 ready-for-human)。
 * regenCount = 该 sig 已复燃次数;边界:threshold-1 不跳闸,threshold 跳闸。
 * @param {number} regenCount 同 sig 复燃次数
 * @param {number} [threshold=3]
 * @returns {{valve:'regenQuarantine', trip:boolean, action:'quarantine'|'continue', regenCount:number, threshold:number, reason:string}}
 */
export function regenQuarantine(regenCount, threshold = THRESHOLDS.REGEN_QUARANTINE) {
  assertNonNegInt(regenCount, 'regenCount');
  assertPosInt(threshold, 'threshold');
  const trip = regenCount >= threshold;
  return {
    valve: 'regenQuarantine',
    trip,
    action: trip ? 'quarantine' : 'continue',
    regenCount,
    threshold,
    reason: trip
      ? `同 sig 第 ${regenCount} 次复燃 ≥ ${threshold} → quarantine(转 ready-for-human)`
      : `同 sig 复燃 ${regenCount} < ${threshold} → 继续修`,
  };
}

// ── ④ settled:整定 / 收敛(不动点)─────────────────────────────────────────
/**
 * 连续 `need` 个 pass 都「无新绿且无新 gap」→ converge(停,不空转)。
 * 历史不足 `need` 个 → 不跳闸(还没攒够判定窗口)。
 * @param {{newGreen:number, newGap:number}[]} passes 按时间序的每 pass 进展(末尾最新)
 * @param {number} [need=2]
 * @returns {{valve:'settled', trip:boolean, action:'converge'|'continue', need:number, considered:number, reason:string}}
 */
export function settled(passes, need = THRESHOLDS.SETTLED_PASSES) {
  if (!Array.isArray(passes)) {
    throw new TypeError(`passes 必须是数组,收到 ${typeof passes}`);
  }
  assertPosInt(need, 'need');
  for (let i = 0; i < passes.length; i++) {
    const p = passes[i];
    if (!p || typeof p !== 'object') {
      throw new TypeError(`passes[${i}] 必须是 {newGreen,newGap} 对象`);
    }
    assertNonNegInt(p.newGreen, `passes[${i}].newGreen`);
    assertNonNegInt(p.newGap, `passes[${i}].newGap`);
  }

  if (passes.length < need) {
    return {
      valve: 'settled',
      trip: false,
      action: 'continue',
      need,
      considered: passes.length,
      reason: `历史仅 ${passes.length} 个 pass < ${need} → 判定窗口未满,继续`,
    };
  }

  const tail = passes.slice(-need);
  const trip = tail.every((p) => p.newGreen === 0 && p.newGap === 0);
  return {
    valve: 'settled',
    trip,
    action: trip ? 'converge' : 'continue',
    need,
    considered: need,
    reason: trip
      ? `连 ${need} pass 无新绿且无新 gap → converge(不动点)`
      : `近 ${need} pass 仍有进展(新绿/新 gap)→ 继续`,
  };
}

// ── ⑤ antiThrash:防震荡(同 UC 一 pass 内 cooldown)─────────────────────────
/**
 * 同一 (pass, uc) 在本 pass 内已被碰过 ≥ maxTouch 次 → block(防 X↔Y 来回改)。
 * touchLog 形如 { 'pass::uc': count };读 key=`${pass}::${uc}`。纯函数:不改 touchLog。
 * @param {{uc:string|number, pass:number, touchLog?:Record<string,number>}} input
 * @param {number} [maxTouch=1]
 * @returns {{valve:'antiThrash', trip:boolean, action:'block'|'allow', uc:any, pass:number, key:string, timesTouched:number, maxTouch:number, reason:string}}
 */
export function antiThrash({ uc, pass, touchLog = {} } = {}, maxTouch = THRESHOLDS.THRASH_MAX_TOUCH) {
  if (uc === undefined || uc === null || uc === '') {
    throw new TypeError('uc 不能为空');
  }
  assertNonNegInt(pass, 'pass');
  if (touchLog === null || typeof touchLog !== 'object' || Array.isArray(touchLog)) {
    throw new TypeError('touchLog 必须是 {key:count} 对象');
  }
  assertPosInt(maxTouch, 'maxTouch');

  const key = `${pass}::${uc}`;
  const timesTouched = touchLog[key] ?? 0;
  assertNonNegInt(timesTouched, `touchLog['${key}']`);
  const trip = timesTouched >= maxTouch;
  return {
    valve: 'antiThrash',
    trip,
    action: trip ? 'block' : 'allow',
    uc,
    pass,
    key,
    timesTouched,
    maxTouch,
    reason: trip
      ? `UC ${uc} 在 pass ${pass} 已碰 ${timesTouched} 次 ≥ ${maxTouch} → block(防震荡)`
      : `UC ${uc} 在 pass ${pass} 碰 ${timesTouched} 次 < ${maxTouch} → allow`,
  };
}

// ── ⑥ flakyGate:flaky 去抖(红 → 重试 1 次再判)─────────────────────────────
/**
 * 原始测试 verdict 经 flaky 闸:
 *   green                       → accept(直接采信绿)
 *   red 且 retriesDone < max    → retry(抖动嫌疑,先重试)
 *   red 且 retriesDone ≥ max    → gap(重试仍红 = 真 gap,可 emit)
 * trip=true 仅在确认为 gap 时(抖动不污染 ledger)。
 * @param {'red'|'green'} verdict 原始测试结果
 * @param {number} [retriesDone=0] 已重试次数
 * @param {number} [maxRetries=1]
 * @returns {{valve:'flakyGate', trip:boolean, action:'accept'|'retry'|'gap', retry:boolean, verdict:string, retriesDone:number, maxRetries:number, reason:string}}
 */
export function flakyGate(verdict, retriesDone = 0, maxRetries = THRESHOLDS.FLAKY_RETRIES) {
  if (!VALID_VERDICTS.includes(verdict)) {
    throw new TypeError(`verdict 必须 ∈ {${VALID_VERDICTS.join(',')}},收到 ${verdict}`);
  }
  assertNonNegInt(retriesDone, 'retriesDone');
  assertNonNegInt(maxRetries, 'maxRetries');

  if (verdict === 'green') {
    return {
      valve: 'flakyGate',
      trip: false,
      action: 'accept',
      retry: false,
      verdict,
      retriesDone,
      maxRetries,
      reason: '绿 → accept(采信)',
    };
  }
  // verdict === 'red'
  if (retriesDone < maxRetries) {
    return {
      valve: 'flakyGate',
      trip: false,
      action: 'retry',
      retry: true,
      verdict,
      retriesDone,
      maxRetries,
      reason: `红 + 已重试 ${retriesDone} < ${maxRetries} → retry(抖动嫌疑,先重试)`,
    };
  }
  return {
    valve: 'flakyGate',
    trip: true,
    action: 'gap',
    retry: false,
    verdict,
    retriesDone,
    maxRetries,
    reason: `红 + 已重试 ${retriesDone} ≥ ${maxRetries} → gap(重试仍红 = 真 gap)`,
  };
}

// ── 组合:loop 级守卫(SPEC §8 while 条件)──────────────────────────────────
/**
 * loop 续跑守卫:对应 SPEC 「while frontier && budget>15% && noProgress<2」。
 * 优先级:预算(全局停)> 收敛(不动点)。返回首个跳闸的决策,否则 continue。
 * @param {{remaining:number, passes?:{newGreen:number,newGap:number}[]}} state
 * @returns {{valve:string, trip:boolean, action:string, governing:string, reason:string}}
 */
export function loopGuard(state = {}) {
  const { remaining, passes = [] } = state;
  const budget = budgetGuard(remaining);
  if (budget.trip) return { ...budget, governing: 'budgetGuard' };
  const conv = settled(passes);
  if (conv.trip) return { ...conv, governing: 'settled' };
  return {
    valve: 'loopGuard',
    trip: false,
    action: 'continue',
    governing: 'none',
    reason: '预算充足且未收敛 → 继续 loop',
  };
}

// ── 组合:issue 级守卫 ─────────────────────────────────────────────────────
/**
 * 单 issue 处理守卫:连败 cap(park)优先于再生隔离(quarantine)。
 * @param {{consecutiveFailures?:number, regenCount?:number}} state
 * @returns {{valve:string, trip:boolean, action:string, governing:string, reason:string}}
 */
export function issueGuard(state = {}) {
  const { consecutiveFailures = 0, regenCount = 0 } = state;
  const cap = failureCap(consecutiveFailures);
  if (cap.trip) return { ...cap, governing: 'failureCap' };
  const quar = regenQuarantine(regenCount);
  if (quar.trip) return { ...quar, governing: 'regenQuarantine' };
  return {
    valve: 'issueGuard',
    trip: false,
    action: 'continue',
    governing: 'none',
    reason: '未达连败上限且无 3 次复燃 → 继续处理本 issue',
  };
}
