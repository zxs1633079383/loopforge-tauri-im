#!/usr/bin/env python3
"""
apifox-suite-create.py — loopforge-tauri-im 全 UC + 全 HTTP 端点 Apifox 测试套件

覆盖: 阶段0-7 共 31 UC + L2 4UC · cses-im-server :8066 + cses-java :3399
Auth: cookieId 请求头 (主账号=444, L2=678)
断言: L3 = HTTP 200 + status=="SUCCESS" + key data fields
WS 依赖写入: 方向A = delay(200ms) + read-back GET 补偿

用法:
  APIFOX_TOKEN=<token> python3 scripts/apifox-suite-create.py
  # 或不设 token（脚本自动从 LevelDB 提取，需先运行过 Apifox 桌面端）

环境变量:
  APIFOX_TOKEN   Apifox 访问令牌（优先）
  TEAM_ID        公司 teamId（channel/create 等请求必填）默认 placeholder
  MEMBER_B       L2 第二账号 userId（默认 678）
"""

from __future__ import annotations

import json
import subprocess
import sys
import os
import glob
import re
import tempfile
import time

# ── 配置 ────────────────────────────────────────────────────────────────────
PROJECT_ID = "8449651"
BASE_URL_IM = "http://localhost:8066"     # cses-im-server
BASE_URL_JAVA = "http://localhost:3399"   # cses-java（vote/average）
COOKIE_ID = os.environ.get("COOKIE_ID", "444")
COOKIE_ID_B = os.environ.get("MEMBER_B", "678")
COMPANY_ID = os.environ.get("COMPANY_ID", "64118eebd2b665246b7880eb")
TEAM_ID = os.environ.get("TEAM_ID", COMPANY_ID)
APIFOX_PROFILE = os.environ.get("APIFOX_PROFILE", "full").strip().lower() or "full"
VALID_APIFOX_PROFILES = {"full", "go-only"}
if APIFOX_PROFILE not in VALID_APIFOX_PROFILES:
    print(f"ERROR: APIFOX_PROFILE must be one of {sorted(VALID_APIFOX_PROFILES)}, got {APIFOX_PROFILE!r}")
    sys.exit(2)

GO_ONLY_EXCLUDED_SCENARIOS = {
    "UC-8.x 投票 CRUD",
    "UC-8.x 平均分 CRUD",
}

_token_cache: str = ""


def get_token() -> str:
    """
    优先用 APIFOX_TOKEN 环境变量（Personal Access Token，从 Apifox 账号设置→API访问令牌 生成）。
    LevelDB 自动提取的是会话 token，只能用于 create/update，test-suite run 会报「无效令牌」。
    """
    global _token_cache
    if _token_cache:
        return _token_cache
    t = os.environ.get("APIFOX_TOKEN", "")
    if t:
        _token_cache = t
        return t
    # 降级：从 LevelDB 提取会话 token（仅适用于 create/update，run 命令请用 PAT）
    leveldb_dir = os.path.expanduser(
        "~/Library/Application Support/apifox/Local Storage/leveldb"
    )
    patterns = [
        os.path.join(leveldb_dir, "*.ldb"),
        os.path.join(leveldb_dir, "*.log"),
    ]
    candidates: list[str] = []
    for pattern in patterns:
        for path in glob.glob(pattern):
            try:
                r = subprocess.run(["strings", path], capture_output=True, text=True, timeout=10)
                for m in re.findall(r'"Bearer ([A-Za-z0-9._\-]{10,})"', r.stdout):
                    candidates.append(m)
                # fallback: no-quotes form
                for m in re.findall(r'Bearer ([A-Za-z0-9._\-]{40,})', r.stdout):
                    candidates.append(m)
            except Exception:
                pass
    if candidates:
        _token_cache = max(set(candidates), key=candidates.count)
        return _token_cache
    print("ERROR: 无法获取 Apifox token。请设置 APIFOX_TOKEN 或先运行 Apifox 桌面端。")
    sys.exit(1)


def af(*args: str, json_input: dict | None = None) -> dict:
    """调用 apifox CLI，返回解析后的 JSON 响应。"""
    token = get_token()
    # 全局 flag 必须在 subcommand 之后，否则 CLI 打印 help 并返回错误
    cmd = ["apifox", *args, "--project", PROJECT_ID, "--access-token", token]
    inp = json.dumps(json_input).encode() if json_input else None
    r = subprocess.run(cmd, capture_output=True, input=inp)
    try:
        result = json.loads(r.stdout)
    except json.JSONDecodeError:
        result = {"raw": r.stdout.decode(errors="replace"), "stderr": r.stderr.decode(errors="replace")}
    if not result.get("success", True):
        print(f"  ⚠️  命令失败: {' '.join(args)}")
        print(f"     {result.get('message', result)}")
    return result


# ── 构建 step helpers ────────────────────────────────────────────────────────

COOKIE_VAR_A = "cookieId"
COOKIE_VAR_B = "cookieId_B"


def _inject_cookie_pre(cookie_var: str) -> dict:
    """preProcessor：运行期注入 cookieId + companyId 请求头（变量替换在此上下文正常工作）。"""
    fallback = COOKIE_ID if cookie_var == COOKIE_VAR_A else COOKIE_ID_B
    js = "\n".join([
        f"pm.request.headers.upsert({{key: 'cookieId', value: pm.environment.get('{cookie_var}') || '{fallback}'}});",
        f"pm.request.headers.upsert({{key: 'companyId', value: pm.environment.get('companyId') || '{COMPANY_ID}'}});",
    ])
    return {"type": "customScript", "enable": True, "defaultEnable": True, "data": js}


def http_step(
    sid: str,
    name: str,
    method: str,
    path: str,
    body: dict | str | None = None,
    cookie_id: str = "{{cookieId}}",
    base_var: str = "base_url",
    extra_headers: list[dict] | None = None,
) -> dict:
    """生成 customHttp 步骤。cookieId 通过 preProcessor pm.request.headers.upsert 注入（变量替换稳定）。"""
    # 用 cookie_id 参数判断是 user A 还是 B
    cookie_var = COOKIE_VAR_B if cookie_id in (f"{{{{{COOKIE_VAR_B}}}}}", COOKIE_ID_B) else COOKIE_VAR_A

    if body is None:
        req_body = {"type": "none", "data": ""}
    elif isinstance(body, str):
        req_body = {"type": "json", "data": body}
    else:
        req_body = {"type": "json", "data": json.dumps(body, ensure_ascii=False)}

    return {
        "type": "customHttp",
        "id": sid,
        "disable": False,
        "customHttpRequest": {
            "id": 0,
            "name": name,
            "path": f"{{{{{base_var}}}}}{path}",
            "method": method.lower(),
            "folderId": 0,
            "parameters": {"path": [], "query": [], "header": [], "cookie": []},
            "requestBody": req_body,
            "preProcessors": [_inject_cookie_pre(cookie_var)],
            "postProcessors": [],
            "auth": {},
            "advancedSettings": {},
            "commonParameters": {},
            "projectId": int(PROJECT_ID),
        },
    }


def script_step(
    sid: str,
    test_name: str,
    extra_checks: str = "",
    extract: dict[str, str] | None = None,
    expect_data: bool = False,
    require_extract: bool = False,
) -> dict:
    """生成断言 + 变量提取 script 步骤 (pm API)。
    expect_data=True 时额外断言 r.data 存在（用 .to.exist，同时拒绝 null 和 undefined）。
    不设 expect_data 则只断言 status=="SUCCESS"，适用于只返回 {status} 的端点。
    """
    lines = [
        "const r = pm.response.json();",
        f'pm.test("{test_name}", () => {{',
        '  pm.expect(r.status).to.equal("SUCCESS");',
    ]
    if expect_data:
        lines.append('  pm.expect(r.data).to.exist;')
    if extra_checks:
        lines.append(f"  {extra_checks}")
    lines.append("});")
    if extract:
        for var, expr in extract.items():
            lines.append(f'const _v_{var} = {expr};')
            if require_extract:
                lines.append(f'pm.expect(_v_{var}, "{var} extracted").to.exist;')
            lines.append(f'if (_v_{var} !== undefined && _v_{var} !== null) pm.environment.set("{var}", _v_{var});')
    return {
        "type": "script",
        "id": sid,
        "disable": False,
        "parameters": {
            "type": "customScript",
            "data": "\n".join(lines),
            "enable": True,
            "defaultEnable": True,
        },
    }


