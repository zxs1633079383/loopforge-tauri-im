//! `Storage` 装饰器 —— facet ④（DB 落库行）。
//!
//! 所有模式都**真写本地库**（存储不回放，回放的是 go 帧/时钟/id）；装饰器只 tee 日志，
//! 供 reducer 取 facet ④（或 harness 直接查库二选一）。

use async_trait::async_trait;
use helix_core::effect::{
    BatchDeleteSpec, BatchUpdateSpec, GetSpec, GuardedBumpSpec, MonotonicUpsertSpec, Row, ScanSpec,
    SqlValue, UpsertSpec,
};
use helix_core::ports::Storage;
use helix_core::PortError;

use crate::event::{Facet, Hop};
use crate::recording::Recording;

/// SqlValue → JSON（日志用）。
fn sqlvalue_to_json(v: &SqlValue) -> serde_json::Value {
    match v {
        SqlValue::Text(s) => serde_json::Value::String(s.clone()),
        SqlValue::Integer(i) => serde_json::Value::Number((*i).into()),
        SqlValue::Real(r) => serde_json::Number::from_f64(*r)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        SqlValue::Blob(_) => serde_json::Value::String("<blob>".into()),
        SqlValue::Null => serde_json::Value::Null,
    }
}

/// 从落库行抽「关联列」（id 类）并入 payload，让 reducer 能按 corr_key 把 storage 写
/// 归到对应事件束（facet④ 关联前提）。只抽 id 类列，不泄漏全行。
fn corr_cols(rows: &[Row]) -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();
    if let Some(row) = rows.first() {
        for (col, val) in row {
            if matches!(col.as_str(), "channel_id" | "temporary_id" | "id" | "event_seq") {
                m.insert(col.clone(), sqlvalue_to_json(val));
            }
        }
    }
    m
}

/// 组 storage hop payload：corr 列 + op/table/rows。
fn storage_payload(
    op: &str,
    table: &str,
    rows: usize,
    mut corr: serde_json::Map<String, serde_json::Value>,
) -> serde_json::Value {
    corr.insert("op".into(), serde_json::Value::String(op.to_string()));
    corr.insert("table".into(), serde_json::Value::String(table.to_string()));
    corr.insert("rows".into(), serde_json::Value::Number((rows as u64).into()));
    serde_json::Value::Object(corr)
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl<S: Storage> Storage for Recording<S> {
    async fn batch_upsert(&self, spec: UpsertSpec) -> Result<(), PortError> {
        let payload = storage_payload("batch_upsert", spec.table, spec.rows.len(), corr_cols(&spec.rows));
        self.ctx.log(Facet::Storage, Hop::Storage, payload);
        self.inner.batch_upsert(spec).await
    }

    async fn batch_update(&self, spec: BatchUpdateSpec) -> Result<(), PortError> {
        // corr：patch 行的 id 类列 + key 列首值（如 temporary_id）—— echo reconcile 关联用。
        let mut corr = corr_cols(std::slice::from_ref(&spec.patch));
        if let Some(first) = spec.key_vals.first() {
            corr.insert(spec.key_col.to_string(), sqlvalue_to_json(first));
        }
        corr.insert("op".into(), serde_json::Value::String("batch_update".into()));
        corr.insert("table".into(), serde_json::Value::String(spec.table.to_string()));
        corr.insert("keys".into(), serde_json::Value::Number((spec.key_vals.len() as u64).into()));
        self.ctx.log(Facet::Storage, Hop::Storage, serde_json::Value::Object(corr));
        self.inner.batch_update(spec).await
    }

    async fn monotonic_upsert(&self, spec: MonotonicUpsertSpec) -> Result<(), PortError> {
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "monotonic_upsert", "table": spec.table, "scope": spec.scope_key, "value": spec.value}),
        );
        self.inner.monotonic_upsert(spec).await
    }

    async fn guarded_bump(&self, spec: GuardedBumpSpec) -> Result<(), PortError> {
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "guarded_bump", "table": spec.table, "bump_col": spec.bump_col, "delta": spec.bump_delta, "guard": spec.guard_val}),
        );
        self.inner.guarded_bump(spec).await
    }

    async fn get(&self, spec: GetSpec) -> Result<Option<Row>, PortError> {
        let table = spec.table;
        let key_col = spec.key_col;
        let out = self.inner.get(spec).await?;
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "get", "table": table, "key_col": key_col, "hit": out.is_some()}),
        );
        Ok(out)
    }

    async fn scan(&self, spec: ScanSpec) -> Result<Vec<Row>, PortError> {
        let table = spec.table;
        let out = self.inner.scan(spec).await?;
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "scan", "table": table, "rows": out.len()}),
        );
        Ok(out)
    }

    async fn batch_delete(&self, spec: BatchDeleteSpec) -> Result<(), PortError> {
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "batch_delete", "table": spec.table, "scope_col": spec.scope_col, "keys": spec.key_vals.len()}),
        );
        self.inner.batch_delete(spec).await
    }
}
