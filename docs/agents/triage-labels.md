# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Canonical role    | Label in our tracker | Meaning                                  |
| ----------------- | -------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`    | Requires human implementation            |
| `wontfix`         | `wontfix`            | Will not be actioned                     |

本仓暂无既有标签，采用默认（标签名=角色名）。首次 `/triage` 时若标签不存在，用
`gh label create <name>` 建即可。

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table. Edit the right-hand column if you later adopt different vocabulary.
