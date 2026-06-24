//! 字节 ↔ 可读序列化。tape 里的帧优先存 utf8（JSON 帧可读），非 utf8 退 hex。

use serde::{Deserialize, Serialize};

/// tape 里一段字节的可读表示。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "enc", content = "data")]
pub enum Blob {
    /// 合法 UTF-8（IM wire 帧多是 JSON 文本 → tape 直接可读）。
    #[serde(rename = "utf8")]
    Utf8(String),
    /// 非 UTF-8 → hex 编码。
    #[serde(rename = "hex")]
    Hex(String),
}

impl Blob {
    pub fn from_bytes(b: &[u8]) -> Self {
        match std::str::from_utf8(b) {
            Ok(s) => Blob::Utf8(s.to_string()),
            Err(_) => Blob::Hex(to_hex(b)),
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            Blob::Utf8(s) => s.clone().into_bytes(),
            Blob::Hex(h) => from_hex(h),
        }
    }
}

/// 无依赖 hex 编码（避免引 base64/hex crate 的版本漂移）。
pub fn to_hex(b: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        let _ = write!(s, "{:02x}", x);
    }
    s
}

pub fn from_hex(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    (0..bytes.len())
        .step_by(2)
        .filter_map(|i| {
            let hi = (i + 1) < bytes.len();
            if !hi {
                return None;
            }
            let pair = std::str::from_utf8(&bytes[i..i + 2]).ok()?;
            u8::from_str_radix(pair, 16).ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_roundtrip() {
        let b = Blob::from_bytes(br#"{"action":"post"}"#);
        assert!(matches!(b, Blob::Utf8(_)));
        assert_eq!(b.to_bytes(), br#"{"action":"post"}"#);
    }

    #[test]
    fn binary_roundtrip() {
        let raw = [0u8, 159, 146, 150, 255];
        let b = Blob::from_bytes(&raw);
        assert!(matches!(b, Blob::Hex(_)));
        assert_eq!(b.to_bytes(), raw);
    }
}