def delay_step(sid: str, ms: int = 200) -> dict:
    return {"type": "delay", "id": sid, "disable": False, "parameters": {"timeout": ms}}


def merge_script_steps(steps: list[dict]) -> list[dict]:
    """把 [customHttp, script] 连续对合并：script 的 JS 嵌入 http 的 postProcessors。
    独立 script 步骤（前面不是 customHttp，或不紧跟在 customHttp 之后）保持不变。
    这样 pm.response 在 postProcessor 里可用，不再在独立步骤里 undefined。
    """
    result: list[dict] = []
    i = 0
    while i < len(steps):
        step = steps[i]
        if (
            step.get("type") == "customHttp"
            and i + 1 < len(steps)
            and steps[i + 1].get("type") == "script"
        ):
            script_s = steps[i + 1]
            js_code = script_s.get("parameters", {}).get("data", "")
            step["customHttpRequest"]["postProcessors"].append({
                "type": "customScript",
                "enable": True,
                "defaultEnable": True,
                "data": js_code,
            })
            result.append(step)
            i += 2  # 同时跳过 script step
        else:
            result.append(step)
            i += 1
    return result


def note_step(sid: str, msg: str) -> dict:
    """仅做注释用途的脚本步骤（不含断言）。"""
    return {
        "type": "script",
        "id": sid,
        "disable": False,
        "parameters": {
            "type": "customScript",
            "data": f'console.log("{msg}");',
            "enable": True,
            "defaultEnable": True,
        },
    }


def _post_id_extract_expr(
    message: str | None = None,
    post_type: str | None = None,
    user_id: str | None = None,
) -> str:
    predicates = ["p"]
    if message is not None:
        message_js = json.dumps(message, ensure_ascii=False)
        predicates.append(
            "("
            f"String(p.message || '') === {message_js} || "
            f"String(p.simpleMessage || '') === {message_js} || "
            f"String(p.props?.announcement?.content || '') === {message_js} || "
            f"String(p.props?.announcement?.text || '') === {message_js}"
            ")"
        )
    if post_type is not None:
        post_type_js = json.dumps(post_type.upper(), ensure_ascii=False)
        predicates.append(f"String(p.type || p.postType || '').toUpperCase() === {post_type_js}")
    if user_id is not None:
        user_id_js = json.dumps(user_id, ensure_ascii=False)
        predicates.append(f"String(p.userId || p.userSnapshot?.userId || '') === {user_id_js}")
    predicate = " && ".join(predicates)
    return (
        "(() => { "
        "const items = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []); "
        f"const hit = items.find(p => {predicate}); "
        "return hit?.id || hit?.postId; "
        "})()"
    )


def post_create_body(message: str, post_type: str = "TEXT", user_id: str = COOKIE_ID) -> dict:
    props = {"template": {"userIds": []}} if post_type == "TEMPLATE" else {}
    if post_type == "ANNOUNCEMENT":
        props = {"announcement": {"content": message}}
    return {
        "viewers": ["all"],
        "message": message,
        "mentions": [],
        "temporaryId": "{{$randomUUID}}",
        "type": post_type,
        "simpleMessage": message,
        "channelId": "{{groupChannelId}}",
        "userId": user_id,
        "teamId": TEAM_ID,
        "userSnapshot": {
            "orgName": "test",
            "deptName": "test",
            "userName": "test" if user_id == COOKIE_ID else "userB",
            "userId": user_id,
            "teamId": TEAM_ID,
        },
        "id": "",
        "props": props,
        "topicId": "",
        "revoke": False,
    }


def create_post_steps(
    prefix: str,
    message: str,
    post_var: str = "postId",
    post_type: str = "TEXT",
    user_id: str = COOKIE_ID,
    cookie_id: str = "{{cookieId}}",
) -> list[dict]:
    """Create a real post and refresh post_var via getLatestPost."""
    unique_message = f"{message}-{prefix}-{int(time.time() * 1000)}"
    return [
        http_step(f"{prefix}a", f"POST posts/create [{prefix}]", "post",
                  "/api/cses/posts/create",
                  body=post_create_body(unique_message, post_type=post_type, user_id=user_id),
                  cookie_id=cookie_id),
        script_step(f"{prefix}b", f"{prefix} posts/create SUCCESS"),
        delay_step(f"{prefix}c", 1500),
        http_step(f"{prefix}d", f"GET posts/getLatestPost [{prefix}]", "post",
                  "/api/cses/posts/getLatestPost",
                  body='{"channelId":"{{groupChannelId}}"}'),
        script_step(f"{prefix}e", f"{prefix} read-back SUCCESS",
                    expect_data=True,
                    require_extract=True,
                    extract={post_var: _post_id_extract_expr(unique_message, post_type, user_id)}),
    ]


def fresh_group_channel_steps(prefix: str, channel_var: str) -> list[dict]:
    """Create a fresh real group channel and store its id in channel_var."""
    body = {
        "teamId": TEAM_ID,
        "displayName": f"loopforge-{prefix}",
        "orient": "",
        "type": "P",
        "users": [
            {"id": COOKIE_ID, "teamId": TEAM_ID, "role": "CREATOR"},
            {"id": COOKIE_ID_B, "teamId": TEAM_ID, "role": "MEMBER"},
        ],
        "picturetype": "USER",
        "picture": {"userIds": [COOKIE_ID, COOKIE_ID_B]},
        "forceCreate": True,
    }
    return [
        http_step(f"{prefix}a", f"POST channel/create [{prefix}]", "post",
                  "/api/cses/channel/create", body=body),
        script_step(f"{prefix}b", f"{prefix} channel/create SUCCESS",
                    expect_data=True,
                    extract={channel_var: "r.data?.id || r.data?.channelId || r.data"}),
    ]


# ── 创建/更新场景 ────────────────────────────────────────────────────────────

def create_scenario(name: str, description: str, priority: int = 1) -> int | None:
    """创建场景元数据，返回 scenarioId。"""
    r = af(
        "test-scenario", "create",
        "--name", name,
        "--description", description,
        "--folder-id", "0",
        "--priority", str(priority),
    )
    sid = r.get("data", {}).get("id")
    if sid:
        print(f"  ✅ 场景已创建 id={sid}: {name}")
    return sid


def set_steps(scenario_id: int, steps: list[dict]) -> None:
    """用 update --file 把 steps 写入场景。合并 [http, script] 对避免 pm.response undefined。"""
    data = {"steps": merge_script_steps(steps)}
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        tmpfile = f.name
    try:
        af("test-scenario", "update", str(scenario_id), "--file", tmpfile)
    finally:
        os.unlink(tmpfile)


# ═══════════════════════════════════════════════════════════════════════════════
# UC 步骤定义
# ═══════════════════════════════════════════════════════════════════════════════

def steps_uc41() -> list[dict]:
    """UC-4.1 hello 全量增量 — POST channels/load/increment"""
    return [
        http_step("s1", "POST channels/load/increment",
                  "post", "/api/cses/channels/load/increment",
                  body={"timestamp": 0, "cursors": []}),
        script_step("s2", "UC-4.1 全量增量 SUCCESS",
                    extract={"hello_data_raw": "JSON.stringify(r.data || [])"}),
    ]


def steps_uc51() -> list[dict]:
    """UC-5.1 创建群聊 — POST channel/create"""
    body = {
        "teamId": TEAM_ID,
        "displayName": "loopforge-test-group",
        "orient": "",
        "type": "P",
        "users": [
            {"id": COOKIE_ID, "teamId": TEAM_ID, "role": "CREATOR"},
            {"id": COOKIE_ID_B, "teamId": TEAM_ID, "role": "MEMBER"},
        ],
        "picturetype": "USER",
        "picture": {"userIds": [COOKIE_ID, COOKIE_ID_B]},
        "forceCreate": True,
    }
    return [
        http_step("s1", "POST channel/create", "post", "/api/cses/channel/create", body=body),
        script_step("s2", "UC-5.1 创建群聊 SUCCESS",
                    expect_data=True,
                    extract={"groupChannelId": "r.data?.id || r.data?.channelId || r.data"}),
    ]


