// run.mjs — loop-engine 编排器（LE-8·SPEC §1/§2/§9）
//
// 串起 LE-1..6 的「控制面」编排骨架：
//   bootstrap(折叠 events.jsonl·LE-1) → phase 串行(barrier+tag·LE-6)
//     → phase 内 Scheduler 前沿(LE-6) → 每 issue pipeline
//        s1 author/implement → s2 run+reduce → s3 classify(LE-5/emitter)/route(LE-4)
//     → Controller 守卫(LE-3 预算/连败/再生隔离/收敛/防震荡/flaky)
//     → Verifier 按爆炸半径选验证深度(LE-6) → checkpoint(LE-1)
//   wind-down → 写 STATUS.md(LE-1) + resume manifest + 终态行
//
// 控制面/数据面分离（SPEC §1 硬约束）:
//   - 控制面 = 本文件的 JS 编排 / 调度 / 路由 / 安全阀 —— **真实现·可跑**（agent 改不了）。
//   - 数据面 = 真改码 / 调 helix / 跑 run.sh / 调 pencil / 读三端日志 —— 经 `adapters`
//     注入（= 后续 Workflow agent 注入点）。本文件给清晰函数占位接口，标注 ▼注入点。
//
// `--dry-run`：对真 `gh issue list`（#7-#41）或固定 fixture 算出 phase 顺序 + 拓扑前沿
//   波次 + 路由决策，**不真改码**，只打印计划。

import * as ledger from './state-ledger.mjs';
import {
  readySet,
  phaseBarrier,
  phasesInOrder,
  validateGraph,
  GREEN,
  PARKED,
} from './scheduler.mjs';
import {
  loopGuard,
  antiThrash,
  flakyGate,
  failureCap,
  regenQuarantine,
  THRESHOLDS,
} from './controller.mjs';
import { route, VERDICT, ACTION } from './diagnosis-router.mjs';
import { verifyDepth, verifyClaim } from './verifier.mjs';
import { emitGap, makeDryRunGh } from './gap-emitter.mjs';

// ── 控制面纯函数（真实现）──────────────────────────────────────────────────

/**
 * Optimizer（LE-3·SPEC §9③）：在硬包络内夹取 retro 推荐的增益。N∈[Nmin,Nmax]，K 透传。
 * 越界即夹回（防元层震荡·SPEC §8「控制面禁触」的自调有界版）。
 * @param {{N:number,K:number,Nmin:number,Nmax:number}} envelope
 * @param {{N?:number,K?:number}|null} recommendation
 * @returns {{N:number,K:number,Nmin:number,Nmax:number}}
 */
export function clampEnvelope(envelope, recommendation) {
  const env = { ...envelope };
  if (!recommendation || typeof recommendation !== 'object') return env;
  if (Number.isInteger(recommendation.N)) {
    env.N = Math.min(env.Nmax, Math.max(env.Nmin, recommendation.N));
  }
  if (Number.isInteger(recommendation.K)) env.K = recommendation.K;
  return env;
}

/**
 * Learner（LE-11·SPEC §9④）：同一根因（sig）出现 ≥ threshold 次 → 该沉淀 harness card。
 * **判定逻辑真实现**；产卡执行是注入点（adapters.proposeHarnessCard）。
 * @param {Map<string,number>|Record<string,number>} rootCauseCounts  sig → 出现次数
 * @param {number} [threshold=3]  harness 三铁律：同根因 ≥3
 * @returns {{sig:string, count:number}[]}  达阈值的根因
 */
export function learnerDecide(rootCauseCounts, threshold = 3) {
  const entries =
    rootCauseCounts instanceof Map
      ? [...rootCauseCounts.entries()]
      : Object.entries(rootCauseCounts || {});
  return entries
    .filter(([, count]) => count >= threshold)
    .map(([sig, count]) => ({ sig, count }));
}

