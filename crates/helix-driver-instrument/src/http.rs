//! `HttpRequester` 装饰器 —— facet ①（出站 HTTP body）+ 响应录放。
//!
//! - Live/Record：tee 请求(facet①) + 透传真 go；Record 存响应进 tape。
//! - Replay：tee 请求(facet①) + 从 tape 供响应（不碰网络）。

use async_trait::async_trait;
use helix_core::effect::{HttpRequest, HttpResponse};
use helix_core::ports::HttpRequester;
use helix_core::PortError;

use crate::event::{Facet, Hop};
use crate::mode::Mode;
use crate::recording::Recording;
use crate::util::payload_from_bytes;

fn req_key(req: &HttpRequest) -> String {
    format!("{} {}", req.method, req.url)
}

fn req_payload(req: &HttpRequest) -> serde_json::Value {
    serde_json::json!({
        "method": req.method,
        "url": req.url,
        "headers": req.headers,
        "body": req.body.as_ref().map(|b| payload_from_bytes(b)),
    })
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl<H: HttpRequester> HttpRequester for Recording<H> {
    async fn request(&self, req: HttpRequest) -> Result<HttpResponse, PortError> {
        // facet ① 出站命令体：所有模式都 tee。
        self.ctx.log(Facet::Outbound, Hop::HttpReq, req_payload(&req));
        let key = req_key(&req);

        match self.ctx.mode() {
            Mode::Replay => {
                let resp = self.ctx.with_tape(|t| t.next_http(&key));
                match resp {
                    Some(r) => {
                        self.ctx.log(
                            Facet::WsRecv,
                            Hop::HttpResp,
                            serde_json::json!({"status": r.status, "body": payload_from_bytes(&r.body)}),
                        );
                        Ok(r)
                    }
                    None => Err(PortError::Http(format!(
                        "replay tape exhausted for HTTP {key}"
                    ))),
                }
            }
            mode => {
                let resp = self.inner.request(req).await?;
                if mode == Mode::Record {
                    self.ctx.with_tape(|t| t.record_http(key, &resp));
                }
                self.ctx.log(
                    Facet::WsRecv,
                    Hop::HttpResp,
                    serde_json::json!({"status": resp.status, "body": payload_from_bytes(&resp.body)}),
                );
                Ok(resp)
            }
        }
    }
}