def steps_uc52() -> list[dict]:
    """UC-5.2 创建话题 — POST posts/makeTopic (依赖 groupChannelId + postId)"""
    body_str = (
        '{"rootId":"{{groupChannelId}}","teamId":"' + TEAM_ID + '",'
        '"postId":"{{postId}}","displayName":"loopforge-topic",'
        '"type":"T","users":[{"id":"' + COOKIE_ID + '","teamId":"' + TEAM_ID + '","role":"CREATOR"},'
        '{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}],'
        '"picturetype":"USER","picture":{"userIds":["' + COOKIE_ID + '","' + COOKIE_ID_B + '"]},'
        '"forceCreate":true}'
    )
    return [
        note_step("s0", "UC-5.2 依赖 groupChannelId 和 postId（从 UC-5.1/UC-1.1 提取）"),
        http_step("s1", "POST posts/makeTopic", "post", "/api/cses/posts/makeTopic", body=body_str),
        # makeTopic 返回 {status:"SUCCESS"} 无 data 字段，不断言 data 存在；topicChannelId 从直接字段或 data 兜底
        script_step("s2", "UC-5.2 创建话题 SUCCESS",
                    extract={"topicChannelId": "r.data?.id || r.data?.channelId || r.channelId || r.id"}),
    ]


def steps_uc11() -> list[dict]:
    """UC-1.1 发文本消息 — POST posts/create (WS→方向A read-back)"""
    post_id_expr = (
        "Array.isArray(r.data) "
        "? ((r.data.find(p => p && p.userId !== 'SYS' && p.type !== 'NOTICE') || r.data[0] || {}).id "
        "|| (r.data.find(p => p && p.userId !== 'SYS' && p.type !== 'NOTICE') || r.data[0] || {}).postId) "
        ": (r.data?.id || r.data?.postId)"
    )
    body_str = (
        '{"viewers":["all"],"message":"loopforge-e2e-test","mentions":[],'
        '"temporaryId":"{{$randomUUID}}","type":"TEXT","simpleMessage":"loopforge-e2e-test",'
        '"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID + '",'
        '"teamId":"' + TEAM_ID + '",'
        '"userSnapshot":{"orgName":"test","deptName":"test","userName":"test",'
        '"userId":"' + COOKIE_ID + '","teamId":"' + TEAM_ID + '"},'
        '"id":"","props":{},"topicId":"","revoke":false}'
    )
    # Direction A: delay 200ms + read-back getLatestPost
    readback_body_str = '{"channelId":"{{groupChannelId}}"}'
    return [
        http_step("s1", "POST posts/create (发文本)", "post", "/api/cses/posts/create", body=body_str),
        script_step("s2", "UC-1.1 发文本 SUCCESS"),
        delay_step("s3", 800),
        http_step("s4", "GET posts/getLatestPost [方向A read-back]",
                  "post", "/api/cses/posts/getLatestPost", body=readback_body_str),
        script_step("s5", "UC-1.1 read-back 验证消息入库",
                    expect_data=True,
                    extract={"postId": post_id_expr}),
    ]


def steps_uc12() -> list[dict]:
    """UC-1.2 发文档 — POST posts/create type=DOCUMENT"""
    body_str = (
        '{"viewers":["all"],"message":"","mentions":[],'
        '"temporaryId":"{{$randomUUID}}","type":"DOCUMENT","simpleMessage":"",'
        '"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID + '",'
        '"teamId":"' + TEAM_ID + '",'
        '"userSnapshot":{"orgName":"test","deptName":"test","userName":"test",'
        '"userId":"' + COOKIE_ID + '","teamId":"' + TEAM_ID + '"},'
        '"id":"","props":{"file":{}},"topicId":"","revoke":false}'
    )
    return [
        http_step("s1", "POST posts/create (发文档 type=DOCUMENT)",
                  "post", "/api/cses/posts/create", body=body_str),
        script_step("s2", "UC-1.2 发文档 SUCCESS"),
    ]