/**
 * Architect（LE-12·SPEC §9⑤）：同一类 gap（gapKind）跨 ≥ threshold 个不同 sig 反复
 * 出现 → 该出设计/契约提案（pencil 或 helix）。**判定逻辑真实现**；提案执行是注入点
 * （adapters.proposeDesign）。与 Learner 的区别：Learner 看「同一 sig 反复」，Architect
 * 看「同一 gapKind 类下多种不同 sig 反复」= 结构性缺口。
 * @param {Map<string,Set<string>>|Record<string,string[]>} gapKindSigs gapKind → sig 集合
 * @param {number} [threshold=2]
 * @returns {{gapKind:string, distinctSigs:number}[]}
 */
export function architectDecide(gapKindSigs, threshold = 2) {
  const out = [];
  const entries =
    gapKindSigs instanceof Map
      ? [...gapKindSigs.entries()].map(([k, v]) => [k, v instanceof Set ? v.size : (v || []).length])
      : Object.entries(gapKindSigs || {}).map(([k, v]) => [k, (v || []).length]);
  for (const [gapKind, distinct] of entries) {
    if (distinct >= threshold) out.push({ gapKind, distinctSigs: distinct });
  }
  return out;
}

/**
 * 终态行（SPEC §8 meta-DoD ①）：`✅ N 绿 / M park / K quarantine · pattern 趋势 ...`。
 * @param {object} state  foldState 快照
 * @returns {string}
 */
export function finalStatusLine(state) {
  const issues = Array.isArray(state.issues) ? state.issues : [];
  const gaps = Array.isArray(state.gapLedger) ? state.gapLedger : [];
  const greens = issues.filter((i) => i.state === GREEN).length;
  const parked = issues.filter((i) => i.state === PARKED).length;
  const quar = gaps.filter((g) => g.state === 'quarantine').length;
  const trend = ledger.renderPatternTrend(state.patternTrend);
  return `✅ ${greens} 绿 / ${parked} park / ${quar} quarantine · pattern 趋势 ${trend.text}`;
}

// ── 数据面注入点（默认 stub·dry-run / 测试用）────────────────────────────────

/**
 * 默认 stub adapters：**纯内存·无 IO·无副作用**（dry-run / 自测安全基线）。
 * 真 autonomous run 时由 Workflow harness 注入真 agent 实现（▼注入点）。
 *   - authorImplement ▼ Workflow author/implement agent（grill + 改码）
 *   - runReduce       ▼ run.sh seeded + reducer「断在哪一跳」
 *   - applyFix        ▼ helix 分支修+re-pin / loopforge 绑定 / 重启 cses-im-server / pencil
 *   - checkpoint      ▼ checkpoint agent 追加 events.jsonl
 *   - tag             ▼ tag agent（phase barrier）
 *   - retro           ▼ Retrospector agent 读指标 → 增益推荐
 *   - proposeHarnessCard ▼ Learner：沉淀 harness card
 *   - proposeDesign      ▼ Architect：pencil/helix 设计提案
 *   - writeStatus     ▼ wind-down 写 STATUS.md
 * @returns {object}
 */
export function makeStubAdapters() {
  return {
    // 默认实现「全绿」：让编排骨架可在无真 IO 下跑通拓扑推进。
    authorImplement() {
      return { blastRadius: 'medium', claim: null, votes: null };
    },
    runReduce() {
      return { rawVerdict: 'green', brokenFacet: null, logFeatures: {}, corr_key: 'stub' };
    },
    applyFix() {},
    checkpoint() {},
    tag() {},
    retro() {
      return null;
    },
    proposeHarnessCard() {},
    proposeDesign() {},
    writeStatus() {},
  };
}

/**
 * 预算控制器（SPEC §8 预算储备阀）。remaining() 返回 fraction(0..1)；charge 扣减。
 * @param {number} [initial=1] 起始储备
 * @param {number} [costPerIssue=0] 每 issue 处理消耗（默认 0 = 测试基线不衰减）
 * @returns {{remaining:()=>number, charge:(n?:number)=>void, costPerIssue:number}}
 */
export function makeBudget(initial = 1, costPerIssue = 0) {
  let rem = initial;
  return {
    costPerIssue,
    remaining: () => Math.max(0, Math.min(1, rem)),
    charge(n = costPerIssue) {
      rem = Math.max(0, rem - n);
    },
  };
}

// ── 单 issue pipeline（s1→s2→s3·控制面编排）──────────────────────────────────

