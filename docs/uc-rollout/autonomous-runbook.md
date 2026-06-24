# UC Rollout 自主长任务 Runbook（下班后喂给长任务跑）

> **一句话**：按依赖序解决 GitHub issues #7-#41，每个 UC 走「author 契约 → 接最简 UI → run.sh seeded 四面 → 绿翻台账+勾+关 issue+commit / 红出 bug 报告不改 helix」闭环；每阶段全绿打 tag + 补用例。
> **真源（开局必读）**：根 `CLAUDE.md` §8 rollout 纪律 + §9 harness · `docs/harness/C001-C012` · `docs/spec/angular-ui-plan.md` · `docs/uc-rollout/rollout-checklist.md` · `coverage-crossmap.md` · `docs/uc-coverage-ledger.md`。
> **分支**：`feat/uc-rollout-domain-a`（在此推进·**绝不 merge main**）。

---

## 0. 范围（做什么 / 跳什么）
- **做**：阶段 0-7 的 `ready-for-agent` issues —— **#7-#12, #14-#41**（L1 单账号自发回流闭环）。
- **跳过（不在本长任务）**：
  - L2 双账号 **#42-#45**（`ready-for-human`·需第二真实连接·留人工/后续）
  - 🌙 **#13** UC-1.3 文件上传（`backlog`·java 上传接口·真 go 夜间按需）
  - ⛔ 已不建 issue（1.6 无编辑端点 / 5.6 公告无 echo / 5.7 在线状态后端阻塞 / 7.x 搜索空桩 / 4.3 too_long harness-gap / bot 整域）
- **已绿不动**：UC-1.1 / 1.2 / 1.5。

## 1. 开局自检（动手前）
```bash
git rev-parse --abbrev-ref HEAD        # 须 feat/uc-rollout-domain-a
gh auth status                          # zxs1633079383
(cd /Users/mac28/workspace/rustWorkspace/helix && git rev-parse --short HEAD)  # round6 pin·C001
sqlite3 "/tmp/loopforge-im.db?mode=rwc" "SELECT count(*) FROM channel;"        # >0·seeded·C003
bash scripts/gate.sh                    # 应绿
```
读 `CLAUDE.md` §8/§9 + `docs/harness/C001-C012` + `docs/spec/angular-ui-plan.md` + `rollout-checklist.md`。

## 2. 执行顺序（依赖序·issue 号·阶段全绿再进下一阶段）
| 阶段 | 顺序（issue#） | 说明 |
|---|---|---|
| 0 就绪 | #7(4.1) | 就绪根·无 blocker |
| 1 建频道 | #8(5.1) → #9(5.2) | 产出可发消息的频道 |
| 2 发消息 | #10(1.9) #11(1.8) #12(1.10) | 依赖 #8 |
| 3 对消息操作 | #14(3.2) #15(3.1) #16(3.3) #17(1.4) #18(1.7) #19(2.4) | 依赖 #10 |
| 4 历史 | #20(2.1) #21(2.3) #22(2.2) | 依赖 #14；**#22 ①预期红**(见 §5) |
| 5 频道/成员 | #23(5.4) #24(5.5) #25(5.3) #26(6.3) #27(6.4) #28(6.1) #29(6.2) | 依赖 #8；🟡 子项见 §5 |
| 6 杂项 | #30(9.x) #31(10.1) #32(4.2) #33(4.5) #34(4.4) #35(8.x投票) #36(8.x平均) #37(10.2) | 混合依赖 |
| 7 teams/运维 | #38(5.8) #39(11.1) #40(11.2) #41(12.1) | #40←#39；#41 独立 |

## 3. 每个 issue 的闭环（铁律·harness C006）
1. **认领** `gh issue view #N --comments`，读四面锚点 + Angular 需求 + Blocked by（blocker 未绿则先做 blocker）。
2. **若该 UC 无 `test/expect/uc-X.expect.json` + `test/specs/uc-X.e2e.mjs`**（⚠️ **Domain B/C/D 多数未 authoring**·Phase1 只做了 Domain A 14 个）→ **先 author**：照 `test/expect/uc-send-1.expect.json` + `test/specs/uc-send-1.e2e.mjs` 模板，从**冻结真源**（helix `真机curl真源.md` ①、`projection-schema.md` ②④）派生四面期望。**契约只读**（C004）：不臆造 endpoint/字段，找不到标 ambiguity。
3. **接最简 Angular UI**：按 `angular-ui-plan.md` 对应阶段增量（阶段0 建 CL 频道列表区…）。**加法式不回退已绿**（UC-1.1/1.2/1.5 冻结集禁改）；**事件 `(click)`/`[attr.*]` 必配组件方法 + MessageRow 字段**（C007·头号假死坑）。
4. **跑**（改 Rust 才 build）：
   ```bash
   for p in 1420 4445; do pid=$(lsof -ti tcp:$p); [ -n "$pid" ] && kill -9 $pid; done; pkill -f loopforge-tauri-im; sleep 1
   cargo build --manifest-path src-tauri/Cargo.toml   # 仅改了 Rust 时
   bash scripts/run.sh -- --spec test/specs/uc-X.e2e.mjs   # 不设 HELIX_DB=用默认 seeded·C003
   ```
