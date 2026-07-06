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
use crate::TraceDirection;
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
        let request_payload = req_payload(&req);
        self.ctx.trace(
            "helix.http.request",
            "helix",
            TraceDirection::Out,
            request_payload.clone(),
        );
        self.ctx
            .log(Facet::Outbound, Hop::HttpReq, request_payload);
        let key = req_key(&req);
        let mode = self.ctx.mode();

        if mode != Mode::Replay {
            if let Some(suffix) = self.ctx.take_http_failpoint_for(&req.url) {
                return Err(PortError::Http(format!("loopforge failpoint: {suffix}")));
            }
        }

        match mode {
            Mode::Replay => {
                let resp = self.ctx.with_tape(|t| t.next_http(&key));
                match resp {
                    Some(r) => {
                        let response_payload = serde_json::json!({
                            "status": r.status,
                            "headers": r.headers,
                            "body": payload_from_bytes(&r.body)
                        });
                        self.ctx.trace(
                            "helix.http.response",
                            "helix",
                            TraceDirection::In,
                            response_payload.clone(),
                        );
                        self.ctx.log(
                            Facet::WsRecv,
                            Hop::HttpResp,
                            response_payload,
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
                let response_payload = serde_json::json!({
                    "status": resp.status,
                    "headers": resp.headers,
                    "body": payload_from_bytes(&resp.body)
                });
                self.ctx.trace(
                    "helix.http.response",
                    "helix",
                    TraceDirection::In,
                    response_payload.clone(),
                );
                self.ctx.log(
                    Facet::WsRecv,
                    Hop::HttpResp,
                    response_payload,
                );
                Ok(resp)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;

    #[test]
    fn http_trace_payload_includes_headers_and_body() {
        let req = HttpRequest {
            method: "POST".to_string(),
            url: "posts/create?debug=1".to_string(),
            headers: vec![(
                "traceparent".to_string(),
                "00-00000000000000000000000000000001-0000000000000002-01".to_string(),
            )],
            body: Some(Bytes::from_static(br#"{"message":"hello"}"#)),
        };
        let payload = req_payload(&req);
        assert_eq!(payload["method"], "POST");
        assert_eq!(payload["url"], "posts/create?debug=1");
        assert_eq!(payload["headers"][0][0], "traceparent");
        assert_eq!(payload["body"]["message"], "hello");
    }
}
