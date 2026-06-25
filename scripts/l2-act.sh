#!/usr/bin/env bash
# scripts/l2-act.sh —— L2 双账号「act-as-<B>」HTTP 出站原语（cookieId 桥鉴权）。
#
# 命题：L2 四面验证（read-receipt / 他人发消息 / 拉踢人 / admin / 退公司广播）的某一面
# **结构上只有第二账号才造得出**——A=444 是被观测端（暖栈 app 跑 4445），B=678 是动作端。
# 本脚本让 B 以自身身份发 cses HTTP（发消息 / 已读 / 加人…），触发 go 向 A 推送。
#
# 鉴权（探明·2026-06-26）：CSES `cookieId=userId` 桥（memory cookieid_equals_userid）——
#   go-mattermost WS/HTTP 入站直接拿 `cookieId` header 当 userId 建 session，无独立 token。
#   故 act-as-678 = 所有出站 HTTP 带 `cookieId: 678` 头即可（实测 posts/create→`post sender
#   success`、channels/view→`viewChannel success` 均 200）。
#
# 用法：
#   scripts/l2-act.sh send <channelId> <text>          B 发消息（posts/create·返回 temporaryId）
#   scripts/l2-act.sh read <channelId>                 B 会话已读（channels/view）
#   scripts/l2-act.sh read-post <channelId> <postId>   B 单条已读（post/read）
#   scripts/l2-act.sh member-add <channelId> <userId>  B 拉人入频道（channel/member/change add）
#   scripts/l2-act.sh whoami                            鉴权连通自检（channels/view 空 probe）
#
# env：
#   L2_USER   动作账号 cookieId（默认 678）
#   L2_API    apiBase（默认从 config/dev-local.json 读 apiBase）
#   L2_TEAM   companyId/teamId（默认从 config/dev-local.json 读 companyId）
set -uo pipefail

LF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LF_DIR/.." && pwd)"
PROFILE="$REPO_ROOT/config/dev-local.json"

# —— 从 profile 取端点/租户默认值（profile 是单一真源·不散落硬编码）——
_json_field() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$PROFILE" | head -1; }
L2_USER="${L2_USER:-678}"
L2_API="${L2_API:-$(_json_field apiBase)}"
L2_TEAM="${L2_TEAM:-$(_json_field companyId)}"

[ -n "$L2_API" ]  || { echo "⛔ L2_API 空（config/dev-local.json apiBase 缺失？）" >&2; exit 1; }
[ -n "$L2_TEAM" ] || { echo "⛔ L2_TEAM 空（config/dev-local.json companyId 缺失？）" >&2; exit 1; }

# —— 身份头单一构造点（与 engine.rs identity_headers 同源·cookieId 桥）——
_curl() {
  local path="$1"; shift
  curl -s -X POST "$L2_API/$path" \
    -H "cookieId: $L2_USER" -H "companyId: $L2_TEAM" \
    -H 'appType: bct' -H 'device: IOS' -H 'language: zh' \
    -H 'Content-Type: application/json' -m 12 "$@"
}

VERB="${1:-}"; shift || true
case "$VERB" in
  send)
    CH="${1:?用法: send <channelId> <text>}"; TEXT="${2:?用法: send <channelId> <text>}"
    TMP="$(openssl rand -hex 12)"
    # 出站 posts/create body：真机curl真源 §1 全 camelCase 必填集（act-as-B 身份）。
    BODY=$(cat <<JSON
{"viewers":["all"],"message":"$TEXT","mentions":[],"temporaryId":"$TMP","type":"TEXT","simpleMessage":"$TEXT","channelId":"$CH","userId":"$L2_USER","teamId":"$L2_TEAM","userSnapshot":{"userId":"$L2_USER","teamId":"$L2_TEAM","userName":"$L2_USER"},"id":"","props":{},"topicId":"","revoke":false}
JSON
)
    RESP="$(_curl posts/create -d "$BODY")"
    echo "$RESP"
    # 末行吐 temporaryId（调用方 grep 取锚）。
    echo "temporaryId=$TMP" >&2
    ;;
  read)
    CH="${1:?用法: read <channelId>}"
    _curl channels/view -d "{\"channels\":[{\"id\":\"$CH\"}]}"
    echo ""
    ;;
  read-post)
    CH="${1:?用法: read-post <channelId> <postId>}"; PID="${2:?用法: read-post <channelId> <postId>}"
    _curl post/read -d "{\"channelId\":\"$CH\",\"posts\":[\"$PID\"]}"
    echo ""
    ;;
  member-add)
    CH="${1:?用法: member-add <channelId> <userId>}"; UID="${2:?用法: member-add <channelId> <userId>}"
    _curl channel/member/change -d "{\"channelId\":\"$CH\",\"add\":[{\"id\":\"$UID\",\"role\":\"MEMBER\",\"teamId\":\"$L2_TEAM\"}],\"remove\":[]}"
    echo ""
    ;;
  whoami)
    # 鉴权连通自检：channels/view 空 channels probe（不副作用·只验 session 建得起）。
    echo "act-as L2_USER=$L2_USER api=$L2_API team=$L2_TEAM"
    _curl channels/view -d '{"channels":[]}'
    echo ""
    ;;
  *)
    echo "用法: $0 {send|read|read-post|member-add|whoami} ...（见脚本头）" >&2
    exit 2
    ;;
esac
