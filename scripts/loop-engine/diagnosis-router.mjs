// diagnosis-router.mjs — 诊断与修复路由（loop-engine LE-4 / SPEC §4）
//
// 深模块·表驱动：reducer「断在哪一跳」+ 三端日志 grep 特征 → 定位哪一仓 → 给出
// {faultRepo, reversible, action, gapKind}。这是引擎 s3「classify + 三端日志诊断」
// 的确定性核心，纯函数（无 IO），便于 node:test 断言（C008 可证伪：破坏即 fail）。
//
// 真源 SPEC §4 路由表：
//   | reducer/信号           | 日志特征            | 判定                    | 动作                | 可逆 |
//   | ①出站 红               | body 缺字段          | wire 构造缺陷(C013→helix) | helix 分支修+re-pin | ✅   |
//   | ②投影/③DOM/④落库 红    | helix tracing 投影缺 | helix 投影/业务缺陷       | helix 分支修+re-pin | ✅   |
//   | ③DOM 红·投影有该字段   | DOM 缺 data-*        | 壳绑定缺(C013 壳职责)     | loopforge 修绑定/pencil | ✅ |
//   | health 000/出站全 000  | 无 listening         | 后端未起/挂              | 重启 cses-im-server | ✅(仅重启) |
//   | 四面 diff·≥2 UC 佐证   | 契约≠真源           | 契约可能过时             | 契约变更提案 park    | ⚠️park |
//   | 单次红·重跑绿          | 时序抖动            | flaky                   | 重试 1 次不开 gap    | —    |
//
//   helix 边界：分支修 + loopforge re-pin = 可逆 → 自决；合 helix main = 发布给
//   cses-client（其他消费者）= 不可逆 → park。cses-im-server 永远只重启不改逻辑。
//
// 控制面禁触（SPEC §8）：本模块只裁定路由，绝不改契约/六不变量/gate.sh。

// ── 枚举常量（导出供调用方与测试共用，避免裸字符串漂移）──────────────────

/** 四面（reducer「断在哪一跳」的 facet）。 */
export const FACET = Object.freeze({
  OUTBOUND: 'outbound', // ① 出站命令体
  PROJECTION: 'projection', // ② 投影 envelope
  DOM: 'dom', // ③ DOM data-*
  STORAGE: 'storage', // ④ DB 落库行
});

const KNOWN_FACETS = new Set(Object.values(FACET));

/** 责任仓。null = 无需改仓（green/flaky/契约 park）。 */
export const REPO = Object.freeze({
  HELIX: 'helix',
  LOOPFORGE: 'loopforge',
  CSES: 'cses-im-server',
});

/** 裁定结论。 */
export const VERDICT = Object.freeze({
  GREEN: 'green',
  FLAKY: 'flaky',
  FIX: 'fix', // 自决可逆修复
  PARK: 'park', // 不可逆 → 交人
});

/** 动作。 */
export const ACTION = Object.freeze({
  NONE: 'none',
  RETRY_ONCE: 'retry-once-no-gap',
  RESTART_BACKEND: 'restart-cses-im-server',
  HELIX_BRANCH_FIX: 'helix-branch-fix-repin',
  FIX_BINDING: 'loopforge-fix-binding',
  PENCIL_DESIGN: 'pencil-design-region',
  PARK_CONTRACT: 'park-contract-proposal',
  PARK_HELIX_MAIN: 'park-helix-main-merge',
});

/** gap 种类。 */
export const GAP_KIND = Object.freeze({
  FLAKY: 'flaky',
  BACKEND_DOWN: 'backend-down',
  WIRE_BUILD: 'wire-build', // 出站 body 构造缺陷
  PROJECTION_BUSINESS: 'projection-business', // helix 投影/业务缺陷
  UI_BINDING: 'ui-binding', // 壳缺 data-* 绑定
  UI_DESIGN: 'ui-design', // 缺语义区 → pencil 设计
  CONTRACT_STALE: 'contract-stale',
  HELIX_MAIN_MERGE: 'helix-main-merge',
});