/**
 * 把 runReduce 的 logFeatures 归一为 gap-emitter 的 GapSignal（LE-5 入参形态）。
 */
function buildGapSignal(issue, rr, decision) {
  const lf = rr.logFeatures || {};
  return {
    uc_id: issue.uc ? `UC-${issue.uc}` : `#${issue.n}`,
    facet: rr.brokenFacet || 'projection',
    health: lf.health,
    corr_key: rr.corr_key,
    blockedBy: issue.blockers,
    evidence: {
      missing: lf.missing,
      corroboration: lf.corroboratingUCs,
      semanticRegionPresent: lf.domRegionExists,
      projectionHasField: lf.projectionHasField,
      backendConsistent: lf.backendDefaultCorrect,
    },
  };
}

/**
 * 处理一个 issue：s1 author/implement → Verifier 选深度 → s2 run+reduce(flaky 闸)
 * → s3 route → 应用裁决（绿/gap/park）→ checkpoint。**纯编排**：所有副作用经 ctx.adapters。
 * 返回 {outcome, events}（events = append-only 新数组）。
 */
function processIssue(issue, ctx) {
  const { adapters, gh, now, gainEnvelope } = ctx;
  let events = ctx.events;
  const n = issue.n;
  const corr = `run::#${n}`;

  // ── s1 author/implement（▼注入点·数据面）────────────────────────────────
  const impl = adapters.authorImplement(issue, { pass: ctx.pass }) || {};
  const blastRadius = impl.blastRadius ?? 'medium';

  // ── Verifier(LE-6)：按爆炸半径选验证深度（控制面·真实现）────────────────
  const depth = verifyDepth(blastRadius);
  ctx.depthTrace.push({ issue: n, blastRadius, depth });

  // 候选自产物若带 claim+votes → 走反幻觉 verifyClaim 闸（C009 禁自评·SPEC §7）
  if (impl.claim && Array.isArray(impl.votes)) {
    const vc = verifyClaim({ claim: impl.claim, blastRadius, votes: impl.votes });
    if (!vc.admitted) {
      ctx.bumpFailure(n);
      return { outcome: { kind: 'rejected', issue: n, reason: vc.reason, depth }, events };
    }
  }

  // ── s2 run.sh + reducer 裁决（▼注入点·数据面）+ flaky 闸（控制面 LE-3）─────
  let rr = adapters.runReduce(issue, { attempt: 0, pass: ctx.pass }) || { rawVerdict: 'green' };
  let rerunGreen = false;
  if (rr.rawVerdict === 'red') {
    const fg = flakyGate('red', 0);
    if (fg.action === 'retry') {
      const rr2 = adapters.runReduce(issue, { attempt: 1, pass: ctx.pass }) || { rawVerdict: 'red' };
      if (rr2.rawVerdict === 'green') rerunGreen = true; // 重跑转绿 = flaky
      rr = rr2;
    }
  }

  // ── s3 route（LE-4·控制面诊断路由）──────────────────────────────────────
  const brokenFacet = rr.rawVerdict === 'green' ? null : rr.brokenFacet;
  const logFeatures = { ...(rr.logFeatures || {}), rerunGreen };
  const decision = route({ brokenFacet }, logFeatures);

  // ── 应用裁决 ────────────────────────────────────────────────────────────
  if (decision.verdict === VERDICT.GREEN) {
    events = ledger.appendEvent(events, { type: 'issue_green', issue: n, corr_key: corr, facets: '4/4' }, { now });
    ctx.resetFailure(n);
    adapters.checkpoint({ type: 'issue_green', issue: n }, events);
    return { outcome: { kind: 'green', issue: n, depth }, events };
  }

  if (decision.verdict === VERDICT.FLAKY) {
    // 抖动不污染 ledger（C008·不开 gap）；留待下一 pass 复跑。
    adapters.checkpoint({ type: 'flaky', issue: n }, events);
    return { outcome: { kind: 'flaky', issue: n, depth }, events };
  }

  if (decision.verdict === VERDICT.PARK) {
    const need = `NEEDS_HUMAN_${decision.gapKind}_#${n}.md`;
    events = ledger.appendEvent(events, { type: 'parked', issue: n, reason: decision.gapKind, need }, { now });
    adapters.checkpoint({ type: 'parked', issue: n }, events);
    return { outcome: { kind: 'park', issue: n, gapKind: decision.gapKind, depth }, events };
  }

  // decision.verdict === FIX：可逆自决 gap → emit gap（开回流 issue·dedup）+ 数据面修复
  const signal = buildGapSignal(issue, rr, decision);
  const emit = emitGap(signal, { ledger: ctx.gapLedger, events, gh, now });
  events = emit.events;
  ctx.gapLedger = emit.ledger;
  const gapSig = emit.sig;

  // 再生隔离（LE-3 安全阀③）：同 sig 复燃计数 → 第 3 次 quarantine
  const regen = ctx.bumpRegen(gapSig);
  const rq = regenQuarantine(regen);
  if (rq.trip) {
    events = ledger.appendEvent(events, { type: 'quarantine', sig: gapSig, regen }, { now });
  }

  // ▼注入点·数据面：真修复（helix 分支修+re-pin / loopforge 绑定 / pencil / 重启后端）
  adapters.applyFix(decision, issue);
  if (decision.faultRepo && decision.action !== ACTION.RESTART_BACKEND) {
    events = ledger.appendEvent(
      events,
      { type: 'fix', repo: decision.faultRepo, branch: `fix/le-#${n}`, issue: n, facet: rr.brokenFacet },
      { now }
    );
  }

  // 连败熔断（LE-3 安全阀②）：原 issue 累计失败 → 第 3 次 park
  const fails = ctx.bumpFailure(n);
  const cap = failureCap(fails);
  let parked = false;
  if (cap.trip) {
    events = ledger.appendEvent(
      events,
      { type: 'parked', issue: n, reason: 'failure-cap', need: `NEEDS_HUMAN_failcap_#${n}.md` },
      { now }
    );
    parked = true;
  }

  adapters.checkpoint({ type: 'gap_emit', issue: n, sig: gapSig }, events);
  return {
    outcome: {
      kind: parked ? 'park' : 'gap',
      issue: n,
      sig: gapSig,
      gapKind: decision.gapKind,
      action: emit.action,
      regen,
      depth,
    },
    events,
  };
}

