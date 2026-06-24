---
id: C007
title: Angular 模板加 (event) 必同步加组件方法（否则 ng serve 编译挂·run 假死）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
改 `src/app/**/*.ts` 内联模板加 `(click)=`/`(input)=` 等事件绑定或 `[attr.*]` 引用 / run.sh live 卡住无四面输出 / ng serve 报 `TSxxxx Property 'X' does not exist`。

## §2 背景（why）
2026-06-24 UC-1.2：模板加了 `(click)="onSendDocument()"` 但忘加组件方法 → ng serve `Application bundle generation failed TS2339: Property 'onSendDocument' does not exist` → 前端 bundle 坏 → 页面不渲染 → wdio 等元素 8min 超时假死（run.sh 无四面输出）。Angular 内联模板的事件/属性引用是**编译期强校验**，缺方法/字段直接 fail。

## §3 Required / Forbidden
✅ 模板加 `(evt)="fn()"` → 同改同文件组件类加 `fn()` 方法；加 `[attr.x]="m.y"` → MessageRow/model 有 `y` 字段。
✅ live 跑前先看 `/tmp/loopforge/run-ng.log` 有无 TS 编译错（卡住先查这里，别干等）。
❌ 只改模板不改组件类 / model。
❌ run.sh 卡住就盲等满超时——先 grep ng 编译错。

## §4 Verification
- 改完前端跑 `pnpm exec ng build --configuration development` 或起 `pnpm start` 看无 TSxxxx。
- live 卡住时：`grep -iE "error|TS[0-9]|bundle generation failed" /tmp/loopforge/run-ng.log` 应空。
- `grep -oE '\(click\)="[a-zA-Z]+' src/app/app.component.ts` 的每个方法名在组件类有定义。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | bd03f7b | run.sh 8min 假死无四面输出 | 模板 onSendDocument 无组件方法·ng TS2339 |

## §6 关联
- 上游：CLAUDE.md §1 前端薄壳
- 兄弟卡：C003（live 验证）
- 下游：每个 UC 的最简 UI 接线（都改 Angular 模板）

## §7 历史与演进
- drafting→active：2026-06-24 commit bd03f7b
