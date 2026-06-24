//! 装饰器内部小工具。

use serde_json::Value;

/// 把一段 wire 字节转成日志 payload：能 parse 成 JSON 就存 JSON（reducer 好抽领域键），
/// 否则存 utf8 字符串，再否则存 hex 字符串。
pub fn payload_from_bytes(b: &[u8]) -> Value {
    if let Ok(s) = std::str::from_utf8(b) {
        if let Ok(v) = serde_json::from_str::<Value>(s) {
            return v;
        }
        return Value::String(s.to_string());
    }
    Value::String(crate::blob::to_hex(b))
}