// ── 主编排（loop-until-budget·SPEC §2）───────────────────────────────────────

/**
 * 跑一段推进（一次 run）。控制流 / 调度 / 路由 / 安全阀全真实现；IO 经 adapters。
 *
 * @param {object} [opts]
 * @param {object[]} [opts.issues]   STATE_SCHEMA.issues（缺省 → 由 events 折叠得）
 * @param {object[]} [opts.events]   既有事件流（缺省 → 由 issues seed issue_ready）
 * @param {object} [opts.adapters]   数据面注入点（缺省 stub）
 * @param {object} [opts.budget]     预算控制器（缺省 makeBudget(1)）
 * @param {object} [opts.gainEnvelope]
 * @param {number} [opts.retroEveryN] 每 N issue 跑一次 Retro+Optimizer（缺省 envelope.N）
 * @param {()=>string} [opts.now]    确定性时间戳注入
 * @param {(s:string)=>void} [opts.logger]
 * @returns {object} run 结果（events / state / status / resumeManifest / finalLine / 统计）
 */
export function runEngine(opts = {}) {
  const adapters = opts.adapters || makeStubAdapters();
  const budget = opts.budget || makeBudget(1);
  const now = opts.now;
  const log = opts.logger || (() => {});
  const gh = opts.gh || makeDryRunGh();
  let gainEnvelope = { ...ledger.DEFAULT_GAIN_ENVELOPE, ...(opts.gainEnvelope || {}) };

  // ── bootstrap：折叠 events.jsonl → 快照（LE-1）──────────────────────────
  let events = Array.isArray(opts.events) ? [...opts.events] : [];
  if (events.length === 0 && Array.isArray(opts.issues)) {
    // 无既有事件 → 由 issues seed issue_ready（fold 后即得拓扑图）
    for (const it of opts.issues) {
      events = ledger.appendEvent(
        events,
        { type: 'issue_ready', issue: it.n, phase: it.phase, blockers: it.blockers || [] },
        { now }
      );
      if (it.state === 'green') {
        events = ledger.appendEvent(events, { type: 'issue_green', issue: it.n, corr_key: 'seed', facets: '4/4' }, { now });
      }
    }
  }
  let state = ledger.foldState(events, { gainEnvelope });

  // 图完整性校验（错误处理总闸·LE-6）
  const graph = validateGraph(state.issues);
  if (!graph.ok) {
    log(`⛔ 依赖图非法（${graph.errors.length} 错），拒绝推进`);
    const status = ledger.renderStatus(state);
    return {
      ok: false,
      graphErrors: graph.errors,
      events,
      state,
      status,
      finalLine: finalStatusLine(state),
      resumeManifest: buildResumeManifest(state, opts.resumeFromRunId),
      stoppedBy: 'invalid-graph',
    };
  }

  // 共享统计 / 控制状态（控制面工作内存，非事件）
  const failCounts = new Map(); // issue → 连败次数
  const regenCounts = new Map(); // sig → 复燃次数
  const rootCauseCounts = new Map(); // sig → 出现次数（Learner）
  const gapKindSigs = new Map(); // gapKind → Set<sig>（Architect）
  const depthTrace = [];
  const learnerHints = [];
  const architectHints = [];
  const firedLearner = new Set();
  const firedArchitect = new Set();
  const passes = []; // {newGreen,newGap}（settled 判定窗口）
  let issuesProcessed = 0;
  let stoppedBy = null;
  const parkedPhases = [];
  const taggedPhases = [];

  const ctxBase = {
    adapters,
    gh,
    now,
    gainEnvelope,
    depthTrace,
    bumpFailure: (n) => {
      const v = (failCounts.get(n) || 0) + 1;
      failCounts.set(n, v);
      return v;
    },
    resetFailure: (n) => failCounts.delete(n),
    bumpRegen: (s) => {
      const v = (regenCounts.get(s) || 0) + 1;
      regenCounts.set(s, v);
      return v;
    },
  };

  // ── phase 串行（barrier·SPEC §2/§8 + C006）──────────────────────────────
  const phases = phasesInOrder(state.issues);
  let retroEveryN = Number.isInteger(opts.retroEveryN) ? opts.retroEveryN : gainEnvelope.N;
  if (retroEveryN < 1) retroEveryN = 1;

  outer: for (const phase of phases) {
    log(`▶ phase ${phase}`);
    let pass = 0;

    while (true) {
      // Controller loop 守卫（LE-3·预算优先 → 收敛）
      const guard = loopGuard({ remaining: budget.remaining(), passes });
      if (guard.trip) {
        stoppedBy = guard.governing;
        log(`  ⏹ loopGuard 跳闸: ${guard.governing} — ${guard.reason}`);
        break outer;
      }

      const frontier = readySet(phase, state.issues);
      if (frontier.length === 0) break; // 本 phase 前沿空 → 进 barrier 判定

      log(`  pass ${pass} 前沿 [${frontier.map((x) => '#' + x).join(', ')}]`);
      let newGreen = 0;
      let newGap = 0;
      const touchLog = {};
      const byNum = new Map(state.issues.map((i) => [i.n, i]));

      for (const n of frontier) {
        // 防震荡（LE-3 安全阀⑤）：同 UC 一 pass 内最多碰 1 次
        const at = antiThrash({ uc: n, pass, touchLog });
        if (at.trip) {
          log(`    #${n} ${at.reason}`);
          continue;
        }
        touchLog[at.key] = (touchLog[at.key] || 0) + 1;

        const issue = byNum.get(n);
        const res = processIssue(issue, { ...ctxBase, events, pass, gapLedger: state.gapLedger });
        events = res.events;
        issuesProcessed++;
        const oc = res.outcome;
        log(`    #${n} → ${oc.kind}${oc.gapKind ? ` (${oc.gapKind})` : ''} [verify:${oc.depth}]`);

        if (oc.kind === 'green') newGreen++;
        if (oc.kind === 'gap' || (oc.kind === 'park' && oc.sig)) {
          newGap++;
          // Learner / Architect 计数（控制面真实现）
          const c = (rootCauseCounts.get(oc.sig) || 0) + 1;
          rootCauseCounts.set(oc.sig, c);
          if (oc.gapKind) {
            if (!gapKindSigs.has(oc.gapKind)) gapKindSigs.set(oc.gapKind, new Set());
            gapKindSigs.get(oc.gapKind).add(oc.sig);
          }
          fireLearnerArchitect();
        }

        // 重折叠：events 是真相，快照由 fold 算出（SPEC §5·永不失配）
        state = ledger.foldState(events, { gainEnvelope });

        // Retro + Optimizer（每 N issue·LE-2/③）
        if (issuesProcessed % retroEveryN === 0) {
          ({ events, gainEnvelope } = runRetro({ events, gainEnvelope, passes, rootCauseCounts, issuesProcessed, adapters, now }));
          state = ledger.foldState(events, { gainEnvelope });
        }
      }

      passes.push({ newGreen, newGap });
      pass++;
    }

    // ── barrier：phase 全绿 → tag（▼注入点）；否则 park 余下 break（SPEC §2）──
    const bar = phaseBarrier(phase, state.issues);
    if (bar.passed) {
      const tag = `v0.x-phase${phase}`;
      events = ledger.appendEvent(events, { type: 'phase_tag', phase, tag }, { now });
      adapters.tag(phase, tag, events);
      taggedPhases.push(phase);
      state = ledger.foldState(events, { gainEnvelope });
      log(`  ✅ phase ${phase} barrier 过 → tag ${tag}`);
    } else {
      parkedPhases.push(phase);
      log(`  ⏸ phase ${phase} barrier 未过（${bar.green}/${bar.total} 绿·park ${bar.parked}·pending ${bar.pending}）→ park 余下 break`);
      break;
    }
  }

  // ── wind-down：STATUS.md + resume manifest + 终态行（LE-1·SPEC §2）────────
  state = ledger.foldState(events, { gainEnvelope });
  const status = ledger.renderStatus(state);
  const resumeManifest = buildResumeManifest(state, opts.resumeFromRunId);
  const finalLine = finalStatusLine(state);
  adapters.writeStatus(status, resumeManifest);

  return {
    ok: true,
    events,
    state,
    status,
    resumeManifest,
    finalLine,
    stoppedBy,
    passes,
    issuesProcessed,
    taggedPhases,
    parkedPhases,
    depthTrace,
    learnerHints,
    architectHints,
    gainEnvelope,
    budgetRemaining: budget.remaining(),
  };

  // ── 内部闭包 ─────────────────────────────────────────────────────────────
  function fireLearnerArchitect() {
    for (const hit of learnerDecide(rootCauseCounts)) {
      if (firedLearner.has(hit.sig)) continue;
      firedLearner.add(hit.sig);
      learnerHints.push(hit);
      // ▼注入点·数据面：沉淀 harness card（Learner·LE-11）
      adapters.proposeHarnessCard(hit);
      log(`  🧠 Learner: 同根因 sig=${String(hit.sig).slice(0, 8)} ×${hit.count} ≥3 → 提示沉淀 harness card`);
    }
    for (const hit of architectDecide(gapKindSigs)) {
      if (firedArchitect.has(hit.gapKind)) continue;
      firedArchitect.add(hit.gapKind);
      architectHints.push(hit);
      // ▼注入点·数据面：一类 gap 反复 → pencil/helix 设计提案（Architect·LE-12）
      adapters.proposeDesign(hit);
      log(`  🏛 Architect: gapKind=${hit.gapKind} 跨 ${hit.distinctSigs} 个 sig 反复 → 提示设计/契约提案`);
    }
  }
}

