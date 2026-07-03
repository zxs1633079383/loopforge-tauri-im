//! helix-driver-instrument —— 仪表层装饰器（唯一新缝）。
//!
//! 核心一句话：四面要看的每一面都已是 helix 的一个 port，仪表化 = 用 **Decorator 模式**
//! 把现有 port trait 包一层（`Recording<P>`），一处干三件事：**日志 / 金标帧录制 / 回放注入**。
//! helix-core / helix-im / helix-driver-native **零改**（守 HX-C001 sans-IO）。
//!
//! ```text
//! 面/职责                         port            Recording<P> 干什么
//! ① 出站命令体 + 录/放 go 帧       Transport       Live 透传真 go + tee 日志；Record 旁路存 tape；Replay 从 tape 供
//! ① 出站 HTTP body + 录/放 resp    HttpRequester   同上（请求-响应）
//! ② 投影 envelope                  EventSink       tee 日志（emit 抵达 Tauri 之前抓到）
//! ④ DB 落库行                      Storage         tee 日志（所有模式都真写本地库）
//! 回放确定性                       Clock/IdSource  Record 录时钟/id；Replay 喂录好的，helix 才能字节级复现
//! ③ DOM                            （非 port）     WebdriverIO ↔ tauri-plugin-webdriver（不在本 crate）
//! ```
//!
//! 组装根（testbed src-tauri，仅 debug 构建）把真实 port 用 `Recording` 包一层再交给 engine；
//! production 交裸 port。
//!
//! ## 三种模式
//! - [`Mode::Live`]：透传真 go + tee 日志（日常开发跑真 go）。
//! - [`Mode::Record`]：透传真 go + tee 日志 + 旁路把「go 帧 + 时钟 + id」录进 [`Tape`]。
//! - [`Mode::Replay`]：不碰网络，出站只 tee 日志（facet ① 仍可断言），入站/响应/时钟/id 全从 [`Tape`] 供。
//!
//! ## 集成提示（src-tauri 组装根）
//! helix-driver-host 的泛型引擎对投影面用的是 `BatchSink`（driver-host 本地 trait），
//! 而本 crate 装饰的是 core 的 [`ports::EventSink`](helix_core::ports::EventSink)。
//! 组装根需确保投影 emit 路由经过被装饰的 `EventSink`；若引擎只认 `BatchSink`，
//! 在 src-tauri 侧补一个 `BatchSink` 同款装饰（driver-host 关注点，非本 crate 职责）。

pub mod blob;
pub mod clock;
pub mod ctx;
pub mod event;
pub mod event_sink;
pub mod http;
pub mod id;
pub mod log_sink;
pub mod recording;
pub mod storage;
pub mod tape;
pub mod transport;
pub mod util;

pub use ctx::{InstrumentCtx, HTTP_FAIL_ONCE_URL_SUFFIX_ENV};
pub use event::{Facet, Hop, HopEvent};
pub use log_sink::LogSink;
pub use mode::Mode;
pub use recording::Recording;
pub use tape::Tape;

pub mod mode {
    //! 录放模式。
    use serde::{Deserialize, Serialize};

    #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub enum Mode {
        /// 透传真 go + 打日志，不录不放。
        Live,
        /// 透传真 go + 打日志 + 旁路录 tape（go 帧 + 时钟 + id）。
        Record,
        /// 不碰网络：出站只打日志（facet ① 仍可断言），入站/响应/时钟/id 从 tape 供。
        Replay,
    }
}
