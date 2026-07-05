//! Trace sidecar helpers for the Tauri IPC boundary.
//!
//! `__trace` is accepted only as a sidecar on the invoke envelope. It is never serialized into
//! `Tick::Command` payload bytes, storage rows, or projection schemas.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct TraceSidecar {
    pub traceparent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baggage: Option<String>,
}

impl TraceSidecar {
    pub fn normalized(&self) -> Result<Self, TraceSidecarError> {
        let traceparent = normalize_traceparent(&self.traceparent)?;
        let baggage = self
            .baggage
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        Ok(Self {
            traceparent,
            baggage,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceSidecarError {
    InvalidSidecar,
    InvalidTraceparent,
}

pub fn normalize_trace_sidecar(raw: &serde_json::Value) -> Result<TraceSidecar, TraceSidecarError> {
    let sidecar: TraceSidecar =
        serde_json::from_value(raw.clone()).map_err(|_| TraceSidecarError::InvalidSidecar)?;
    sidecar.normalized()
}

fn normalize_traceparent(raw: &str) -> Result<String, TraceSidecarError> {
    let value = raw.trim().to_ascii_lowercase();
    let mut parts = value.split('-');
    let (Some(version), Some(trace_id), Some(span_id), Some(flags), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(TraceSidecarError::InvalidTraceparent);
    };

    if version.len() != 2
        || trace_id.len() != 32
        || span_id.len() != 16
        || flags.len() != 2
        || version == "ff"
        || trace_id.bytes().all(|b| b == b'0')
        || span_id.bytes().all(|b| b == b'0')
        || !is_lower_hex(version)
        || !is_lower_hex(trace_id)
        || !is_lower_hex(span_id)
        || !is_lower_hex(flags)
    {
        return Err(TraceSidecarError::InvalidTraceparent);
    }

    Ok(format!("{version}-{trace_id}-{span_id}-{flags}"))
}

fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_valid_traceparent_and_baggage() {
        let sidecar = TraceSidecar {
            traceparent: " 00-00000000000000000000000000000001-0000000000000002-01 ".to_string(),
            baggage: Some(" tenant=im ".to_string()),
        };

        assert_eq!(
            sidecar.normalized().expect("valid traceparent"),
            TraceSidecar {
                traceparent: "00-00000000000000000000000000000001-0000000000000002-01".to_string(),
                baggage: Some("tenant=im".to_string()),
            }
        );
    }

    #[test]
    fn rejects_zero_or_malformed_traceparent() {
        for value in [
            "",
            "00-00000000000000000000000000000000-0000000000000002-01",
            "00-00000000000000000000000000000001-0000000000000000-01",
            "ff-00000000000000000000000000000001-0000000000000002-01",
            "00-not-hex-0000000000000002-01",
        ] {
            let sidecar = TraceSidecar {
                traceparent: value.to_string(),
                baggage: None,
            };
            assert_eq!(
                sidecar.normalized(),
                Err(TraceSidecarError::InvalidTraceparent)
            );
        }
    }

    #[test]
    fn raw_sidecar_shape_errors_are_reported_after_command_deserialization() {
        for raw in [
            serde_json::json!({}),
            serde_json::json!({ "traceparent": 42 }),
            serde_json::json!("not-an-object"),
        ] {
            assert_eq!(
                normalize_trace_sidecar(&raw),
                Err(TraceSidecarError::InvalidSidecar)
            );
        }

        assert_eq!(
            normalize_trace_sidecar(&serde_json::json!({
                "traceparent": "00-00000000000000000000000000000001-0000000000000002-01"
            }))
            .expect("valid raw sidecar")
            .traceparent,
            "00-00000000000000000000000000000001-0000000000000002-01"
        );
    }
}