/** Retro(LE-2 注入点读指标) + Optimizer(LE-3 JS 夹取)。返回新 events + envelope。 */
function runRetro({ events, gainEnvelope, passes, rootCauseCounts, issuesProcessed, adapters, now }) {
  const gaps = passes.reduce((a, p) => a + p.newGap, 0);
  const metrics = {
    pass: passes.length,
    regen_rate: issuesProcessed > 0 ? Number((gaps / issuesProcessed).toFixed(3)) : 0,
    convergence_min: passes.length,
    pattern_count: rootCauseCounts.size,
  };
  // ▼注入点·数据面：Retrospector agent 读指标 → 增益推荐（缺省 null）
  const recommendation = adapters.retro(metrics) || null;
  const newEnv = clampEnvelope(gainEnvelope, recommendation);
  const newEvents = ledger.appendEvent(events, { type: 'metrics', ...metrics, recommendation }, { now });
  return { events: newEvents, gainEnvelope: newEnv };
}

/** resume manifest：跨天续跑锚点（SPEC §2/§5）。 */
function buildResumeManifest(state, resumeFromRunId = null) {
  return {
    resumeFromRunId,
    logCursor: state.logCursor,
    phasesRemaining: state.phasesRemaining,
    gainEnvelope: state.gainEnvelope,
    openGaps: (state.gapLedger || []).filter((g) => g.state === 'open').map((g) => g.sig),
  };
}

