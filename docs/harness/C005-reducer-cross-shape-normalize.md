---
id: C005
title: reducer 跨形态归一（corr-key 探 posts[]·storage 计数 rows‖keys）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
铺批量/撤回/转发族 UC（im:post:batch-updated / createPosts ×N）/ 四面报「无投影 emit·断在 gate→投影」/ storage 报「rows 期望 ≥1 实得 undefined」。

## §2 背景（why）
2026-06-24 UC-1.5：① batch 信封 `data.posts:[{id}]` 的 post id 嵌数组内，原 corr-key extractDims 只探顶层 → 投影只有 ch 维度，与出站(postId)/落库(sid)聚不成束 → ②面假红。② storage op 计数字段异名：batch_upsert/insert 报 `rows`，batch_update/delete 报 `keys`，reducer 只读 rows → batch_update 时 undefined → ④面假红。两者皆 reducer 不完善（非契约/helix 问题），修在本仓 reducer（commit f3b3a92）。

## §3 Required / Forbidden
✅ corr-key.mjs extractDims 探入 `data.posts[0]`/`posts[0]` 取 sid（批量信封）。
✅ four-facet-reducer.mjs actualStorage 计数归一 `rows ?? keys ?? count`。
❌ 假设所有信封 sid 在顶层 / 假设所有 storage op 都报 rows。
❌ 因 corr/storage 归一缺失就误判 helix/契约红（先查 reducer 形态覆盖）。

## §4 Verification
- `grep -n "posts?.\[0\]\|posts\[0\]" test/reducer/corr-key.mjs` 命中。
- `grep -n "keys ?? \|rows ?? hit.payload.keys\|?? hit.payload.count" test/reducer/four-facet-reducer.mjs` 命中归一。
- `node test/reducer/four-facet-reducer.test.mjs` → 39/0。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | f3b3a92 | UC-1.5 ②无投影 emit + ④rows undefined | corr 未探 posts[]·storage 未归一 keys |

## §6 关联
- 上游：test/CLAUDE.md 四面↔facet/hop 表
- 兄弟卡：C004（红转绿处置·先查本仓）
- 下游：批量族 UC-1.7 转发等直接受益

## §7 历史与演进
- drafting→active：2026-06-24 commit f3b3a92
