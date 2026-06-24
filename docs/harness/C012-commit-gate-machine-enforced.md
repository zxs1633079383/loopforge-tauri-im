---
id: C012
title: 提交闸门机器强制——pre-push hook 自动跑 gate.sh + clippy 卫生（借鉴 helix install-hooks/clippy）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
新 clone / 换机 / push 代码 / 改 harness 索引 / 想让纪律不靠自觉。

## §2 背景（why）
借鉴 helix `install-hooks.sh` + `clippy.toml` 哲学：「约束嵌进工具链——犯错触发 CI 红/编译失败，而非等人 review」。gate.sh（C001-C011 的可执行闸门）若只「记得手动跑」= 全靠自觉，铁律③ 形同虚设。git 钩子又不进版本库（clone 即丢）→ 须 install 脚本一次性装 + 钩子内容版本化。

## §3 Required / Forbidden
✅ 新 clone / 换机后跑一次 `bash scripts/install-hooks.sh` 装 pre-push（symlink → 版本库内 `scripts/hooks/pre-push`，随仓库演进无需重装）。
✅ pre-push 自动跑 `scripts/gate.sh`，红则拦下 push。
✅ clippy 轻量卫生：workspace `[workspace.lints.clippy]`（unwrap/panic/dbg/todo=warn·不破构建）+ 根 `clippy.toml` disallowed-methods（process::exit）；深查跑 `GATE_CLIPPY=1 bash scripts/gate.sh`。
❌ 用 `git push --no-verify` 常态绕过闸门（仅紧急·须说明）。
❌ 把 loopforge 核心不变量（helix 零改/release 不带录放）指望 clippy 表达——那由 gate.sh grep 拦（C001/录放 feature 闸）。

## §4 Verification
- `ls -la .git/hooks/pre-push` → symlink 指向 `../../scripts/hooks/pre-push`。
- `bash scripts/gate.sh` → 8 步全 ✅（含 clippy 默认跳）。
- `grep -q "workspace = true" src-tauri/Cargo.toml crates/helix-driver-instrument/Cargo.toml` 命中（lints opt-in）。
- `cargo check --manifest-path src-tauri/Cargo.toml` 过（[lints] 语法不破构建）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | 730567a+ | 借鉴 helix 立卡·gate.sh 缺自动强制 | 钩子不进库·闸门靠自觉=形同虚设 |

## §6 关联
- 上游：helix install-hooks.sh / clippy.toml · CLAUDE.md §9 三铁律③
- 兄弟卡：C001-C011（gate.sh 拦的就是这些）
- 下游：每次 push

## §7 历史与演进
- drafting→active：2026-06-24（借鉴 helix·pre-push + clippy 轻量版落地）
