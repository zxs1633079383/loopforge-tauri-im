---
id: C0XX
title: <一句话说清不许做什么 / 必须怎么做>
status: drafting | active | merged | deprecated
created: 2026-MM-DD
recurrence_count: <1=第一次 · 3+=跨项目候选>
inline_target: <merged 后指向 ~/.claude/rules/...>
---

## §1 触发场景
什么情况下加载本卡？给 grep 友好的关键词列表。

## §2 背景（why）
为什么存在？踩了什么坑？必须带具体 commit / 时间戳，不许写「为了代码质量」。

## §3 Required / Forbidden
✅ 必须：<具体代码片段 / 调用规范>
❌ 禁止：<反例>

## §4 Verification（可执行 · 写不出则不是 harness）
- grep：`grep -rn "pattern" <path> | wc -l` 应为 0 / N
- 命令 / CI gate：<哪个 script / make target / run.sh 卡这条>
- 测试：<哪个 spec / 单测>

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-MM-DD | <sha> | <一句话> | <一句话> |

## §6 关联
- 上游：CLAUDE.md §X / docs/uc-rollout/*
- 兄弟卡：C0NN
- 下游消费者：<哪些 spec/handler/壳>

## §7 历史与演进
- drafting→active：<日期 + 第一次命中 commit>