// ── dry-run 计划器（不真改码·SPEC 验收）──────────────────────────────────────

/** dry-run 用的代表性路由样例（覆盖六路诊断分支）。 */
export const SAMPLE_VERDICTS = Object.freeze([
  { label: '四面全绿', reducerVerdict: { brokenFacet: null }, logFeatures: {} },
  { label: '①出站红·缺字段', reducerVerdict: { brokenFacet: 'outbound' }, logFeatures: {} },
  { label: '③DOM红·投影有该字段', reducerVerdict: { brokenFacet: 'dom' }, logFeatures: { projectionHasField: true, domRegionExists: true } },
  { label: '③DOM红·缺语义区', reducerVerdict: { brokenFacet: 'dom' }, logFeatures: { projectionHasField: true, domRegionExists: false } },
  { label: '后端挂(health 000)', reducerVerdict: { brokenFacet: 'outbound' }, logFeatures: { health: 0 } },
  { label: '契约过时(后端默认对·2 UC)', reducerVerdict: { brokenFacet: 'projection' }, logFeatures: { backendDefaultCorrect: true, corroboratingUCs: 2 } },
  { label: 'flaky(重跑绿)', reducerVerdict: { brokenFacet: 'storage' }, logFeatures: { rerunGreen: true } },
  { label: '需合 helix main(不可逆)', reducerVerdict: { brokenFacet: 'projection' }, logFeatures: { requiresHelixMainMerge: true } },
]);

