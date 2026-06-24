//! 配置 profile 系统 —— 替掉「env 指定 creds/端点」。
//!
//! ## 为什么是配置文件而非 env
//!
//! 身份（cookieId/deviceId）+ 端点（apiBase/wsUrl）+ 租户（companyId）是**部署态**配置，
//! 不应散落 env：env 易漏设/打错 key，且 W1 的 `env_or` 默认值把 creds 编进了源码。
//! 改成读 `config/<profile>.json`，profile 选择走构建态（debug→dev-local / release→prod），
//! 允许 `config/active-profile`（纯文本一行）覆盖。
//!
//! ## profile 选择优先级
//!
//! 1. `config/active-profile` 文件首行非空 trim（如 `pre`）—— 可选覆盖。
//! 2. 否则 `cfg!(debug_assertions)`：debug→`dev-local`、release→`prod`。
//!
//! ## 编译期内嵌 vs 运行时读盘
//!
//! 三套 `config/*.json` 用 `include_str!` **编译期内嵌**（bundle 后无外部 config 目录依赖，
//! 路径确定）。`active-profile` 覆盖文件走**运行时读盘**（开发态切 profile 不必重编；
//! 读不到则按构建态默认，fail-soft）。
//!
//! ## 边界：creds 仍可被 env 覆盖（联调便利），但**不再是唯一真源**
//!
//! 运行模式开关（HELIX_RUN_JSONL / LOOPFORGE_MODE / HELIX_HTTP_MAX_INFLIGHT）**不**是 creds/端点，
//! 保留在各自落点读 env，不进本模块。

use serde::Deserialize;

/// 单个 profile 的部署配置（身份 + 端点 + 租户）。
///
/// `cookie_id` / `device_id` 在 pre/prod 留空（运行时真鉴权注入）；dev-local 含联调实值。
#[derive(Debug, Clone, Deserialize)]
pub struct ProfileConfig {
    #[serde(rename = "apiBase")]
    pub api_base: String,
    #[serde(rename = "wsUrl")]
    pub ws_url: String,
    #[serde(rename = "companyId")]
    pub company_id: String,
    /// 开发态身份；pre/prod 为空 → 运行时真鉴权注入。
    #[serde(rename = "cookieId", default)]
    pub cookie_id: String,
    /// 开发态设备 id；pre/prod 为空 → 运行时真鉴权注入。
    #[serde(rename = "deviceId", default)]
    pub device_id: String,
}

// 三套 profile 编译期内嵌（路径相对本文件 src-tauri/src/ → ../../config/）。
const DEV_LOCAL_JSON: &str = include_str!("../../config/dev-local.json");
const PRE_JSON: &str = include_str!("../../config/pre.json");
const PROD_JSON: &str = include_str!("../../config/prod.json");

/// 选定生效 profile 名（active-profile 覆盖 > 构建态默认）。
pub fn active_profile_name() -> String {
    // 可选覆盖：config/active-profile 首行（运行时读盘，fail-soft）。
    if let Ok(raw) = std::fs::read_to_string("config/active-profile") {
        let name = raw.lines().next().unwrap_or("").trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    // 构建态默认：debug→dev-local、release→prod。
    if cfg!(debug_assertions) {
        "dev-local".to_string()
    } else {
        "prod".to_string()
    }
}

/// 按 profile 名取内嵌 JSON 文本（未知名 → `None`）。
fn embedded_json(name: &str) -> Option<&'static str> {
    match name {
        "dev-local" => Some(DEV_LOCAL_JSON),
        "pre" => Some(PRE_JSON),
        "prod" => Some(PROD_JSON),
        _ => None,
    }
}

/// 加载生效 profile 配置。
///
/// 失败（未知 profile / JSON 反序列化错）→ `Err`（由 lib.rs/engine 决定回退或中止）。
/// 返回 `(profile_name, config)`，便于上层日志与排查。
pub fn load() -> Result<(String, ProfileConfig), String> {
    let name = active_profile_name();
    let json = embedded_json(&name)
        .ok_or_else(|| format!("未知 profile：{name}（可选 dev-local/pre/prod）"))?;
    let cfg: ProfileConfig =
        serde_json::from_str(json).map_err(|e| format!("解析 profile {name} 失败：{e}"))?;
    Ok((name, cfg))
}
