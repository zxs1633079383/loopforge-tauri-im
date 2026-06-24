# Spec — 竖切 #1：发消息 round-trip（walking skeleton）

> 目标：用**一个 UC** 打通整台机器——四面契约断言 + Recording 装饰器录放 + 领域键认领 + JSONL/reducer + 自动修复闭环。竖切通过 = 后续按 UC 顺序铺开的地基。
> 真源：helix `projection-schema.md`（②）· `真机curl真源.md`（①）· `sync-v2-能力与缺口状态.md`（这条已 8/8 wire-correct）。

---

## 1. UC 定义

**UC-send-1**：用户在频道输入框打字 → 点发送 → 消息以 temporaryId 乐观上屏 → echo 回流后 server_id 覆写。

链路（七跳）：
```
UI 输入+点击
 → invoke im_send({channelId, text, temporaryId})          [前端→Tauri]
 → helix 出站 HTTP POST（body 对齐真机curl真源）            [facet ① outbound]
 → go 处理 → WS 广播 action="post" 帧（event_seq）          [facet WsRecv 输入]
 → parser 认 "post" → gate apply（cursor+1）
 → reconcile_post_echo：tmp_id → server_id 覆写
 → Storage 落 message 行（id=server_id, read_bits…）        [facet ④ storage]
 → EventSink emit 投影（im:__bus__，message_item_data）     [facet ② projection]
 → 前端薄壳渲染 <div data-msg-id data-send-status …>        [facet ③ DOM]
```

---

## 2. 四面契约（oracle）

| 面 | 抓取点 | 期望来源 | 关键断言 |
|---|---|---|---|
| ① 出站命令体 | Transport/Http 装饰器 | `真机curl真源.md` 的 send curl | method+url+body 逐字对齐；body 含 channelId/text/temporaryId；**不是 Pulsar 兜底** |
| ② 投影 envelope | EventSink 装饰器 | `projection-schema.md` 的 `message_item_data` 工厂字段集 | 字段集完全一致（缺/多即 fail）；命名陷阱（`createAt` 非 createdAt 等） |
| ③ DOM | WebdriverIO 读 | 本 spec data-* 契约（§4） | 乐观行 data-send-status=sending → echo 后 data-msg-id 从 tmp 变 server、status=sent |
| ④ DB 落库行 | Storage 装饰器 / 查库 | 本 spec（§5） | message 表 1 行：id=server_id、temporary_id=tmp、read_bits 预置、cursor 推进 |

任一面偏离即 fail；reducer 用同一 corr_key（`ch=..;tmp=..;sid=..;seq=..`）把四面聚成一束，diff 出「断在哪一跳」。

---

## 3. 认领（L1 串行 + 静默窗口）

1. **就绪 probe**（开跑前必过）：`increment_channel_end` 收齐 **且** HTTP inflight==0 **且** cursor 稳。
2. probe 通过 → `ctx.set_uc("UC-send-1")` 开窗口。
3. 窗口内 send → echo 整束帧/投影归 UC-send-1；窗口外（别人消息/increment 残留）归 `__quiescence__`。
4. 领域键绑四面：发送 body 的 `temporaryId` ↔ echo 帧的 `temporaryId`+`id`(server) ↔ 投影的 id ↔ DOM 的 data-msg-id。

---

## 4. DOM 契约（薄壳渲染，data-* 直映投影）

消息行（语义最小集，不追组件保真）：
```html
<div class="msg"
     data-msg-id="{server_id || temporaryId}"
     data-temporary-id="{temporaryId}"
     data-channel-id="{channelId}"
     data-event-seq="{eventSeq}"
     data-send-status="{sending|sent|failed}"
     data-read-bits="{readBits}">{text}</div>
```
- 乐观插入：`data-msg-id=temporaryId`、`data-send-status=sending`。
- echo 覆写：`data-msg-id` 改为 `server_id`、`data-send-status=sent`、补 `data-event-seq`。
- WebdriverIO 选择器锚 `[data-temporary-id="..."]`（贯穿乐观→覆写不变）。

---

## 5. invoke / emit 契约（前端 ↔ Tauri）

- **invoke**：`im_send({ channelId: string, text: string, temporaryId: string }) -> Result<(), string>`（薄壳生成 temporaryId）。
- **listen**：单总线 `im:__bus__`，payload 含投影 envelope（`projection`/`signal`/`control` 三类）；薄壳按 `message_item_data` 渲染/覆写。
- 命名/形态对齐现网 cses-client 总线契约（见 helix `projection-schema.md`）。

---

## 6. 双轨执行

- **Record（建金标帧）**：`HELIX_DEVICE_ID=<真实设备>` 连真 go，跑 UC-send-1 一次 → Recording(Record) 录「echo 帧 + 时钟 + id」→ `ctx.save_tape("tests/fixtures/uc-send-1.tape.json")`。**人审 tape 后冻结（只读）**。
- **Replay（日常闭环·确定性）**：Recording(Replay) 喂 tape → 经真实 Tauri+WKWebView+WebdriverIO 跑 → 四面断言。秒级、无网络、无 go flaky。

---

## 7. e2e 大纲（WebdriverIO，直连 4445 内嵌 webdriver）

```
before: 等就绪 probe（轮询某 data-ready 标志 = increment_end+inflight0+cursor稳）
it("UC-send-1 发消息 round-trip"):
  1. set_uc("UC-send-1")（经一个 debug-only invoke 或 query 注入）
  2. 输入框填 text，点发送
  3. 断言③: 立刻出现 [data-temporary-id=t] 且 data-send-status=sending
  4. 等 echo: waitUntil [data-temporary-id=t] 的 data-send-status=sent 且 data-msg-id≠t
  5. 读 run.jsonl → reducer 聚 corr_key → 断言①②④:
     - ① outbound body == 真机curl真源 send（关键字段）
     - ② projection 字段集 == projection-schema message_item_data
     - ④ storage hop 有 message 落行（op=batch_upsert table=message）
  6. reducer 出「断在哪一跳」报告（绿=四面齐）
```

---

## 8. 通过判据

- 四面全绿：① body 对齐 / ② 投影字段集一致 / ③ DOM tmp→server 覆写 / ④ message 落行 + cursor 推进。
- Replay 确定性：同 tape 重跑 N 次结果一致（守 HX-C011 可证伪）。
- reducer 报告无「断点」。
- 绿 → 竖切通过 → 解锁「按 UC 顺序铺开」（issue W-rollout）。

---

## 9. 实现工作流（并行可拆，见 issues W1–W4）

- **W1 src-tauri**：内嵌 helix 引擎 + 组装根 debug 构建包 Recording 装饰器 + tauri-plugin-webdriver + `im_send` 命令 + `im:__bus__` emit 桥 + 就绪 probe 标志。
- **W2 前端薄壳**：Angular 语义 DOM + Tauri bridge（invoke/listen）+ WebdriverIO 接线（抄 chat-virtual-demo 的 wdio.conf）。
- **W3 测试**：四面 reducer（读 JSONL + DOM）+ send-message e2e spec + 四面期望文件 + corr_key 领域规则。
- **W4 harness**：金标帧 record/replay 脚本 + run/dev-loop 脚本（pnpm 1420 + cargo debug 4445 + wdio）。
