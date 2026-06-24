//! `Storage` 装饰器 —— facet ④（DB 落库行）。
//!
//! 所有模式都**真写本地库**（存储不回放，回放的是 go 帧/时钟/id）；装饰器只 tee 日志，
//! 供 reducer 取 facet ④（或 harness 直接查库二选一）。

use async_trait::async_trait;
use helix_core::effect::{
    BatchDeleteSpec, BatchUpdateSpec, GetSpec, GuardedBumpSpec, MonotonicUpsertSpec, Row, ScanSpec,
    UpsertSpec,
};
use helix_core::ports::Storage;
use helix_core::PortError;

use crate::event::{Facet, Hop};
use crate::recording::Recording;

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl<S: Storage> Storage for Recording<S> {
    async fn batch_upsert(&self, spec: UpsertSpec) -> Result<(), PortError> {
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "batch_upsert", "table": spec.table, "rows": spec.rows.len()}),
        );
        self.inner.batch_upsert(spec).await
    }

    async fn batch_update(&self, spec: BatchUpdateSpec) -> Result<(), PortError> {
        self.ctx.log(
            Facet::Storage,
            Hop::Storage,
            serde_json::json!({"op": "batch_update", "table": spec.table, "key_col": spec.key_col, "keys": spec.key_vals.len()}),
        );
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