/**
 * dry-run 计划：算 phase 顺序 + 每 phase 拓扑前沿波次（模拟逐波转绿）+ 路由决策样例。
 * **纯函数·不真改码**。
 * @param {object[]} issues  STATE_SCHEMA.issues
 * @returns {object} 计划
 */
export function planDryRun(issues) {
  if (!Array.isArray(issues)) throw new TypeError('planDryRun: issues 必须是数组');
  const graph = validateGraph(issues);
  const phases = phasesInOrder(issues);

  // 模拟拓扑推进：逐波 readySet → 全转绿 → 重算，直到 barrier 过或无进展。
  const sim = issues.map((i) => ({ ...i, state: i.state === GREEN ? GREEN : 'ready' }));
  const byNum = new Map(sim.map((i) => [i.n, i]));
  const phasePlan = [];
  for (const phase of phases) {
    const waves = [];
    let guardCount = 0;
    while (guardCount++ < sim.length + 1) {
      const fr = readySet(phase, sim);
      if (fr.length === 0) break;
      waves.push([...fr]);
      for (const n of fr) byNum.get(n).state = GREEN;
      if (phaseBarrier(phase, sim).passed) break;
    }
    phasePlan.push({ phase, waves, barrier: phaseBarrier(phase, sim) });
  }

  const routingSamples = SAMPLE_VERDICTS.map((s) => ({
    label: s.label,
    decision: route(s.reducerVerdict, s.logFeatures),
  }));

  return { ok: graph.ok, graph, phases, phasePlan, routingSamples, issueCount: issues.length };
}