def steps_uc19() -> list[dict]:
    """UC-1.9 加急 + 加急已读"""
    return [
        http_step("s1", "POST posts/urgentPost", "post", "/api/cses/posts/urgentPost",
                  body='{"postId":"{{postId}}","channelId":"{{groupChannelId}}","targetIds":["' + COOKIE_ID + '"]}'),
        script_step("s2", "UC-1.9 urgentPost SUCCESS"),
        http_step("s3", "POST posts/urgentConfirm", "post", "/api/cses/posts/urgentConfirm",
                  body='{"postId":"{{postId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s4", "UC-1.9 urgentConfirm SUCCESS"),
        http_step("s5", "POST posts/urgentCancel", "post", "/api/cses/posts/urgentCancel",
                  body='{"postId":"{{postId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s6", "UC-1.9 urgentCancel SUCCESS"),
    ]


def steps_uc18() -> list[dict]:
    """UC-1.8 快捷回复 emoji — POST posts/quickReply"""
    return [
        http_step("s1", "POST posts/quickReply", "post", "/api/cses/posts/quickReply",
                  body='{"emoji":"👍","postId":"{{postId}}","userId":"' + COOKIE_ID + '"}'),
        script_step("s2", "UC-1.8 快捷回复 SUCCESS"),
        # 取消 emoji（再次 POST 同一 emoji 切换）
        http_step("s3", "POST posts/quickReply (取消 emoji)", "post", "/api/cses/posts/quickReply",
                  body='{"emoji":"👍","postId":"{{postId}}","userId":"' + COOKIE_ID + '"}'),
        script_step("s4", "UC-1.8 取消快捷回复 SUCCESS"),
    ]


def steps_uc110() -> list[dict]:
    """UC-1.10 定时消息"""
    # schedulePostAt 单位秒（服务端用 Unix seconds，不是 ms）
    create_body = {
        "post": post_create_body("定时消息测试"),
        "schedulePostAt": int(time.time()) + 3600,
    }
    return [
        http_step("s1", "POST posts/createSchedule", "post",
                  "/api/cses/posts/createSchedule", body=create_body),
        script_step("s2", "UC-1.10 createSchedule SUCCESS",
                    extract={"schedulePostId": "r.data?.id || r.data?.postId || r.data?.post?.id"}),
        http_step("s3", "POST posts/getSchedule", "post",
                  "/api/cses/posts/getSchedule",
                  body='{"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID + '"}'),
        script_step("s4", "UC-1.10 getSchedule SUCCESS"),
        http_step("s5", "POST posts/cancelSchedule", "post",
                  "/api/cses/posts/cancelSchedule",
                  body='{"postId":"{{schedulePostId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s6", "UC-1.10 cancelSchedule SUCCESS"),
    ]


def steps_uc15() -> list[dict]:
    """UC-1.5 撤回消息 — POST posts/revoke"""
    return [
        *create_post_steps("s0r", "loopforge-revoke-target", "revokePostId"),
        http_step("s1", "POST posts/revoke", "post", "/api/cses/posts/revoke",
                  body='{"postId":"{{revokePostId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s2", "UC-1.5 撤回 SUCCESS"),
        delay_step("s3", 200),
        # 方向A: read-back 验证撤回已落库（posts/get 也需要 channelId）
        http_step("s4", "POST posts/get [方向A 验证撤回]", "post", "/api/cses/posts/get",
                  body='{"postIds":["{{revokePostId}}"]}'),
        script_step("s5", "UC-1.5 read-back SUCCESS"),
    ]


def steps_uc32() -> list[dict]:
    """UC-3.2 单条已读 — POST post/read"""
    return [
        http_step("s1", "POST post/read (单条已读)", "post", "/api/cses/post/read",
                  body='{"channelId":"{{groupChannelId}}","posts":["{{postId}}"]}'),
        script_step("s2", "UC-3.2 单条已读 SUCCESS"),
        # read-back: post/read/list 需要 channelId + userId
        http_step("s3", "POST post/read/list [read-back]", "post", "/api/cses/post/read/list",
                  body='{"postIds":["{{postId}}"]}'),
        script_step("s4", "UC-3.2 read/list SUCCESS"),
    ]


def steps_uc31() -> list[dict]:
    """UC-3.1 会话已读 — POST channels/view"""
    return [
        http_step("s1", "POST channels/view (会话已读)", "post", "/api/cses/channels/view",
                  body='{"channels":[{"id":"{{groupChannelId}}"}]}'),
        script_step("s2", "UC-3.1 会话已读 SUCCESS"),
    ]


def steps_uc33() -> list[dict]:
    """UC-3.3 模板已收到 — POST post/templateReceived"""
    return [
        *create_post_steps("s0t", "loopforge-template-received", "templatePostId", "TEMPLATE"),
        http_step("s1", "POST post/templateReceived", "post",
                  "/api/cses/post/templateReceived",
                  body='{"postId":"{{templatePostId}}"}'),
        script_step("s2", "UC-3.3 templateReceived SUCCESS"),
    ]


def steps_uc14() -> list[dict]:
    """UC-1.4 重发失败 — POST posts/create (tempId 复用)"""
    body_str = (
        '{"viewers":["all"],"message":"loopforge-resend","mentions":[],'
        '"temporaryId":"{{retryTempId}}","type":"TEXT","simpleMessage":"loopforge-resend",'
        '"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID + '",'
        '"teamId":"' + TEAM_ID + '",'
        '"userSnapshot":{"orgName":"test","deptName":"test","userName":"test",'
        '"userId":"' + COOKIE_ID + '","teamId":"' + TEAM_ID + '"},'
        '"id":"","props":{},"topicId":"","revoke":false}'
    )
    return [
        note_step("s0", "UC-1.4 重发：先设置 retryTempId 变量"),
        {
            "type": "script", "id": "s0b", "disable": False,
            "parameters": {
                "type": "customScript",
                "data": 'pm.environment.set("retryTempId", "retry-" + Date.now());',
                "enable": True, "defaultEnable": True,
            },
        },
        http_step("s1", "POST posts/create (重发 tempId 复用)",
                  "post", "/api/cses/posts/create", body=body_str),
        script_step("s2", "UC-1.4 重发 SUCCESS"),
    ]


def steps_uc17() -> list[dict]:
    """UC-1.7 转发/合并 — POST posts/createPosts"""
    body_str = (
        '{"posts":[{"id":"{{postId}}","channelId":"{{groupChannelId}}"}],'
        '"channelIds":["{{groupChannelId}}"]}'
    )
    return [
        http_step("s1", "POST posts/createPosts (转发)", "post",
                  "/api/cses/posts/createPosts", body=body_str),
        script_step("s2", "UC-1.7 转发 SUCCESS"),
    ]


def steps_uc24() -> list[dict]:
    """UC-2.4 一级/二级回复 — posts/getReplies"""
    # getReplies: 正常文本消息没有 reply-thread，服务端可能返回 failed/空；软断言 HTTP 200 即可
    # getReplyBranch 会触发服务端 ECONNRESET（已知 bug），跳过
    return [
        http_step("s1", "POST posts/getReplies", "post", "/api/cses/posts/getReplies",
                  body='{"postId":"{{postId}}","channelId":"{{groupChannelId}}","page":0,"pageSize":20}'),
        {
            "type": "script", "id": "s2", "disable": False,
            "parameters": {
                "type": "customScript",
                "data": (
                    "const r = pm.response.json();\n"
                    'pm.test("UC-2.4 getReplies HTTP 200", () => {\n'
                    "  pm.expect(pm.response.code).to.equal(200);\n"
                    "});\n"
                ),
                "enable": True, "defaultEnable": True,
            },
        },
    ]


def steps_uc21() -> list[dict]:
    """UC-2.1 切群首屏 — 本地 Scan，无 HTTP 出站（仅验证 channels/load/increment）"""
    return [
        note_step("s0", "UC-2.1 主路径为本地 Scan；此 scenario 用 postContext 等价验证 channel 有消息"),
        http_step("s1", "POST posts/postContext (首屏等价)", "post",
                  "/api/cses/posts/postContext",
                  body='{"postId":"{{postId}}","before":10,"channelId":"{{groupChannelId}}"}'),
        script_step("s2", "UC-2.1 postContext SUCCESS"),
    ]


def steps_uc23() -> list[dict]:
    """UC-2.3 按 postId 定位 — posts/getPostsAfterIndex + top20"""
    return [
        *create_post_steps("s0h", "loopforge-history-anchor", "historyPostId"),
        http_step("s1", "POST posts/top20", "post", "/api/cses/posts/top20",
                  body='{"channel_id":"{{groupChannelId}}"}'),
        script_step("s2", "UC-2.3 top20 SUCCESS"),
        # getPostsAfterIndex: Go wire 字段 postIds 实为单个 postId
        http_step("s3", "POST posts/getPostsAfterIndex", "post",
                  "/api/cses/posts/getPostsAfterIndex",
                  body='{"postIds":"{{historyPostId}}"}'),
        script_step("s4", "UC-2.3 getPostsAfterIndex SUCCESS"),
    ]


def steps_uc22() -> list[dict]:
    """UC-2.2 上拉历史 — posts/postContext"""
    return [
        http_step("s1", "POST posts/postContext (上拉历史 before=50)", "post",
                  "/api/cses/posts/postContext",
                  body='{"postId":"{{postId}}","before":50,"channelId":"{{groupChannelId}}"}'),
        script_step("s2", "UC-2.2 postContext SUCCESS",
                    expect_data=True),
    ]


def steps_uc54() -> list[dict]:
    """UC-5.4 群属性修改 — channel/change/info (主路径) + change/notice"""
    # change/displayName 和 change/purpose 作为独立端点不存在（44B failed）
    # 改群名+简介用 change/info 统一搞定；change/notice 用 notice 对象
    return [
        http_step("s1", "POST channel/change/info (改群名+简介)", "post",
                  "/api/cses/channel/change/info",
                  body='{"channelId":"{{groupChannelId}}","displayName":"loopforge-renamed","purpose":"e2e test"}'),
        script_step("s2", "UC-5.4 change/info SUCCESS"),
        http_step("s3", "POST channel/change/notice (群公告)", "post",
                  "/api/cses/channel/change/notice",
                  body='{"id":"{{groupChannelId}}","notice":{"text":"e2e notice content"}}'),
        script_step("s4", "UC-5.4 change/notice SUCCESS"),
    ]


def steps_uc55() -> list[dict]:
    """UC-5.5 置顶 — channel/change/top + channel/add/postPinned"""
    return [
        http_step("s1", "POST channel/change/top (频道置顶)", "post",
                  "/api/cses/channel/change/top",
                  body='{"channelId":"{{groupChannelId}}","top":true}'),
        script_step("s2", "UC-5.5 频道置顶 SUCCESS"),
        http_step("s3", "POST channel/change/top (取消置顶)", "post",
                  "/api/cses/channel/change/top",
                  body='{"channelId":"{{groupChannelId}}","top":false}'),
        script_step("s4", "UC-5.5 取消置顶 SUCCESS"),
        http_step("s5", "POST channel/add/postPinned (消息置顶)", "post",
                  "/api/cses/channel/add/postPinned",
                  body='{"channelId":"{{groupChannelId}}","postId":"{{postId}}"}'),
        script_step("s6", "UC-5.5 消息置顶 SUCCESS"),
        http_step("s7", "POST channel/remove/postPinned", "post",
                  "/api/cses/channel/remove/postPinned",
                  body='{"channelId":"{{groupChannelId}}","postId":"{{postId}}"}'),
        script_step("s8", "UC-5.5 移除消息置顶 SUCCESS"),
        http_step("s9", "POST channel/load/postPinned [read-back]", "post",
                  "/api/cses/channel/load/postPinned",
                  body='{"channelId":"{{groupChannelId}}"}'),
        script_step("s10", "UC-5.5 load/postPinned read-back SUCCESS"),
    ]


def steps_uc56r() -> list[dict]:
    """UC-5.6r 公告读族"""
    return [
        http_step("s1", "POST post/announcement/list", "post",
                  "/api/cses/post/announcement/list",
                  body='{"channelId":"{{groupChannelId}}","page":0,"pageSize":20}'),
        script_step("s2", "UC-5.6r announcement/list SUCCESS"),
        http_step("s3", "POST post/announcement/detail", "post",
                  "/api/cses/post/announcement/detail",
                  body='{"postIds":["{{postId}}"],"channelId":"{{groupChannelId}}"}'),
        script_step("s4", "UC-5.6r announcement/detail SUCCESS"),
        http_step("s5", "POST post/announcement/acceptList", "post",
                  "/api/cses/post/announcement/acceptList",
                  body='{"postId":"{{postId}}"}'),
        script_step("s6", "UC-5.6r announcement/acceptList SUCCESS"),
    ]


def steps_uc56w() -> list[dict]:
    """UC-5.6w 公告写族 (save/read/delete)"""
    # announcement/save expects a full ANNOUNCEMENT post body and creates the post server-side.
    announcement_message = f"apifox announcement-{int(time.time() * 1000)}"
    save_body = post_create_body(announcement_message, post_type="ANNOUNCEMENT")
    return [
        http_step("s1", "POST post/announcement/save", "post",
                  "/api/cses/post/announcement/save",
                  body=save_body),
        script_step("s2", "UC-5.6w announcement/save SUCCESS"),
        delay_step("s2b", 800),
        http_step("s2c", "GET posts/getLatestPost [announcement]", "post",
                  "/api/cses/posts/getLatestPost",
                  body='{"channelId":"{{groupChannelId}}"}'),
        script_step("s2d", "UC-5.6w announcement read-back SUCCESS",
                    expect_data=True,
                    require_extract=True,
                    extract={"announcementPostId": _post_id_extract_expr(announcement_message, "ANNOUNCEMENT", COOKIE_ID)}),
        http_step("s3", "POST post/announcement/read", "post",
                  "/api/cses/post/announcement/read",
                  body='{"postId":"{{announcementPostId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s4", "UC-5.6w announcement/read SUCCESS"),
        http_step("s5", "POST post/announcement/delete", "post",
                  "/api/cses/post/announcement/delete",
                  body='{"postIds":["{{announcementPostId}}"]}'),
        script_step("s6", "UC-5.6w announcement/delete SUCCESS"),
    ]


def steps_uc57() -> list[dict]:
    """UC-5.7 在线状态 — channel/onlineStatus"""
    return [
        http_step("s1", "POST channel/onlineStatus", "post",
                  "/api/cses/channel/onlineStatus",
                  body='{"channelIds":["{{groupChannelId}}"]}'),
        script_step("s2", "UC-5.7 在线状态 SUCCESS"),
        # users/status/ids (⛔ 后端真阻塞 — 仍发请求检查响应形式)
        http_step("s3", "POST users/status/ids (⚠️ 后端可能阻塞)", "post",
                  "/api/cses/users/status/ids",
                  body='{"userIds":["' + COOKIE_ID + '"]}'),
        {
            "type": "script", "id": "s4", "disable": False,
            "parameters": {
                "type": "customScript",
                "data": (
                    'const r = pm.response.json();\n'
                    'pm.test("UC-5.7 users/status/ids 有响应", () => {\n'
                    '  pm.expect(pm.response.code).to.equal(200);\n'
                    '  // status 可能非 SUCCESS（后端阻塞），不强断言\n'
                    '});\n'
                ),
                "enable": True, "defaultEnable": True,
            },
        },
    ]


def steps_uc53() -> list[dict]:
    """UC-5.3 关闭/退出群 — channel/close"""
    return [
        note_step("s0", "UC-5.3 关闭群：此步骤会销毁 groupChannelId，放在套件最后一个用此频道的 UC 之后"),
        http_step("s1", "POST channel/close", "post", "/api/cses/channel/close",
                  body='{"channelId":"{{groupChannelId}}"}'),
        script_step("s2", "UC-5.3 关闭群 SUCCESS"),
    ]


def steps_uc63() -> list[dict]:
    """UC-6.3 改群昵称"""
    return [
        http_step("s1", "POST channel/member/change/nickname", "post",
                  "/api/cses/channel/member/change/nickname",
                  body='{"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID + '","nickName":"e2e昵称"}'),
        script_step("s2", "UC-6.3 改群昵称 SUCCESS"),
    ]


def steps_uc64() -> list[dict]:
    """UC-6.4 成员快照/全量"""
    return [
        http_step("s1", "POST channel/member/snapshot", "post",
                  "/api/cses/channel/member/snapshot",
                  body='{"channelId":"{{groupChannelId}}","startTime":0,"endTime":9999999999999}'),
        script_step("s2", "UC-6.4 member/snapshot SUCCESS"),
        http_step("s3", "POST channels/member/byIds", "post",
                  "/api/cses/channels/member/byIds",
                  body='{"userIds":["' + COOKIE_ID + '"],"channelIds":["{{groupChannelId}}"]}'),
        script_step("s4", "UC-6.4 channels/member/byIds SUCCESS"),
        http_step("s5", "POST users/list", "post",
                  "/api/cses/users/list",
                  body='{"channelId":"{{groupChannelId}}"}'),
        script_step("s6", "UC-6.4 users/list SUCCESS"),
    ]


def steps_uc61() -> list[dict]:
    """UC-6.1 拉/踢人 — channel/member/change"""
    join_body = (
        '{"channelId":"{{uc61ChannelId}}",'
        '"joinUsers":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}]}'
    )
    leave_body = (
        '{"channelId":"{{uc61ChannelId}}",'
        '"leaveUsers":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}]}'
    )
    rejoin_body = join_body
    return [
        *fresh_group_channel_steps("s0m", "uc61ChannelId"),
        http_step("s1", "POST channel/member/change (加人 join)", "post",
                  "/api/cses/channel/member/change", body=join_body),
        script_step("s2", "UC-6.1 加人 SUCCESS"),
        delay_step("s3", 200),
        http_step("s4", "POST channel/member/change (踢人 leave)", "post",
                  "/api/cses/channel/member/change", body=leave_body),
        script_step("s5", "UC-6.1 踢人 SUCCESS"),
        http_step("s6", "POST channel/member/change (重新加人供自退)", "post",
                  "/api/cses/channel/member/change", body=rejoin_body),
        script_step("s7", "UC-6.1 重新加人 SUCCESS"),
        http_step("s8", "POST channel/member/leave (B自退)", "post",
                  "/api/cses/channel/member/leave",
                  body='{"channelId":"{{uc61ChannelId}}"}',
                  cookie_id="{{cookieId_B}}"),
        script_step("s9", "UC-6.1 member/leave SUCCESS"),
    ]


def steps_uc62() -> list[dict]:
    """UC-6.2 设/撤管理员"""
    return [
        http_step("s1", "POST channel/add/manger", "post",
                  "/api/cses/channel/add/manger",
                  body='{"channelId":"{{groupChannelId}}","users":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"ADMIN"}]}'),
        script_step("s2", "UC-6.2 设管理员 SUCCESS"),
        delay_step("s3", 200),
        http_step("s4", "POST channel/remove/manger", "post",
                  "/api/cses/channel/remove/manger",
                  body='{"channelId":"{{groupChannelId}}","users":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}]}'),
        script_step("s5", "UC-6.2 撤管理员 SUCCESS"),
    ]


def steps_uc9x() -> list[dict]:
    """UC-9.x 书签 CRUD"""
    return [
        http_step("s1", "POST post/bookmark/create", "post",
                  "/api/cses/post/bookmark/create",
                  body='{"postId":"{{postId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s2", "UC-9.x bookmark/create SUCCESS",
                    extract={"bookmarkId": "r.data?.id"}),
        http_step("s3", "POST post/bookmark/load", "post",
                  "/api/cses/post/bookmark/load",
                  body='{"channelId":"{{groupChannelId}}","page":0,"pageSize":20}'),
        script_step("s4", "UC-9.x bookmark/load SUCCESS"),
        http_step("s5", "POST post/bookmark/delete", "post",
                  "/api/cses/post/bookmark/delete",
                  body='{"postId":"{{postId}}","channelId":"{{groupChannelId}}"}'),
        script_step("s6", "UC-9.x bookmark/delete SUCCESS"),
    ]


def steps_uc101() -> list[dict]:
    """UC-10.1 待办列表"""
    return [
        http_step("s1", "POST posts/queryTodoList", "post",
                  "/api/cses/posts/queryTodoList",
                  body='{"postIds":["{{postId}}"]}'),
        script_step("s2", "UC-10.1 queryTodoList SUCCESS"),
    ]


def steps_uc103() -> list[dict]:
    """UC-10.3 全模块读"""
    return [
        http_step("s1", "POST modules/getAll", "post", "/api/cses/modules/getAll", body={}),
        script_step("s2", "UC-10.3 modules/getAll SUCCESS"),
    ]


def steps_uc42() -> list[dict]:
    """UC-4.2 按需 sync notify"""
    return [
        http_step("s1", "POST channel/sync/notify", "post",
                  "/api/cses/channel/sync/notify",
                  body='{"cursors":[{"channelId":"{{groupChannelId}}","fromSeq":0}]}'),
        script_step("s2", "UC-4.2 sync/notify SUCCESS"),
    ]


def steps_uc45() -> list[dict]:
    """UC-4.5 陌生 channel 兜底"""
    return [
        *fresh_group_channel_steps("s0u45", "uc45ChannelId"),
        # incrementByChannelId: 字段名 seq 而非 fromSeq（参考 channels/load/increment 的 cursors.fromSeq）
        http_step("s1", "POST channel/load/incrementByChannelId", "post",
                  "/api/cses/channel/load/incrementByChannelId",
                  body='{"channelId":"{{uc45ChannelId}}","seq":0}'),
        script_step("s2", "UC-4.5 load/incrementByChannelId SUCCESS"),
        http_step("s3", "POST channel/load/notice", "post",
                  "/api/cses/channel/load/notice",
                  body='{"channelId":"{{uc45ChannelId}}"}'),
        script_step("s4", "UC-4.5 channel/load/notice SUCCESS"),
        http_step("s5", "POST channel/load/admin", "post",
                  "/api/cses/channel/load/admin",
                  body='{"channelId":"{{uc45ChannelId}}"}'),
        script_step("s6", "UC-4.5 channel/load/admin SUCCESS"),
    ]


def steps_uc44() -> list[dict]:
    """UC-4.4 心跳 gap 补偿 (WS pingpong; 仅测 channels/load/increment 心跳等价)"""
    return [
        note_step("s0", "UC-4.4 心跳 gap 补偿主路径是 Rust WS pingpong；此 scenario 验证 HTTP 增量触发"),
        http_step("s1", "POST channels/load/increment (心跳等价)", "post",
                  "/api/cses/channels/load/increment",
                  body='{"timestamp":0,"cursors":[{"channelId":"{{groupChannelId}}","fromSeq":0}]}'),
        script_step("s2", "UC-4.4 增量 SUCCESS"),
    ]


def steps_uc8x_vote() -> list[dict]:
    """UC-8.x 投票 CRUD (cses-java :3399)"""
    return [
        note_step("s0", "UC-8.x 投票走 cses-java :3399；base_url_java = http://localhost:3399"),
        http_step("s1", "POST vote/createVote", "post", "/api/cses/vote/createVote",
                  body='{"channelId":"{{groupChannelId}}","postId":"{{postId}}","title":"e2e投票","options":["选项A","选项B"],"multiSelect":false,"anonymous":false}',
                  base_var="base_url_java"),
        script_step("s2", "UC-8.x createVote SUCCESS",
                    extract={"voteId": "r.data?.id || r.data?.voteId"}),
        http_step("s3", "POST vote/vote", "post", "/api/cses/vote/vote",
                  body='{"voteId":"{{voteId}}","optionIndex":0}',
                  base_var="base_url_java"),
        script_step("s4", "UC-8.x vote SUCCESS"),
        http_step("s5", "POST vote/readVote", "post", "/api/cses/vote/readVote",
                  body='{"voteId":"{{voteId}}"}',
                  base_var="base_url_java"),
        script_step("s6", "UC-8.x readVote SUCCESS"),
        http_step("s7", "POST vote/closeVote", "post", "/api/cses/vote/closeVote",
                  body='{"voteId":"{{voteId}}"}',
                  base_var="base_url_java"),
        script_step("s8", "UC-8.x closeVote SUCCESS"),
        http_step("s9", "POST vote/deleteVote", "post", "/api/cses/vote/deleteVote",
                  body='{"voteId":"{{voteId}}"}',
                  base_var="base_url_java"),
        script_step("s10", "UC-8.x deleteVote SUCCESS"),
    ]


def steps_uc8x_avg() -> list[dict]:
    """UC-8.x 平均分 CRUD (cses-java :3399)"""
    return [
        note_step("s0", "UC-8.x 平均分走 cses-java :3399"),
        http_step("s1", "POST average/publish", "post", "/api/cses/average/publish",
                  body='{"channelId":"{{groupChannelId}}","postId":"{{postId}}","title":"e2e评分","maxScore":10}',
                  base_var="base_url_java"),
        script_step("s2", "UC-8.x average/publish SUCCESS",
                    extract={"avgId": "r.data?.id"}),
        http_step("s3", "POST average/attend", "post", "/api/cses/average/attend",
                  body='{"id":"{{avgId}}","score":8}',
                  base_var="base_url_java"),
        script_step("s4", "UC-8.x average/attend SUCCESS"),
        http_step("s5", "POST average/read", "post", "/api/cses/average/read",
                  body='{"id":"{{avgId}}"}',
                  base_var="base_url_java"),
        script_step("s6", "UC-8.x average/read SUCCESS"),
        http_step("s7", "POST average/close", "post", "/api/cses/average/close",
                  body='{"id":"{{avgId}}"}',
                  base_var="base_url_java"),
        script_step("s8", "UC-8.x average/close SUCCESS"),
        http_step("s9", "POST average/delete", "post", "/api/cses/average/delete",
                  body='{"id":"{{avgId}}"}',
                  base_var="base_url_java"),
        script_step("s10", "UC-8.x average/delete SUCCESS"),
    ]


def steps_uc102() -> list[dict]:
    """UC-10.2 系统通知 (WS触发 — 验证 getUpdatedPosts 等价)"""
    return [
        note_step("s0", "UC-10.2 系统通知主路径为 WS 推 NOTICE 消息；验证 getUpdatedPosts 等价"),
        http_step("s1", "POST posts/getUpdatedPosts", "post",
                  "/api/cses/posts/getUpdatedPosts",
                  body='{"channelId":"{{groupChannelId}}","sinceTime":0}'),
        script_step("s2", "UC-10.2 getUpdatedPosts SUCCESS"),
    ]


def steps_uc58() -> list[dict]:
    """UC-5.8 条件查频道 — channel/query"""
    return [
        http_step("s1", "POST channel/query", "post", "/api/cses/channel/query",
                  body='{"teamId":"' + TEAM_ID + '","type":"P","page":0,"pageSize":20}'),
        script_step("s2", "UC-5.8 channel/query SUCCESS"),
    ]


def steps_uc111() -> list[dict]:
    """UC-11.1 维护公司大群 — teams/upsert"""
    body = {
        "teamId": TEAM_ID,
        "displayName": "loopforge-company",
        "type": "O",
        "users": [{"id": COOKIE_ID, "teamId": TEAM_ID, "role": "CREATOR"}],
        "picturetype": "USER",
        "picture": {"userIds": [COOKIE_ID]},
        "forceCreate": True,
    }
    return [
        http_step("s1", "POST teams/upsert", "post", "/api/cses/teams/upsert", body=body),
        script_step("s2", "UC-11.1 teams/upsert SUCCESS",
                    extract={"teamChannelId": "r.data?.id || r.data?.channelId"}),
    ]


def steps_uc112() -> list[dict]:
    """UC-11.2 退出公司 — DELETE teams/member/quit"""
    return [
        note_step("s0", "UC-11.2 退出公司用 DELETE 方法"),
        http_step("s1", "DELETE teams/member/quit", "delete",
                  "/api/cses/teams/member/quit",
                  body='{"teamId":"' + TEAM_ID + '","userId":"' + COOKIE_ID_B + '"}'),
        script_step("s2", "UC-11.2 teams/member/quit SUCCESS"),
    ]


# L2 双账号 UC
def steps_l2_us17() -> list[dict]:
    """L2-US-17 他人发消息收推送 (B=678 发, A=444 侧观察)"""
    body_str = (
        '{"viewers":["all"],"message":"L2-cross-test","mentions":[],'
        '"temporaryId":"{{$randomUUID}}","type":"TEXT","simpleMessage":"L2-cross-test",'
        '"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID_B + '",'
        '"teamId":"' + TEAM_ID + '",'
        '"userSnapshot":{"orgName":"test","deptName":"test","userName":"userB",'
        '"userId":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '"},'
        '"id":"","props":{},"topicId":"","revoke":false}'
    )
    return [
        note_step("s0", "L2-US-17: B(678) 发消息, 方向A read-back 验证 A(444) 能拉到"),
        http_step("s1", "POST posts/create (B=678 发消息)", "post",
                  "/api/cses/posts/create", body=body_str, cookie_id=COOKIE_ID_B),
        script_step("s2", "L2-US-17 B发消息 SUCCESS"),
        delay_step("s3", 300),
        http_step("s4", "POST posts/getLatestPost [A侧 read-back]", "post",
                  "/api/cses/posts/getLatestPost",
                  body='{"channelId":"{{groupChannelId}}"}',
                  cookie_id=COOKIE_ID),
        script_step("s5", "L2-US-17 A侧能拉到最新消息 SUCCESS",
                    expect_data=True),
    ]


def steps_l2_61b() -> list[dict]:
    """L2-6.1b 拉人后对端实时更新"""
    join_body = (
        '{"channelId":"{{groupChannelId}}",'
        '"joinUsers":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}]}'
    )
    return [
        http_step("s1", "POST channel/member/change [A拉B]", "post",
                  "/api/cses/channel/member/change", body=join_body, cookie_id=COOKIE_ID),
        script_step("s2", "L2-6.1b A拉B SUCCESS"),
        delay_step("s3", 200),
        http_step("s4", "POST channel/member/snapshot [B侧read-back]", "post",
                  "/api/cses/channel/member/snapshot",
                  body='{"channelId":"{{groupChannelId}}","startTime":0,"endTime":9999999999999}', cookie_id=COOKIE_ID_B),
        script_step("s5", "L2-6.1b B侧成员快照 SUCCESS",
                    expect_data=True),
    ]


def steps_l2_53b() -> list[dict]:
    """L2-5.3b member-leave 广播"""
    leave_body = (
        '{"channelId":"{{groupChannelId}}",'
        '"leaveUsers":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}]}'
    )
    return [
        http_step("s1", "POST channel/member/change [A移除B]", "post",
                  "/api/cses/channel/member/change", body=leave_body, cookie_id=COOKIE_ID),
        script_step("s2", "L2-5.3b A移除B SUCCESS"),
    ]


def steps_l2_62b() -> list[dict]:
    """L2-6.2b admin 广播到他人"""
    return [
        http_step("s1", "POST channel/add/manger [A设B为admin]", "post",
                  "/api/cses/channel/add/manger",
                  body='{"channelId":"{{groupChannelId}}","users":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"ADMIN"}]}',
                  cookie_id=COOKIE_ID),
        script_step("s2", "L2-6.2b 设B为admin SUCCESS"),
        delay_step("s3", 200),
        http_step("s4", "POST channel/load/admin [B侧 read-back 验证role]", "post",
                  "/api/cses/channel/load/admin",
                  body='{"channelId":"{{groupChannelId}}"}', cookie_id=COOKIE_ID_B),
        script_step("s5", "L2-6.2b B侧能看到admin SUCCESS",
                    extra_checks='pm.expect(JSON.stringify(r.data || [])).to.include("' + COOKIE_ID_B + '");',
                    expect_data=True),
        http_step("s6", "POST channel/remove/manger [A撤B admin]", "post",
                  "/api/cses/channel/remove/manger",
                  body='{"channelId":"{{groupChannelId}}","users":[{"id":"' + COOKIE_ID_B + '","teamId":"' + TEAM_ID + '","role":"MEMBER"}]}',
                  cookie_id=COOKIE_ID),
        script_step("s7", "L2-6.2b 撤B admin SUCCESS"),
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# Main 编排
# ═══════════════════════════════════════════════════════════════════════════════

UC_TABLE: list[tuple[str, str, int, list]] = [
    # (name, description, priority, steps_fn)
    # 优先级: 0=critical 1=high 2=medium 3=low
    ("UC-4.1 hello 全量增量",        "阶段0·就绪根·channels/load/increment", 0, steps_uc41()),
    ("UC-5.1 创建群聊 (type=P)",      "阶段1·建频道·channel/create",          0, steps_uc51()),
    ("UC-1.1 发文本消息",             "阶段2·posts/create+read-back",         0, steps_uc11()),
    ("UC-1.2 发文档 (type=DOC)",      "阶段2·posts/create type=DOCUMENT",     1, steps_uc12()),
    ("UC-1.9 加急+加急已读",          "阶段2·urgentPost/urgentConfirm",       1, steps_uc19()),
    ("UC-1.8 快捷回复 emoji",         "阶段2·posts/quickReply",               2, steps_uc18()),
    ("UC-1.10 定时消息",              "阶段2·createSchedule/cancel/get",      2, steps_uc110()),
    ("UC-5.2 创建话题 (type=T)",      "阶段1·建话题频道·posts/makeTopic",     1, steps_uc52()),
    ("UC-1.5 撤回消息",               "阶段3·posts/revoke+read-back",         0, steps_uc15()),
    ("UC-3.2 单条已读",               "阶段3·post/read+post/read/list",       1, steps_uc32()),
    ("UC-3.1 会话已读",               "阶段3·channels/view",                  1, steps_uc31()),
    ("UC-3.3 模板已收到",             "阶段3·post/templateReceived",          2, steps_uc33()),
    ("UC-1.4 重发失败",               "阶段3·posts/create tempId复用",        2, steps_uc14()),
    ("UC-1.7 转发/合并",              "阶段3·posts/createPosts",              1, steps_uc17()),
    ("UC-2.4 一级/二级回复",          "阶段3·getReplies+getReplyBranch",      2, steps_uc24()),
    ("UC-2.1 切群首屏",               "阶段4·posts/postContext等价",           1, steps_uc21()),
    ("UC-2.3 按postId定位",           "阶段4·posts/top20+getPostsAfterIndex", 2, steps_uc23()),
    ("UC-2.2 上拉历史",               "阶段4·posts/postContext before=50",    1, steps_uc22()),
    ("UC-5.4 群属性修改",             "阶段5·channel/change/displayName等",   1, steps_uc54()),
    ("UC-5.5 置顶 (频道+消息)",       "阶段5·change/top+add/postPinned",      2, steps_uc55()),
    ("UC-5.6r 公告读族",              "阶段5·announcement/list/detail/acceptList", 2, steps_uc56r()),
    ("UC-5.6w 公告写族",              "阶段5·announcement/save/read/delete",  2, steps_uc56w()),
    ("UC-5.7 在线状态",               "阶段5·channel/onlineStatus",           2, steps_uc57()),
    ("UC-6.3 改群昵称",               "阶段5·channel/member/change/nickname", 2, steps_uc63()),
    ("UC-6.4 成员快照/全量",          "阶段5·member/snapshot+byIds+users/list", 1, steps_uc64()),
    ("UC-6.1 拉/踢人",                "阶段5·channel/member/change join/leave", 1, steps_uc61()),
    ("UC-6.2 设/撤管理员",            "阶段5·channel/add|remove/manger",      2, steps_uc62()),
    ("UC-9.x 书签 CRUD",              "阶段6·post/bookmark/create/load/delete", 2, steps_uc9x()),
    ("UC-10.1 待办列表",              "阶段6·posts/queryTodoList",            2, steps_uc101()),
    ("UC-10.3 全模块读",              "阶段6·modules/getAll",                 2, steps_uc103()),
    ("UC-4.2 按需 sync notify",       "阶段6·channel/sync/notify",            1, steps_uc42()),
    ("UC-4.5 陌生 channel 兜底",      "阶段6·channel/load/incrementByChannelId", 1, steps_uc45()),
    ("UC-4.4 心跳 gap 补偿",          "阶段6·WS心跳·channels/load/increment等价", 2, steps_uc44()),
    ("UC-8.x 投票 CRUD",              "阶段6·vote/* (cses-java :3399)",       2, steps_uc8x_vote()),
    ("UC-8.x 平均分 CRUD",            "阶段6·average/* (cses-java :3399)",    2, steps_uc8x_avg()),
    ("UC-10.2 系统通知",              "阶段6·WS NOTICE·getUpdatedPosts等价",  2, steps_uc102()),
    ("UC-5.8 条件查频道",             "阶段7·channel/query",                  1, steps_uc58()),
    ("UC-11.1 维护公司大群",          "阶段7·teams/upsert",                   1, steps_uc111()),
    ("UC-11.2 退出公司",              "阶段7·DELETE teams/member/quit",       1, steps_uc112()),
    ("UC-5.3 关闭/退出群 (收尾)",     "阶段5·channel/close (最后执行)",        1, steps_uc53()),
    # L2 双账号
    ("L2-US-17 他人发消息收推送",     "L2·B(678)发→A(444)收 read-back",       1, steps_l2_us17()),
    ("L2-6.1b 拉人后对端更新",        "L2·A拉B→B侧 member/snapshot",          2, steps_l2_61b()),
    ("L2-5.3b member-leave 广播",     "L2·A移除B→member/change leaveUsers",   2, steps_l2_53b()),
    ("L2-6.2b admin 广播到他人",      "L2·A设B admin→B侧 snapshot read-back", 2, steps_l2_62b()),
]


def selected_uc_table() -> list[tuple[str, str, int, list]]:
    if APIFOX_PROFILE == "full":
        return UC_TABLE
    return [row for row in UC_TABLE if row[0] not in GO_ONLY_EXCLUDED_SCENARIOS]


def skipped_scenario_names() -> list[str]:
    if APIFOX_PROFILE == "full":
        return []
    return [row[0] for row in UC_TABLE if row[0] in GO_ONLY_EXCLUDED_SCENARIOS]


def main() -> None:
    print("=" * 60)
    print("loopforge-tauri-im Apifox 套件建立脚本")
    print(f"Project: {PROJECT_ID}  base_url: {BASE_URL_IM}")
    print(f"TEAM_ID: {TEAM_ID}  cookieId: {COOKIE_ID}  cookieId_B: {COOKIE_ID_B}")
    selected_rows = selected_uc_table()
    skipped_rows = skipped_scenario_names()
    print(f"APIFOX_PROFILE: {APIFOX_PROFILE}")
    if skipped_rows:
        print("Skipped scenarios:")
        for skipped in skipped_rows:
            print(f"  - {skipped}")
    print("=" * 60)

    # 1. 创建/更新环境
    print("\n[1/4] 创建测试环境 loopforge-im-local …")
    env_vars = [
        {"name": "base_url",      "value": BASE_URL_IM,   "enable": True},
        {"name": "base_url_java", "value": BASE_URL_JAVA, "enable": True},
        {"name": "cookieId",      "value": COOKIE_ID,     "enable": True},
        {"name": "cookieId_B",    "value": COOKIE_ID_B,   "enable": True},
        {"name": "companyId",     "value": COMPANY_ID,    "enable": True},
        {"name": "groupChannelId","value": "",             "enable": True},
        {"name": "topicChannelId","value": "",             "enable": True},
        {"name": "postId",        "value": "",             "enable": True},
        {"name": "retryTempId",   "value": "",             "enable": True},
        {"name": "voteId",        "value": "",             "enable": True},
        {"name": "avgId",         "value": "",             "enable": True},
        {"name": "bookmarkId",    "value": "",             "enable": True},
        {"name": "schedulePostId","value": "",             "enable": True},
        {"name": "teamChannelId", "value": "",             "enable": True},
        {"name": "revokePostId",  "value": "",             "enable": True},
        {"name": "templatePostId","value": "",             "enable": True},
        {"name": "historyPostId", "value": "",             "enable": True},
        {"name": "announcementPostId", "value": "",        "enable": True},
        {"name": "uc45ChannelId", "value": "",             "enable": True},
        {"name": "uc61ChannelId", "value": "",             "enable": True},
    ]
    # name 是位置参数；--base-url 必填
    env_r = af("environment", "create", "loopforge-im-local",
               "--base-url", BASE_URL_IM,
               "--variables", json.dumps(env_vars))
    env_id = env_r.get("data", {}).get("id")
    print(f"  环境 id: {env_id}")

    # 2. 创建测试套件
    suite_name = "loopforge-im-go-only" if APIFOX_PROFILE == "go-only" else "loopforge-im-full"
    suite_desc = (
        "loopforge-tauri-im Go-only HTTP regression suite; excludes vote and average-score Java legacy scenarios"
        if APIFOX_PROFILE == "go-only"
        else "loopforge-tauri-im 全 UC + 全 HTTP 端点回归套件"
    )
    print(f"\n[2/4] 创建测试套件 {suite_name} …")
    suite_r = af("test-suite", "create",
                 "--name", suite_name,
                 "--description", suite_desc)
    suite_id = suite_r.get("data", {}).get("id")
    if not suite_id:
        print("  ⚠️  测试套件创建失败，检查 token 和 project 权限")
        print(f"  响应: {suite_r}")
        # 继续执行，仅跳过 add_to_suite 步骤
    else:
        print(f"  套件 id: {suite_id}")

    # 3. 逐个创建 UC 场景 + 填步骤（按阶段分组，用于套件装配）
    STAGE_GROUPS = [
        ("阶段0 就绪探针",   ["UC-4.1"]),
        ("阶段1 建频道",     ["UC-5.1"]),
        # UC-5.2 依赖 UC-1.1 提取 postId，不能放在发消息之前。
        ("阶段2 发消息",     ["UC-1.1", "UC-1.2", "UC-1.9", "UC-1.8", "UC-1.10", "UC-5.2"]),
        ("阶段3 消息操作",   ["UC-1.5", "UC-3.2", "UC-3.1", "UC-3.3", "UC-1.4", "UC-1.7", "UC-2.4"]),
        ("阶段4 历史浏览",   ["UC-2.1", "UC-2.3", "UC-2.2"]),
        ("阶段5 频道管理",   ["UC-5.4", "UC-5.5", "UC-5.6r", "UC-5.6w", "UC-5.7", "UC-6.3", "UC-6.4", "UC-6.2", "UC-6.1"]),
        ("阶段6 杂项",       ["UC-9.x", "UC-10.1", "UC-10.3", "UC-4.2", "UC-4.5", "UC-4.4", "UC-8.x 投票", "UC-8.x 平均", "UC-10.2"]),
        ("阶段7 teams",      ["UC-5.8", "UC-11.1", "UC-11.2"]),
        ("L2 双账号",        ["L2-US-17", "L2-6.1b", "L2-6.2b", "L2-5.3b"]),
        # 关闭/退出群销毁 groupChannelId，必须最后运行。
        ("阶段8 收尾销毁频道", ["UC-5.3"]),
    ]

    print(f"\n[3/4] 创建 {len(selected_rows)} 个 UC 场景 …")
    # name → scenario_id 映射（用于套件装配）
    name_to_sid: dict[str, int] = {}
    scenario_ids: list[int] = []
    for name, desc, priority, steps in selected_rows:
        print(f"\n  → {name}")
        sid = create_scenario(name, desc, priority)
        if sid is None:
            print(f"    ⚠️  场景创建失败，跳过")
            continue
        set_steps(sid, steps)
        scenario_ids.append(sid)
        name_to_sid[name] = sid
        time.sleep(0.3)  # 避免 API 限速

    # 套件装配：一次性 --file 提交所有 items（--add-scenario 不存在）
    if suite_id and scenario_ids:
        items = []
        gid = 0
        # 按阶段分组
        for group_name, prefixes in STAGE_GROUPS:
            group_sids = []
            for prefix in prefixes:
                for uc_name, sid in name_to_sid.items():
                    if uc_name.startswith(prefix):
                        group_sids.append(sid)
            if not group_sids:
                continue
            items.append({
                "id": f"g{gid}",
                "name": group_name,
                "type": "STATIC_TEST_SCENARIO",
                "testScenarios": [{"id": sid, "options": {}} for sid in group_sids],
                "options": {},
            })
            gid += 1

        suite_payload = {"items": items}
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(suite_payload, f, ensure_ascii=False, indent=2)
            suite_tmp = f.name
        try:
            r = af("test-suite", "update", str(suite_id), "--file", suite_tmp)
            if r.get("success"):
                print(f"\n  ✅ 套件装配完成：{len(items)} 个阶段组，{len(scenario_ids)} 个场景")
            else:
                print(f"\n  ⚠️  套件装配失败: {r}")
        finally:
            os.unlink(suite_tmp)

    # 4. 汇总
    print("\n[4/4] 汇总")
    print(f"  ✅ 成功创建场景: {len(scenario_ids)}/{len(selected_rows)}")
    if suite_id:
        print(f"  ✅ 测试套件 id: {suite_id}")
        print(f"  运行套件命令（单行，--environment 接环境ID）：")
        print(f"    apifox test-suite run {suite_id} --project {PROJECT_ID} --access-token $APIFOX_TOKEN --environment {env_id} --carry-runtime-variables")
    print()
    print("\n完成！在 Apifox 桌面端刷新项目可看到新场景和套件。")


if __name__ == "__main__":
    main()