/** 契约过时 park 的最小佐证 UC 数（SPEC §4：≥2 UC 佐证）。 */
export const CONTRACT_STALE_MIN_UCS = 2;

// ── 内部判定器 ───────────────────────────────────────────────────────────

/** 后端是否挂：health 000 或（出站全 000 且日志无 listening）。 */
function isBackendDown(f) {
  const healthDown = f.health === 0 || f.health === '000' || f.health === '0';
  const outboundDeadNoListen = f.outboundAllZero === true && f.backendListening === false;
  return healthDown || outboundDeadNoListen;
}

/** 契约可能过时：后端默认对 + ≥2 UC 佐证同一面差异。 */
function isContractStale(f) {
  return f.backendDefaultCorrect === true && Number(f.corroboratingUCs) >= CONTRACT_STALE_MIN_UCS;
}

function result({ verdict, faultRepo = null, reversible = null, action, gapKind = null, reason }) {
  return { verdict, faultRepo, reversible, action, gapKind, reason };
}

// ── 主路由（深模块单一入口）──────────────────────────────────────────────

/**
 * 诊断路由：reducer 裁决 + 三端日志特征 → {faultRepo, reversible, action, gapKind}。
 *
 * 优先级（高 → 低，越靠前越「根因/越能抑制误开 gap」）：
 *   1. flaky（重跑转绿）→ 不开 gap，抑制一切下游
 *   2. backend down（infra 根因）→ 仅重启 cses-im-server
 *   3. green（无破面）→ 无动作
 *   4. contract stale（后端默认对 + ≥2 UC 佐证）→ park 契约提案
 *   5. DOM 红 + 投影有该字段 → loopforge 壳绑定（缺语义区则 pencil）
 *   6. 任一面红 → helix 分支修 + re-pin（需合 main 则 park）
 *
 * @param {{brokenFacet: string|null}} reducerVerdict
 *   reducer「断在哪一跳」。brokenFacet=null 表示四面全绿。
 * @param {object} [logFeatures] 三端日志 grep 出的结构化特征。
 * @param {boolean} [logFeatures.rerunGreen]            第一次红、重跑绿 → flaky
 * @param {number|string} [logFeatures.health]          health 探针码；0/'000' = 挂
 * @param {boolean} [logFeatures.outboundAllZero]       出站全 000
 * @param {boolean} [logFeatures.backendListening]      cses-im-server.log 是否有 listening
 * @param {boolean} [logFeatures.projectionHasField]    DOM 缺的字段，投影里是否已有
 * @param {boolean} [logFeatures.domRegionExists]       DOM 语义区是否存在（false → 缺区 → pencil）
 * @param {number}  [logFeatures.corroboratingUCs]      佐证此面差异的 UC 数
 * @param {boolean} [logFeatures.backendDefaultCorrect] 后端默认对（契约 diff 时）
 * @param {boolean} [logFeatures.requiresHelixMainMerge] 修复需合 helix main（对外发布 = 不可逆）
 * @returns {{verdict:string, faultRepo:string|null, reversible:boolean|null, action:string, gapKind:string|null, reason:string}}
 */
