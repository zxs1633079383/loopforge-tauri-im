---
id: C001
title: helix 依赖必须单一 git 快照（全 helix-* 同源同 rev，禁 path/git 混用）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
改 helix 依赖 / 升级 helix rev / 新增依赖 helix-* 的 crate / 出现 `E0277 ... multiple different versions of crate helix_core` / `Recording<P>: helix_core::ports::* is not satisfied`。

## §2 背景（why）
2026-06-24：`helix-driver-instrument` 走 path dep 拉本地工作树 helix-core，`src-tauri` 走 git branch(round6 @248fc84) helix-core → 依赖图两份 helix_core → `Recording<NativeClock>` 实现的是 path 版 trait，`run_engine_loop` 的 bound 要 git 版 → E0277 ×12，debug 二进制从未构建成功（修复 commit 9a2b23f）。另一条 workflow 在改 helix 工作树，path dep 会吃漂移；git pin 给冻结快照，验证期不被扰动。

## §3 Required / Forbidden
✅ 所有 helix-* 依赖（helix-core / helix-im / helix-driver-native / helix-driver-host + instrument 的 helix-core）**同一 git source + 同一 branch**（当前 feat/cses-round6-uc-reclaim），Cargo.lock pin 同一 commit。
❌ 任一 helix-* 用 `path = "../../helix/..."` 而其它用 `git =` → 双版本。
❌ 升级 helix 时只升一部分 crate（必须一组同升：`cargo update -p helix-core helix-im helix-driver-native helix-driver-host`）。

## §4 Verification
- `grep -rn "helix-" src-tauri/Cargo.toml crates/*/Cargo.toml | grep -E "path =|git ="` → 不得 path/git 混用，全 git 同 branch。
- `grep -c "helix-core" Cargo.lock` 的 git source 行应只有 1 个 rev（无第二 `source = ...helix...#<别的rev>`）。
- `cargo check --manifest-path src-tauri/Cargo.toml` PASS（无 E0277 multiple versions）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | 9a2b23f | E0277 multiple helix_core ×12·二进制构建失败 | instrument path dep + src-tauri git dep 双版本 |

## §6 关联
- 上游：CLAUDE.md §0 helix 上游 / §6 编译 cadence
- 兄弟卡：C002（同因 helix rev 漂移）
- 下游：所有 cargo build / run.sh live

## §7 历史与演进
- drafting→active：2026-06-24 commit 9a2b23f（修复即命中）