/** dry-run 计划 → 人读文本。 */
export function renderPlan(plan) {
  const lines = [];
  lines.push('# loop-engine dry-run 计划（不真改码）');
  lines.push('');
  lines.push(`- issues: ${plan.issueCount} · 依赖图: ${plan.ok ? '✅ 合法' : '⛔ 非法'}`);
  if (!plan.ok) {
    for (const e of plan.graph.errors) lines.push(`  - ❌ ${e.kind}: ${e.message}`);
  }
  lines.push(`- phase 顺序: [${plan.phases.join(' → ')}]`);
  lines.push('');
  lines.push('## 各 phase 拓扑前沿波次（模拟逐波转绿）');
  for (const p of plan.phasePlan) {
    lines.push('');
    lines.push(`### phase ${p.phase}（barrier ${p.barrier.green}/${p.barrier.total} → ${p.barrier.passed ? '过' : '未过'}）`);
    p.waves.forEach((w, i) => {
      lines.push(`- wave ${i}: [${w.map((x) => '#' + x).join(', ')}]`);
    });
    if (p.waves.length === 0) lines.push('- _（无前沿·空 phase）_');
  }
  lines.push('');
  lines.push('## 路由决策样例（reducer 信号 → 诊断动作）');
  for (const s of plan.routingSamples) {
    const d = s.decision;
    lines.push(`- ${s.label} → ${d.verdict}/${d.action}${d.faultRepo ? `@${d.faultRepo}` : ''}${d.reversible === false ? '·不可逆 park' : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── CLI 入口 ─────────────────────────────────────────────────────────────────
// 用法：
//   node run.mjs --dry-run [--fixture <path>] [--from-gh]
//     默认读 fixtures/uc-rollout-issues.json；--from-gh 拉真 gh issue list。
//   不带 --dry-run：真 autonomous run 由 Workflow harness 注入数据面 adapters 驱动，
//     CLI 不自跑数据面（守 SPEC §1「数据面在 agent」），仅打印用法。

async function loadFixture(fixturePath) {
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const p = fixturePath || path.join(here, 'fixtures', 'uc-rollout-issues.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 真 gh issue list → STATE_SCHEMA.issues（best-effort：parse Blocked by + 兜底 fixture phase）。 */
async function loadFromGh(fixture) {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('gh', ['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'number,title,labels,body'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const arr = JSON.parse(out);
  const fixByNum = new Map((fixture || []).map((i) => [i.n, i]));
  const issues = [];
  for (const it of arr) {
    const n = it.number;
    if (n < 7 || n > 41) continue; // 只取 #7-#41
    const fx = fixByNum.get(n);
    const blockers = parseBlockedBy(it.body);
    issues.push({
      n,
      phase: fx ? fx.phase : null,
      blockers: blockers.length ? blockers : fx ? fx.blockers : [],
      state: 'ready',
      uc: fx ? fx.uc : undefined,
      title: it.title,
    });
  }
  return issues.length ? issues : fixture;
}

function parseBlockedBy(body) {
  if (!body) return [];
  const m = String(body).match(/Blocked by[^\n]*\n?[-\s]*([#\d,\s]+)/i);
  if (!m) return [];
  return [...m[1].matchAll(/#?(\d+)/g)].map((x) => Number(x[1]));
}

async function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  if (!dryRun) {
    console.log('loop-engine 编排器（LE-8）');
    console.log('  dry-run:  node run.mjs --dry-run [--fixture <path>] [--from-gh]');
    console.log('  真 run:   由 Workflow harness 注入数据面 adapters 驱动（SPEC §1·数据面在 agent）。');
    return 0;
  }
  const fixtureIdx = args.indexOf('--fixture');
  const fixturePath = fixtureIdx >= 0 ? args[fixtureIdx + 1] : null;
  const fixture = await loadFixture(fixturePath);

  let issues = fixture;
  if (args.includes('--from-gh')) {
    try {
      issues = await loadFromGh(fixture);
      console.log(`(从 gh 拉到 ${issues.length} 个 #7-#41 issue)`);
    } catch (e) {
      console.log(`(gh 不可用，回退 fixture：${e.message})`);
      issues = fixture;
    }
  }

  const plan = planDryRun(issues);
  console.log(renderPlan(plan));
  return plan.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}