export function route(reducerVerdict, logFeatures = {}) {
  if (reducerVerdict == null || typeof reducerVerdict !== 'object') {
    throw new TypeError('route: reducerVerdict 必须是 {brokenFacet} 对象');
  }
  const f = logFeatures || {};
  const brokenFacet = reducerVerdict.brokenFacet ?? null;

  // 校验 facet 合法性（null=全绿；其余必须在已知集合内）—— C008 不静默吞坏输入。
  if (brokenFacet !== null && !KNOWN_FACETS.has(brokenFacet)) {
    throw new RangeError(`route: 未知 brokenFacet=${JSON.stringify(brokenFacet)}`);
  }

  // 1. flaky：重跑转绿 → 抖动，不开 gap（抑制下游一切动作）
  if (f.rerunGreen === true) {
    return result({
      verdict: VERDICT.FLAKY,
      action: ACTION.RETRY_ONCE,
      gapKind: GAP_KIND.FLAKY,
      reason: '单次红·重跑绿 → 时序抖动，重试 1 次再判，不开 gap',
    });
  }

  // 2. backend down：infra 根因，先于一切 facet 路由（否则全面红误判为 helix）
  if (isBackendDown(f)) {
    return result({
      verdict: VERDICT.FIX,
      faultRepo: REPO.CSES,
      reversible: true, // 仅重启可逆；绝不改其 Go 逻辑
      action: ACTION.RESTART_BACKEND,
      gapKind: GAP_KIND.BACKEND_DOWN,
      reason: 'health 000 / 出站全 000 且无 listening → 后端未起/挂，仅重启不改逻辑',
    });
  }

  // 3. green：无破面
  if (brokenFacet === null) {
    return result({
      verdict: VERDICT.GREEN,
      action: ACTION.NONE,
      reason: '四面全绿，无需路由',
    });
  }

  // 4. 契约过时 park：后端默认对 + ≥2 UC 佐证 → 不可逆，park 契约提案（契约只读 C004）
  if (isContractStale(f)) {
    return result({
      verdict: VERDICT.PARK,
      faultRepo: null, // 契约非某一仓的代码缺陷
      reversible: false,
      action: ACTION.PARK_CONTRACT,
      gapKind: GAP_KIND.CONTRACT_STALE,
      reason: `四面 diff·后端默认对·≥${CONTRACT_STALE_MIN_UCS} UC 佐证 → 契约可能过时，提案交人审`,
    });
  }

  // 5. ③DOM 红但投影有该字段 → 壳绑定缺（C013 壳职责），loopforge 修
  if (brokenFacet === FACET.DOM && f.projectionHasField === true) {
    if (f.domRegionExists === false) {
      // 缺语义区 → pencil 设计回流（SPEC §6）
      return result({
        verdict: VERDICT.FIX,
        faultRepo: REPO.LOOPFORGE,
        reversible: true,
        action: ACTION.PENCIL_DESIGN,
        gapKind: GAP_KIND.UI_DESIGN,
        reason: 'DOM 缺 data-* 且无语义区 → pencil 设计缺失区域后绑定（§6）',
      });
    }
    return result({
      verdict: VERDICT.FIX,
      faultRepo: REPO.LOOPFORGE,
      reversible: true,
      action: ACTION.FIX_BINDING,
      gapKind: GAP_KIND.UI_BINDING,
      reason: 'DOM 缺 data-* 但投影已有该字段 → 壳绑定缺，loopforge 修绑定',
    });
  }

  // 6. 任一面红（含 ①出站 / ②投影 / ③DOM-投影也缺 / ④落库）→ helix 缺陷
  //    分支修 + re-pin = 可逆自决；若需合 helix main（对外发布）= 不可逆 → park。
  if (f.requiresHelixMainMerge === true) {
    return result({
      verdict: VERDICT.PARK,
      faultRepo: REPO.HELIX,
      reversible: false,
      action: ACTION.PARK_HELIX_MAIN,
      gapKind: GAP_KIND.HELIX_MAIN_MERGE,
      reason: '修复需合 helix main = 发布给 cses-client（其他消费者）→ 不可逆，park',
    });
  }
  const gapKind = brokenFacet === FACET.OUTBOUND ? GAP_KIND.WIRE_BUILD : GAP_KIND.PROJECTION_BUSINESS;
  const reason =
    brokenFacet === FACET.OUTBOUND
      ? '出站 body 缺字段 → wire 构造缺陷（C013→helix-im），helix 分支修 + re-pin'
      : `${brokenFacet} 面红·投影/业务缺陷 → helix 分支修 + re-pin`;
  return result({
    verdict: VERDICT.FIX,
    faultRepo: REPO.HELIX,
    reversible: true,
    action: ACTION.HELIX_BRANCH_FIX,
    gapKind,
    reason,
  });
}