5. **四面 reducer 判（C009 绿由 reducer 裁定·非自我点头）**：
   - **绿**：翻 `docs/uc-coverage-ledger.md` ✅ + 勾 `rollout-checklist.md` + `gh issue close #N --comment "四面全绿 corr_key=..."` + `git commit`（conventional 中文·触发则 5 段 body）。
   - **红**：看 reducer「断在哪一跳」：
     - 本仓壳/reducer 形态不完善（corr 未探 posts[] / storage rows‖keys·C005）→ 改本仓 → 复跑。
     - **helix 行为缺陷** → 写 bug 报告（断面 + corr_key + 证据）到 `gh issue comment #N` + ledger 标 🟡/bug + **不改 helix**（C004）→ **不阻塞·继续下一个 issue**。

## 4. 每阶段收口（C006）
阶段全部 issue 绿 → `git tag -a v0.x-phaseN-<slug> -m "覆盖 commit 范围 + 该阶段 UC 列表 + 验证状态"` + 补全该阶段每 UC 的 spec+expect（真跑过）+ 更新 checklist 阶段勾。

## 5. 预期红 / 🟡 子项 / 卡点处置
- **#22 UC-2.2 ①预期红**：acl query 放行 fix 在 helix round3，不在 pin 的 round6@248fc84 → 直接出 bug 报告 + ledger 标 🟡·过（不阻塞）。
- **🟡 子项**（#24 消息置顶 / #25 member-leave 广播 / #28 留存成员 RX / #29 admin 广播）：L1 单账号能证主路径就翻 🟡（主路径绿）；广播子项归 L2（#43-45·本任务跳）。
- **#34 UC-4.4** ③ DOM N/A（纯 Rust 自驱）→ 只验 ①②④+cursor 三面。
- **卡点速查**：就绪 probe 不亮→C002/C003；run.sh 假死→C007(查 `/tmp/loopforge/run-ng.log` TS 错)；E0277→C001；投影/落库假红→C005。

## 6. Autonomous 护栏（借鉴 helix night-loop）
- **预算门**：到 token 预算 / 连续 ≥3 issue 无进展 → stall-stop，写终态行收尾。
- **沙箱门**：禁 `push`/`merge main`/`reset --hard`/`rm -rf`；**commit 前验** `pwd` 在仓内 + branch=`feat/uc-rollout-domain-a`。
- **验证门**：绿 = reducer 全绿（C009）+ `gate.sh` 绿才 commit；**绝不**「我觉得改好了」式自我点头。
- **helix 仓零改**（C004）：red → bug 报告，不动 `/Users/mac28/workspace/rustWorkspace/helix`。
- **绝不自动 merge main**：全程在 `feat/uc-rollout-domain-a`，留 PR/merge 给人。
- **每 issue 完成/中断写终态行**（全局铁律）：`✅ DONE UC-X #N @ts | commit | 四面绿 | 分支` 追加到 `docs/harness/log.md` 或 ledger；中断写 `⚠️ PARTIAL ... 卡在 ...`。

## 7. 完成判据（整任务收尾）
- #7-#12,#14-#41 的 ready-for-agent issues 全绿关闭（helix-blocked 的标 🟡 + bug 报告·不算失败）。
- 阶段 0-7 tag 打齐。
- ledger 绿数 = checklist 勾数 = 关闭的 issue 数（一致·C011 诚实出账）。
- `bash scripts/gate.sh` 绿。
- 写总终态行：`✅ DONE UC rollout 阶段0-7 @<ts> | commit <起>..<止> | <N>/<M> 绿 | feat/uc-rollout-domain-a`。

---
> 红不阻塞整链：单 UC 是 helix 缺陷就出 bug 报告标 🟡 继续，别卡死。helix 那条由另一条 workflow 修。
> 本 runbook 是长任务的单一执行真源；细节回溯 CLAUDE §8/§9 + harness C001-C012 + 各 docs/uc-rollout/*。
