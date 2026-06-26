# Phase 0b — 6 面 oracle 扩展（验证边界 · test-only）

> 2026-06-26 grilling 拍板。当前四面 oracle **纯输出侧**断言，输入侧（IPC-in / helix-in）零埋点。
> 本扩展把验证边界补成「6 面 + WsRecv 断言化 + 纯壳不变量」，是 B/A2 两条流水线共用的绿灯裁判，
> **排在校正数字之后、迁移 loop 之前**。**全部 test-only**，dev/release 零影响（守 invariant #1/#4）。

---

## 1. 现状（代码核实 · 2026-06-26）

`crates/helix-driver-instrument/src/event.rs` 的 `Facet` = {Outbound, Projection, Storage, WsRecv}；
`Hop` = {WsSend, HttpReq, HttpResp, WsRecv, Projection, Storage, Lifecycle}。reducer 映射：

| seam | 现状 | 断言? |
|---|---|---|
| helix outbound（HTTP body / WS send） | `Facet::Outbound` vs 真机curl真源 | ✅ |
| HTTP+WS push 入站（go echo） | `Facet::WsRecv` | ⚠️ 只观测串 corr_key·**不断言** |
| **loopforge IPC 输入**（invoke command+args） | **无埋点** | ❌ |
| **helix inbound**（command 进 run_engine_loop） | **无埋点** | ❌ |
| ② projection envelope | `Facet::Projection` vs projection-schema | ✅ |
| ④ storage 落库 | `Facet::Storage` {op,table,rows} | ✅ |
| ③ DOM data-* | e2e 注入 | ✅ |

**承重缺口**：C013「纯渲染壳·壳零业务逻辑」要机器证明「壳没在 invoke→helix 之间加工」，必须断言 **IPC-in 的 command/args ≡ helix-in 收到的 command/args**。两个面都没埋 → 现在只能验「helix 吐对了」，验不了「壳透传纯度」——而那正是 B 迁移的验收标准本身。

---

## 2. 新增（4 项 · 全 test-only）

| 新增 | 落点 | test-only 闸 | 合规 |
|---|---|---|---|
| **⓪ `Facet::IpcIn`** + `Hop::IpcIn`，tee invoke `{command, args}` | `src-tauri` command 层 | `#[cfg(debug_assertions)]` / 同 webdriver feature | 壳侧·不碰 helix 引擎（守 #1） |
| **`Facet::Inbound`** + `Hop::Inbound`，tee 进引擎的 command | `helix-driver-instrument` 新装饰器包 command-dispatch port | 仅 debug 组装根包一层 | 唯一新缝=port 装饰器（守 C001/#1） |
| **WsRecv 断言化**：加 expected 入站帧面 | reducer + `test/expect/*.json` 加一面 | 纯测试期工具 | 破坏即 fail（守 C008/#5 可证伪） |
| **纯壳不变量**：`IpcIn.args ≡ Inbound.args`（壳零加工） | reducer 新规则 | 纯测试期 | 直接量化 C013 第二北极星 |

**为什么 test-only 不影响 dev**：dev 跑普通 `pnpm start` + dev app **根本不挂 instrument crate**（只在 debug 组装根包一层）；IpcIn tee 走 `cfg(debug_assertions)`/feature 闸 release 不编入；WsRecv 断言 + 纯壳不变量是 reducer（独立 node 工具·不在进程内）。6 面只在跑 e2e / golden-tape 时存在。

---

## 3. 6 面 ↔ facet/hop ↔ 断言对象

```
⓪ IpcIn      facet=ipc-in    hop=ipc-in     {command,args}   断言: 用户动作→正确指令发射
   Inbound   facet=inbound   hop=inbound    {command,args}   断言: 壳→helix 透传（IpcIn≡Inbound 纯壳不变量）
① Outbound   facet=outbound  hop∈{http-req,ws-send}          断言: vs 真机curl真源
   WsRecv    facet=ws-recv   hop∈{ws-recv,http-resp}         断言(新): vs expected 入站帧 + 串 corr_key
② Projection facet=projection hop=projection {event,data}    断言: vs projection-schema
④ Storage    facet=storage   hop=storage   {op,table,rows}   断言: 落库行
③ DOM        (e2e 注入·非 JSONL)            data-*           断言: 终态 data-* ≡ 投影字段
```

**纯壳不变量（C013 量化）**：同 corr_key 束内 `IpcIn.args` 与 `Inbound.args` 经归一后**逐字段相等**（壳只能透传 args + 1:1 绑定，禁中间 shaping）。不等 → 该 UC fail + reducer 指出「壳在 IPC→helix 之间加工了字段 X」。这把第二北极星从「禁区 grep 静态闸」升级成「运行时可证伪断言」。

---

## 4. 验收

- `cargo nextest run -p helix-driver-instrument`（新 facet 序列化/装饰器单测）PASS。
- reducer 自测（`test/reducer/four-facet-reducer.test.mjs` 扩成 6 面）PASS：含可证伪对偶（IpcIn≠Inbound 时必 fail）。
- 现有 40+ spec 回归不掉绿（6 面对旧 UC 是叠加面·不破坏既有四面）。
- dev 路径零影响验证：`pnpm start` + dev app 构建产物**不含** ipc-in tee 符号（`nm`/feature gate 验证）。
