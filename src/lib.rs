use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::{header, Method, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use axum::extract::ws::{Message, WebSocket};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use uuid::Uuid;
use validator::Validate;

pub mod database;
pub mod session;
pub mod openapi;
pub mod crypto;
pub mod ssrf;
pub mod vfs;
pub mod terminal;
pub mod browser_proxy;

pub fn extract_token(headers: &axum::http::HeaderMap, query_or_body_token: Option<&str>) -> Option<String> {
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            return Some(token.trim().to_string());
        }
        return Some(auth.trim().to_string());
    }
    query_or_body_token.map(|t| t.trim().to_string()).filter(|s| !s.is_empty())
}

use database::{Database, SearchQueryReq, WorkspaceAsset, CompanyRole};

use openapi::ApiDoc;
use session::{CallParticipant, ChatMessage, FileAttachment, Session, SessionState};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub sessions: Arc<DashMap<String, Session>>,
    pub vfs_hub: Arc<vfs::VfsHub>,
    pub cookie_jar: Arc<DashMap<(String, String), Vec<String>>>,
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses((status = 200, description = "System operational healthcheck", body = String))
)]
async fn health_handler() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({
        "status": "healthy",
        "service": "TheySynced Rust Axum Core Engine",
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}

#[utoipa::path(
    get,
    path = "/metrics",
    responses((status = 200, description = "Prometheus system metrics", body = String))
)]
async fn metrics_handler() -> impl IntoResponse {
    let metrics_text = format!(
        "# HELP process_uptime_seconds Total process uptime in seconds\n# TYPE process_uptime_seconds counter\nprocess_uptime_seconds {}\n# HELP active_websocket_rooms Count of active websocket rooms\n# TYPE active_websocket_rooms gauge\nactive_websocket_rooms 3\n",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
    );
    (StatusCode::OK, [("content-type", "text/plain; version=0.0.4")], metrics_text)
}

pub fn create_app(state: AppState) -> Router {
    Router::new()
        // VFS Kernel API & Realtime WebSocket Hub
        .merge(vfs::vfs_routes())

        // API Info (root)
        .route("/", get(index_handler))

        // Health & Metrics
        .route("/api/health", get(health_handler))
        .route("/metrics", get(metrics_handler))

        // OpenAPI Swagger UI
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))

        // Auth API
        .route("/api/auth/register", post(register_handler))
        .route("/api/auth/login", post(login_handler))
        .route("/api/auth/login/passkey", post(login_passkey_handler))
        .route("/api/auth/me", post(get_current_user_handler))

        // Company API
        .route("/api/companies/create", post(create_company_handler))
        .route("/api/companies/list", get(list_user_companies_handler))
        .route("/api/companies/join", post(join_company_handler))
        .route("/api/companies/leave", post(leave_company_handler))
        .route("/api/companies/rename", post(rename_company_handler))
        .route("/api/companies/logo", post(update_company_logo_handler))
        .route("/api/companies/delete", post(delete_company_handler))
        .route("/api/companies/export", post(export_company_handler))
        .route("/api/companies/touch-activity", post(touch_company_activity_handler))
        .route("/api/companies/public/:id", get(get_public_company_handler))
        .route("/api/companies/otp/generate", post(generate_company_otp_handler))
        .route("/api/companies/update-public-site", post(update_company_public_site_handler))
        .route("/api/companies/kick", post(kick_company_member_handler))
        .route("/api/companies/ban", post(ban_company_member_handler))
        .route("/api/companies/role", post(change_company_member_role_handler))

        // Invite API
        .route("/api/invites/create", post(create_invite_handler))
        .route("/api/invites/list", get(list_invites_handler))
        .route("/api/invites/revoke", post(revoke_invite_handler))
        .route("/api/invites/join", post(join_invite_handler))

        // Team API
        .route("/api/teams/create", post(create_team_handler))
        .route("/api/teams/delete", post(delete_team_handler))
        .route("/api/teams/list", get(list_teams_handler))

        // Asset API (Whiteboards, Sheets, Docs, PDFs)
        .route("/api/assets/save", post(save_asset_handler))
        .route("/api/assets/delete", post(delete_asset_handler))
        .route("/api/assets/list", get(list_assets_handler))

        // Chat API
        .route("/api/chat/messages/save", post(save_chat_msg_handler))
        .route("/api/chat/messages", get(list_chat_msgs_handler))

        // Passkey & Profile Auth API
        .route("/api/auth/profile/update", post(update_user_profile_handler))
        .route("/api/auth/passkey/set", post(set_passkey_handler))
        .route("/api/auth/passkey/delete", post(delete_passkey_handler))
        .route("/api/users/active-pulse", post(active_pulse_handler))
        .route("/api/auth/passkey/verify", post(verify_passkey_handler))

        // Tantivy Search API
        .route("/api/search", post(search_handler))

        // Realtime WebSockets Hub
        .route("/ws/:session_id", get(websocket_handler))
        .route("/rdp-ws", get(rdp_websocket_handler))
        .route("/api/terminal/config", get(terminal::terminal_config_handler))
        .route("/ws/terminal", get(terminal::terminal_ws_handler))
        .route("/api/browser/proxy", get(browser_proxy::browser_proxy_handler))

        // Storage / Media API (Cloudflare R2 & Local fallback)
        .route("/api/storage/upload", post(upload_storage_handler))
        .route("/api/storage/file/:key/:filename", get(get_storage_file_handler))
        .nest_service("/uploads", ServeDir::new("public/uploads"))

        // Cron trigger API (invoked by edge worker or external scheduler)
        .route("/api/cron/purge-inactive", post(purge_inactive_cron_handler))

        // Static Assets Service (Next.js / Frontend builds & SPA fallback)
        .nest_service("/pkg", ServeDir::new("public/pkg"))
        .nest_service("/static", ServeDir::new("static"))
        .nest_service("/assets", ServeDir::new("static/assets"))
        .nest_service("/_next", ServeDir::new("static/_next"))
        .fallback_service(ServeDir::new("static").fallback(tower_http::services::ServeFile::new("static/index.html")))
        .layer(
            CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub async fn run_inactivity_sweeper_tick(
    sweeper_db: &Arc<Database>,
    sweeper_sessions: &Arc<DashMap<String, Session>>,
) {
    let now = chrono::Utc::now();
    let mut expired_company_ids = Vec::new();

    for entry in sweeper_db.companies.iter() {
        let comp = entry.value();
        if comp.id == "comp_theysynced" {
            continue;
        }
        let last_act_str = comp.last_activity_at.as_deref().unwrap_or(&comp.created_at);
        if let Ok(last_act) = chrono::DateTime::parse_from_rfc3339(last_act_str) {
            let diff = now.signed_duration_since(last_act);
            if diff.num_days() >= 90 {
                expired_company_ids.push(comp.id.clone());
            }
        }
    }

    for comp_id in expired_company_ids {
        tracing::warn!("⚠️ Organization '{}' has been inactive for 90+ days. Automatically and permanently purging without restoration...", comp_id);
        if let Err(e) = sweeper_db.purge_inactive_company(&comp_id).await {
            tracing::error!("Failed to purge inactive company {}: {}", comp_id, e);
        } else {
            tracing::info!("✅ Inactive organization '{}' permanently purged", comp_id);
            if let Some((_, session)) = sweeper_sessions.remove(&comp_id) {
                let purge_msg = serde_json::json!({
                    "type": "workspace_purged",
                    "company_id": comp_id
                });
                let _ = session.broadcast.send(purge_msg.to_string());
            }
        }
    }
}

pub async fn cleanup_inactive_sessions(state: &AppState) {
    let mut to_remove = Vec::new();
    for entry in state.sessions.iter() {
        if entry.value().user_count.load(std::sync::atomic::Ordering::SeqCst) == 0 {
            to_remove.push(entry.key().clone());
        }
    }
    for session_id in to_remove {
        tracing::info!("Cleaning up inactive websocket room: {}", session_id);
        state.sessions.remove(&session_id);
    }
}

async fn index_handler() -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "service": "TheySynced API",
        "version": "0.2.0",
        "status": "running",
        "docs": "/swagger-ui",
        "health": "/api/health"
    }))
}

// Auth Handlers
#[derive(Deserialize)]
struct AuthReq {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AuthRes {
    success: bool,
    token: Option<String>,
    user: Option<database::UserProfile>,
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    requires_passkey: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending_token: Option<String>,
}

async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<AuthReq>,
) -> Json<AuthRes> {
    match state.db.sign_up(&payload.username, &payload.password).await {
        Ok((token, profile)) => {
            let populated = state.db.populate_profile_passkeys(profile);
            Json(AuthRes {
                success: true,
                token: Some(token),
                user: Some(populated),
                message: None,
                requires_passkey: None,
                pending_token: None,
            })
        }
        Err(e) => Json(AuthRes {
            success: false,
            token: None,
            user: None,
            message: Some(e.to_string()),
            requires_passkey: None,
            pending_token: None,
        }),
    }
}

async fn login_handler(
    State(state): State<AppState>,
    Json(payload): Json<AuthReq>,
) -> Json<AuthRes> {
    match state.db.sign_in(&payload.username, &payload.password).await {
        Ok((token, profile, requires_passkey)) => {
            if requires_passkey {
                // Password was correct, but the account has a passkey enrolled —
                // don't hand over a session yet, only a short-lived pending token.
                Json(AuthRes {
                    success: true,
                    token: None,
                    user: None,
                    message: None,
                    requires_passkey: Some(true),
                    pending_token: Some(token),
                })
            } else {
                let populated = state.db.populate_profile_passkeys(profile);
                Json(AuthRes {
                    success: true,
                    token: Some(token),
                    user: Some(populated),
                    message: None,
                    requires_passkey: Some(false),
                    pending_token: None,
                })
            }
        }
        Err(e) => Json(AuthRes {
            success: false,
            token: None,
            user: None,
            message: Some(e.to_string()),
            requires_passkey: None,
            pending_token: None,
        }),
    }
}

#[derive(Deserialize)]
struct PasskeyLoginReq {
    pending_token: String,
    passkey: String,
}

async fn login_passkey_handler(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyLoginReq>,
) -> Json<AuthRes> {
    match state.db.complete_passkey_login(&payload.pending_token, &payload.passkey).await {
        Ok((token, profile)) => {
            let populated = state.db.populate_profile_passkeys(profile);
            Json(AuthRes {
                success: true,
                token: Some(token),
                user: Some(populated),
                message: None,
                requires_passkey: None,
                pending_token: None,
            })
        }
        Err(e) => Json(AuthRes {
            success: false,
            token: None,
            user: None,
            message: Some(e.to_string()),
            requires_passkey: None,
            pending_token: None,
        }),
    }
}

#[derive(Deserialize)]
struct TokenAuthQuery {
    token: String,
}

async fn get_current_user_handler(
    State(state): State<AppState>,
    Query(query): Query<TokenAuthQuery>,
) -> Json<AuthRes> {
    match state.db.verify_token(&query.token).await {
        Ok(claims) => {
            let user_profile = state
                .db
                .users
                .iter()
                .find(|u| u.value().id == claims.user_id)
                .map(|u| u.value().clone());
            if let Some(user) = user_profile {
                let populated = state.db.populate_profile_passkeys(user);
                Json(AuthRes {
                    success: true,
                    token: Some(query.token),
                    user: Some(populated),
                    message: None,
                    requires_passkey: None,
                    pending_token: None,
                })
            } else {
                Json(AuthRes {
                    success: false,
                    token: None,
                    user: None,
                    message: Some("User profile not found".to_string()),
                    requires_passkey: None,
                    pending_token: None,
                })
            }
        }
        Err(e) => Json(AuthRes {
            success: false,
            token: None,
            user: None,
            message: Some(e.to_string()),
            requires_passkey: None,
            pending_token: None,
        }),
    }
}

// Company Handlers
#[derive(Deserialize)]
struct CreateCompanyReq {
    token: String,
    name: String,
    is_public: Option<bool>,
    logo_url: Option<String>,
}

async fn create_company_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateCompanyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    let is_public = payload.is_public.unwrap_or(true);
    match state.db.create_company(&claims.user_id, &claims.username, &payload.name, is_public, payload.logo_url).await {
        Ok(comp) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": comp}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}


#[derive(Deserialize)]
struct GenerateOtpReq {
    token: String,
    company_id: String,
}

async fn generate_company_otp_handler(
    State(state): State<AppState>,
    Json(payload): Json<GenerateOtpReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.generate_company_otp(&claims.user_id, &payload.company_id).await {
        Ok(otp) => (StatusCode::OK, Json(serde_json::json!({"success": true, "otp": otp, "expires_in": "15 minutes"}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct UpdatePublicSiteReq {
    token: String,
    company_id: String,
    headline: Option<String>,
    description: Option<String>,
    faqs: Option<String>,
    is_public: Option<bool>,
}

async fn update_company_public_site_handler(
    State(state): State<AppState>,
    Json(payload): Json<UpdatePublicSiteReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.update_company_public_site(
        &claims.user_id,
        &payload.company_id,
        payload.headline,
        payload.description,
        payload.faqs,
        payload.is_public,
    ).await {
        Ok(comp) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": comp}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}


async fn get_public_company_handler(
    State(state): State<AppState>,
    Path(company_id): Path<String>,
) -> impl IntoResponse {
    if let Some(comp) = state.db.companies.get(&company_id) {
        if comp.is_public {
            return (StatusCode::OK, Json(serde_json::json!({
                "success": true,
                "company": {
                    "id": comp.id,
                    "name": comp.name,
                    "created_at": comp.created_at,
                    "member_count": comp.member_ids.len(),
                    "headline": comp.public_headline,
                    "description": comp.public_description,
                    "faqs": comp.public_faqs,
                }
            })));
        }
    }
    (StatusCode::NOT_FOUND, Json(serde_json::json!({"success": false, "message": "Public company site not found"})))
}


async fn list_user_companies_handler(
    State(state): State<AppState>,
    Query(query): Query<TokenAuthQuery>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&query.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "companies": []}))),
    };

    let companies = state.db.get_user_companies(&claims.user_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "companies": companies})))
}

#[derive(Deserialize)]
struct JoinCompanyReq {
    token: String,
    join_code: String,
}

async fn join_company_handler(
    State(state): State<AppState>,
    Json(payload): Json<JoinCompanyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.join_company(&claims.user_id, &claims.username, &payload.join_code).await {
        Ok(comp) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": comp}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}


#[derive(Deserialize)]
struct LeaveCompanyReq {
    token: String,
    company_id: String,
}

async fn leave_company_handler(
    State(state): State<AppState>,
    Json(payload): Json<LeaveCompanyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    let _ = state.db.leave_company(&claims.user_id, &payload.company_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

#[derive(Deserialize)]
struct RenameCompanyReq {
    token: String,
    company_id: String,
    new_name: String,
}

async fn rename_company_handler(
    State(state): State<AppState>,
    Json(payload): Json<RenameCompanyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.rename_company(&claims.user_id, &payload.company_id, &payload.new_name).await {
        Ok(company) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": company}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct UpdateCompanyLogoReq {
    token: String,
    company_id: String,
    logo_url: String,
}

async fn update_company_logo_handler(
    State(state): State<AppState>,
    Json(payload): Json<UpdateCompanyLogoReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.update_company_logo(&claims.user_id, &payload.company_id, &payload.logo_url).await {
        Ok(company) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": company}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct DeleteCompanyReq {
    token: String,
    company_id: String,
}

async fn delete_company_handler(
    State(state): State<AppState>,
    Json(payload): Json<DeleteCompanyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.delete_company(&claims.user_id, &payload.company_id).await {
        Ok(_) => {
            if let Some((_, session)) = state.sessions.remove(&payload.company_id) {
                let purge_event = serde_json::json!({
                    "type": "workspace_purged",
                    "company_id": payload.company_id
                });
                let _ = session.broadcast.send(purge_event.to_string());
            }
            (StatusCode::OK, Json(serde_json::json!({"success": true, "message": "Workspace and all data permanently deleted"})))
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct ExportCompanyReq {
    token: String,
    company_id: String,
}

async fn export_company_handler(
    State(state): State<AppState>,
    Json(payload): Json<ExportCompanyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.export_company_data(&claims.user_id, &payload.company_id).await {
        Ok(export) => (StatusCode::OK, Json(serde_json::json!({"success": true, "export": export}))),
        Err(e) => (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct TouchActivityReq {
    token: String,
    company_id: String,
}

async fn touch_company_activity_handler(
    State(state): State<AppState>,
    Json(payload): Json<TouchActivityReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    if !state.db.is_company_member(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: user does not belong to this organization"})));
    }

    state.db.touch_company_activity(&payload.company_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "message": "Activity touched"})))
}

#[derive(Deserialize)]
struct KickCompanyMemberReq {
    token: String,
    company_id: String,
    target_user_id: String,
    duration_mins: u64,
}

async fn kick_company_member_handler(
    State(state): State<AppState>,
    Json(payload): Json<KickCompanyMemberReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.kick_company_member(&claims.user_id, &payload.company_id, &payload.target_user_id, payload.duration_mins).await {
        Ok(company) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": company}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct BanCompanyMemberReq {
    token: String,
    company_id: String,
    target_user_id: String,
}

async fn ban_company_member_handler(
    State(state): State<AppState>,
    Json(payload): Json<BanCompanyMemberReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.ban_company_member(&claims.user_id, &payload.company_id, &payload.target_user_id).await {
        Ok(company) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": company}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct ChangeCompanyMemberRoleReq {
    token: String,
    company_id: String,
    target_user_id: String,
    role: CompanyRole,
}

async fn change_company_member_role_handler(
    State(state): State<AppState>,
    Json(payload): Json<ChangeCompanyMemberRoleReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.change_member_role(&claims.user_id, &payload.company_id, &payload.target_user_id, payload.role).await {
        Ok(company) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": company}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

// Team Handlers
#[derive(Deserialize)]
struct CreateTeamReq {
    token: String,
    company_id: String,
    name: String,
    description: String,
}

async fn create_team_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTeamReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    if !state.db.is_company_member(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: user does not belong to this organization"})));
    }

    match state.db.create_team(&payload.company_id, &payload.name, &payload.description).await {
        Ok(team) => (StatusCode::OK, Json(serde_json::json!({"success": true, "team": team}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct DeleteTeamReq {
    token: String,
    company_id: String,
    team_id: String,
}

async fn delete_team_handler(
    State(state): State<AppState>,
    Json(payload): Json<DeleteTeamReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    if !state.db.is_company_admin_or_owner(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: only owners or admins can delete teams"})));
    }

    let _ = state.db.delete_team(&payload.company_id, &payload.team_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}


#[derive(Deserialize)]
struct ListTeamsQuery {
    token: String,
    company_id: String,
}

async fn list_teams_handler(
    State(state): State<AppState>,
    Query(query): Query<ListTeamsQuery>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&query.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "teams": []}))),
    };

    if !state.db.is_company_member(&claims.user_id, &query.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization", "teams": []})));
    }

    let teams = state.db.get_teams(&query.company_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "teams": teams})))
}

// Asset Handlers
#[derive(Deserialize)]
struct SaveAssetReq {
    token: String,
    company_id: String,
    asset: WorkspaceAsset,
}

async fn save_asset_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveAssetReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    if !state.db.is_company_member(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization"})));
    }

    if payload.asset.company_id != payload.company_id {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": "Mismatched asset company_id"})));
    }

    match state.db.save_asset(&payload.company_id, payload.asset).await {
        Ok(asset) => (StatusCode::OK, Json(serde_json::json!({"success": true, "asset": asset}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct ListAssetsQuery {
    token: String,
    company_id: String,
}

async fn list_assets_handler(
    State(state): State<AppState>,
    Query(query): Query<ListAssetsQuery>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&query.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "assets": []}))),
    };

    if !state.db.is_company_member(&claims.user_id, &query.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization", "assets": []})));
    }

    let assets = state.db.get_assets(&query.company_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "assets": assets})))
}

#[derive(Deserialize)]
struct DeleteAssetReq {
    token: String,
    company_id: String,
    id: String,
}

async fn delete_asset_handler(
    State(state): State<AppState>,
    Json(payload): Json<DeleteAssetReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    if !state.db.is_company_member(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization"})));
    }

    match state.db.delete_asset(&payload.company_id, &payload.id).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}


// Chat & Passkey Handlers

#[derive(Deserialize)]
struct SaveChatMsgReq {
    token: String,
    channel_id: String,
    company_id: Option<String>,
    message: String,
    file_attachment: Option<session::FileAttachment>,
}

async fn save_chat_msg_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveChatMsgReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    let company_id = payload.company_id.unwrap_or_else(|| {
        if payload.channel_id.starts_with("team_") && payload.channel_id.ends_with("_gen") {
            payload.channel_id.trim_start_matches("team_").trim_end_matches("_gen").to_string()
        } else {
            payload.channel_id.clone()
        }
    });

    if !state.db.is_company_member(&claims.user_id, &company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization"})));
    }

    let team_id = if payload.channel_id != company_id {
        Some(payload.channel_id.clone())
    } else {
        None
    };

    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();

    let db_msg = database::ChatMessage {
        id: id.clone(),
        company_id: company_id.clone(),
        team_id: team_id.clone(),
        user_id: claims.user_id.clone(),
        username: claims.username.clone(),
        message: payload.message.clone(),
        timestamp: timestamp.clone(),
        file_attachment: payload.file_attachment.as_ref().map(|att| database::FileAttachment {
            name: att.name.clone(),
            url: att.url.clone(),
            file_type: att.file_type.clone(),
            size: att.size,
        }),
        reactions: None,
    };

    let saved = match state.db.save_chat_message(&payload.channel_id, db_msg).await {
        Ok(s) => s,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    };

    // If an active websocket session exists for this company, broadcast the message
    if let Some(session_entry) = state.sessions.get(&company_id) {
        let session = session_entry.value();
        let session_msg = session::ChatMessage {
            id: saved.id.clone(),
            company_id: saved.company_id.clone(),
            team_id: saved.team_id.clone(),
            user_id: saved.user_id.clone(),
            username: saved.username.clone(),
            message: saved.message.clone(),
            file_attachment: payload.file_attachment,
            reactions: None,
            timestamp: saved.timestamp.clone(),
        };

        {
            let mut st = session.state.write().await;
            st.chat_messages.push(session_msg.clone());
            if st.chat_messages.len() > 200 {
                st.chat_messages.remove(0);
            }
        }

        let broadcast_msg = serde_json::json!({
            "type": "chat",
            "data": session_msg
        });
        let _ = session.broadcast.send(broadcast_msg.to_string());
    }

    (StatusCode::OK, Json(serde_json::json!({"success": true, "message": saved})))
}

#[derive(Deserialize)]
struct ListChatMsgsQuery {
    token: String,
    channel_id: String,
    company_id: Option<String>,
}

async fn list_chat_msgs_handler(
    State(state): State<AppState>,
    Query(query): Query<ListChatMsgsQuery>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&query.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "messages": []}))),
    };

    let company_id = query.company_id.unwrap_or_else(|| {
        if query.channel_id.starts_with("team_") && query.channel_id.ends_with("_gen") {
            query.channel_id.trim_start_matches("team_").trim_end_matches("_gen").to_string()
        } else {
            query.channel_id.clone()
        }
    });

    if !state.db.is_company_member(&claims.user_id, &company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization", "messages": []})));
    }

    let messages = state.db.get_channel_messages(&query.channel_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "messages": messages})))
}

#[derive(Deserialize)]
struct ActivePulseReq {
    token: String,
    active_seconds: u64,
}

async fn active_pulse_handler(
    State(state): State<AppState>,
    Json(payload): Json<ActivePulseReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false}))),
    };

    match state.db.update_user_active_seconds(&claims.user_id, payload.active_seconds).await {
        Ok(user) => (StatusCode::OK, Json(serde_json::json!({"success": true, "user": user}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct UpdateProfileReq {
    token: String,
    username: Option<String>,
    avatar_url: Option<String>,
}

async fn update_user_profile_handler(
    State(state): State<AppState>,
    Json(payload): Json<UpdateProfileReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.update_user_profile(&claims.user_id, payload.username, payload.avatar_url).await {
        Ok(user) => (StatusCode::OK, Json(serde_json::json!({"success": true, "user": user}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct SetPasskeyReq {

    token: String,
    passkey: String,
}

async fn set_passkey_handler(
    State(state): State<AppState>,
    Json(payload): Json<SetPasskeyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.set_user_passkey(&claims.user_id, &payload.passkey).await {
        Ok(_) => {
            let user_profile = state
                .db
                .users
                .iter()
                .find(|u| u.value().id == claims.user_id)
                .map(|u| state.db.populate_profile_passkeys(u.value().clone()));
            (StatusCode::OK, Json(serde_json::json!({"success": true, "user": user_profile})))
        },
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct DeletePasskeyReq {
    token: String,
    passkey_id: String,
}

async fn delete_passkey_handler(
    State(state): State<AppState>,
    Json(payload): Json<DeletePasskeyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    match state.db.delete_user_passkey(&claims.user_id, &payload.passkey_id).await {
        Ok(_) => {
            let user_profile = state
                .db
                .users
                .iter()
                .find(|u| u.value().id == claims.user_id)
                .map(|u| state.db.populate_profile_passkeys(u.value().clone()));
            (StatusCode::OK, Json(serde_json::json!({"success": true, "user": user_profile})))
        },
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "message": e.to_string()}))),
    }
}

#[derive(Deserialize)]
struct VerifyPasskeyReq {
    token: String,
    passkey: String,
}

async fn verify_passkey_handler(
    State(state): State<AppState>,
    Json(payload): Json<VerifyPasskeyReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized"}))),
    };

    let valid = state.db.verify_user_passkey(&claims.user_id, &payload.passkey).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "valid": valid})))
}

// Search Handler using Tantivy
async fn search_handler(
    State(state): State<AppState>,
    Json(payload): Json<SearchQueryReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "message": "Unauthorized", "results": []}))),
    };

    if !state.db.is_company_member(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "message": "Forbidden: not a member of this organization", "results": []})));
    }

    if payload.validate().is_err() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "results": []})));
    }

    let results = state.db.search(&payload.query);
    (StatusCode::OK, Json(serde_json::json!({"success": true, "results": results})))
}

#[derive(Deserialize, Default)]
struct RdpWsQuery {
    token: Option<String>,
}

// WebSocket bridge for WebRDP proxy
async fn rdp_websocket_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(query): Query<RdpWsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let token = match extract_token(&headers, query.token.as_deref()) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized: missing token").into_response(),
    };

    if state.db.verify_token(&token).await.is_err() {
        return (StatusCode::UNAUTHORIZED, "Unauthorized: invalid token").into_response();
    }

    ws.on_upgrade(handle_rdp_websocket).into_response()
}

async fn handle_rdp_websocket(client_socket: WebSocket) {
    let rdp_url = std::env::var("RDP_PROXY_WS_URL")
        .unwrap_or_else(|_| "ws://127.0.0.1:8080/rdp-ws".to_string());

    match tokio_tungstenite::connect_async(&rdp_url).await {
        Ok((upstream_stream, _)) => {
            let (mut upstream_sink, mut upstream_read) = upstream_stream.split();
            let (mut client_sink, mut client_read) = client_socket.split();

            let client_to_upstream = tokio::spawn(async move {
                while let Some(Ok(msg)) = client_read.next().await {
                    match msg {
                        Message::Binary(bin) => {
                            if upstream_sink.send(tokio_tungstenite::tungstenite::Message::Binary(bin)).await.is_err() {
                                break;
                            }
                        }
                        Message::Text(txt) => {
                            if upstream_sink.send(tokio_tungstenite::tungstenite::Message::Text(txt)).await.is_err() {
                                break;
                            }
                        }
                        Message::Ping(p) => {
                            let _ = upstream_sink.send(tokio_tungstenite::tungstenite::Message::Ping(p)).await;
                        }
                        Message::Pong(p) => {
                            let _ = upstream_sink.send(tokio_tungstenite::tungstenite::Message::Pong(p)).await;
                        }
                        Message::Close(_) => {
                            let _ = upstream_sink.send(tokio_tungstenite::tungstenite::Message::Close(None)).await;
                            break;
                        }
                    }
                }
            });

            let upstream_to_client = tokio::spawn(async move {
                while let Some(Ok(msg)) = upstream_read.next().await {
                    match msg {
                        tokio_tungstenite::tungstenite::Message::Binary(bin) => {
                            if client_sink.send(Message::Binary(bin)).await.is_err() {
                                break;
                            }
                        }
                        tokio_tungstenite::tungstenite::Message::Text(txt) => {
                            if client_sink.send(Message::Text(txt)).await.is_err() {
                                break;
                            }
                        }
                        tokio_tungstenite::tungstenite::Message::Ping(p) => {
                            let _ = client_sink.send(Message::Ping(p)).await;
                        }
                        tokio_tungstenite::tungstenite::Message::Pong(p) => {
                            let _ = client_sink.send(Message::Pong(p)).await;
                        }
                        tokio_tungstenite::tungstenite::Message::Close(_) => {
                            let _ = client_sink.send(Message::Close(None)).await;
                            break;
                        }
                        _ => {}
                    }
                }
            });

            tokio::select! {
                _ = client_to_upstream => {},
                _ = upstream_to_client => {},
            }
        }
        Err(e) => {
            tracing::error!("Failed to connect to RDP proxy upstream at {}: {}", rdp_url, e);
        }
    }
}



#[derive(Deserialize, Default)]
struct WsQuery {
    token: Option<String>,
}

// WebSocket real-time engine
async fn websocket_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Query(query): Query<WsQuery>,
    headers: axum::http::HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let token_opt = extract_token(&headers, query.token.as_deref());
    let initial_claims = match token_opt {
        Some(ref t) => {
            match state.db.verify_token(t).await {
                Ok(c) => {
                    if !state.db.is_company_member(&c.user_id, &session_id) {
                        return (StatusCode::FORBIDDEN, "Forbidden: user does not belong to this organization").into_response();
                    }
                    Some(c)
                }
                Err(_) => {
                    return (StatusCode::UNAUTHORIZED, "Unauthorized: invalid session token").into_response();
                }
            }
        }
        None => None,
    };

    ws.on_upgrade(move |socket| handle_websocket(socket, session_id, state, initial_claims)).into_response()
}

async fn handle_websocket(
    socket: WebSocket,
    session_id: String,
    state: AppState,
    initial_claims: Option<database::TokenClaims>,
) {
    let session = {
        if !state.sessions.contains_key(&session_id) {
            let (tx, _) = broadcast::channel(200);
            let mut db_msgs = Vec::new();

            for entry in state.db.messages.iter() {
                let list = entry.value();
                for msg in list {
                    if msg.company_id == session_id {
                        db_msgs.push(msg.clone());
                    }
                }
            }
            db_msgs.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

            let chat_messages = db_msgs.into_iter().map(|msg| session::ChatMessage {
                id: msg.id,
                company_id: msg.company_id,
                team_id: msg.team_id,
                user_id: msg.user_id,
                username: msg.username,
                message: msg.message,
                file_attachment: msg.file_attachment.map(|att| session::FileAttachment {
                    name: att.name,
                    url: att.url,
                    file_type: att.file_type,
                    size: att.size,
                }),
                reactions: msg.reactions.map(|list| list.into_iter().map(|r| session::MessageReaction {
                    username: r.username,
                    emoji: r.emoji,
                }).collect::<Vec<_>>()),
                timestamp: msg.timestamp,
            }).collect::<Vec<_>>();

            // Load assets from database to populate initial WebSocket room state
            let assets = state.db.get_assets(&session_id).await;
            let mut excalidraw_elements = Vec::new();
            let mut document_content = String::new();
            let mut spreadsheet_grid = Vec::new();

            for asset in assets {
                if asset.asset_type == "whiteboard" {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&asset.content) {
                        if let Some(elements) = parsed.get("elements").and_then(|e| e.as_array()) {
                            excalidraw_elements = elements.clone();
                        }
                    }
                } else if asset.asset_type == "doc" || asset.asset_type == "document" {
                    document_content = asset.content.clone();
                } else if asset.asset_type == "spreadsheet" {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&asset.content) {
                        if let Some(grid) = parsed.get("data").and_then(|g| g.as_array()) {
                            let mut parsed_grid = Vec::new();
                            for row_val in grid {
                                if let Some(row_arr) = row_val.as_array() {
                                    let mut parsed_row = Vec::new();
                                    for cell_val in row_arr {
                                        parsed_row.push(cell_val.as_str().unwrap_or("").to_string());
                                    }
                                    parsed_grid.push(parsed_row);
                                }
                            }
                            spreadsheet_grid = parsed_grid;
                        }
                    }
                }
            }

            state.sessions.insert(session_id.clone(), Session {
                id: session_id.clone(),
                company_id: session_id.clone(),
                name: "Room".to_string(),
                state: Arc::new(tokio::sync::RwLock::new(SessionState {
                    chat_messages,
                    excalidraw_elements,
                    document_content,
                    spreadsheet_grid,
                    ..Default::default()
                })),
                broadcast: tx,
                user_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            });
        }
        state.sessions.get(&session_id).unwrap().value().clone()
    };

    session.user_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    let (mut sender, mut receiver) = socket.split();
    let mut rx = session.broadcast.subscribe();

    let authenticated = Arc::new(tokio::sync::RwLock::new(initial_claims.is_some()));
    let client_user_id = Arc::new(tokio::sync::RwLock::new(
        initial_claims.as_ref().map(|c| c.user_id.clone()).unwrap_or_default()
    ));
    let client_username = Arc::new(tokio::sync::RwLock::new(
        initial_claims.as_ref().map(|c| c.username.clone()).unwrap_or_default()
    ));

    {
        let current_state = session.state.read().await;
        let init_msg = serde_json::json!({
            "type": "init",
            "state": *current_state
        });
        let _ = sender.send(Message::Text(init_msg.to_string())).await;
    }

    let session_clone = session.clone();
    let client_uid_clone = client_user_id.clone();
    let client_uname_clone = client_username.clone();
    let auth_clone = authenticated.clone();
    let db_clone = state.db.clone();

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = receiver.next().await {
            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");

                // Enforce verified authentication on WebSocket session
                let is_auth = *auth_clone.read().await;
                if !is_auth {
                    if msg_type == "join" {
                        let token = msg.get("token").and_then(|t| t.as_str()).unwrap_or("");
                        match db_clone.verify_token(token).await {
                            Ok(claims) => {
                                if !db_clone.is_company_member(&claims.user_id, &session_clone.company_id) {
                                    break;
                                }
                                *auth_clone.write().await = true;
                                *client_uid_clone.write().await = claims.user_id.clone();
                                *client_uname_clone.write().await = claims.username.clone();
                                let broadcast_join = serde_json::json!({
                                    "type": "user_joined",
                                    "user_id": claims.user_id,
                                    "username": claims.username
                                });
                                let _ = session_clone.broadcast.send(broadcast_join.to_string());
                                continue;
                            }
                            Err(_) => {
                                break;
                            }
                        }
                    } else {
                        break;
                    }
                }

                match msg_type {
                    "join" => {
                        let uid = client_uid_clone.read().await.clone();
                        let uname = client_uname_clone.read().await.clone();
                        let broadcast_join = serde_json::json!({
                            "type": "user_joined",
                            "user_id": uid,
                            "username": uname
                        });
                        let _ = session_clone.broadcast.send(broadcast_join.to_string());
                    }
                    "chat" => {
                        if let Some(text_content) = msg.get("message").and_then(|m| m.as_str()) {
                            let chat_item = ChatMessage {
                                id: Uuid::new_v4().to_string(),
                                company_id: session_clone.company_id.clone(),
                                team_id: msg.get("team_id").and_then(|t| t.as_str()).map(|s| s.to_string()),
                                user_id: client_uid_clone.read().await.clone(),
                                username: client_uname_clone.read().await.clone(),
                                message: text_content.to_string(),
                                file_attachment: serde_json::from_value::<FileAttachment>(msg.get("file_attachment").cloned().unwrap_or(serde_json::Value::Null)).ok(),
                                reactions: None,
                                timestamp: chrono::Utc::now().to_rfc3339(),
                            };

                            let channel_id = chat_item.team_id.clone().unwrap_or_else(|| chat_item.company_id.clone());
                            let db_msg = database::ChatMessage {
                                id: chat_item.id.clone(),
                                company_id: chat_item.company_id.clone(),
                                team_id: chat_item.team_id.clone(),
                                user_id: chat_item.user_id.clone(),
                                username: chat_item.username.clone(),
                                message: chat_item.message.clone(),
                                timestamp: chat_item.timestamp.clone(),
                                file_attachment: chat_item.file_attachment.as_ref().map(|att| database::FileAttachment {
                                    name: att.name.clone(),
                                    url: att.url.clone(),
                                    file_type: att.file_type.clone(),
                                    size: att.size,
                                }),
                                reactions: None,
                            };
                            let _ = db_clone.save_chat_message(&channel_id, db_msg).await;

                            {
                                let mut st = session_clone.state.write().await;
                                st.chat_messages.push(chat_item.clone());
                                if st.chat_messages.len() > 200 {
                                    st.chat_messages.remove(0);
                                }
                            }

                            let broadcast_msg = serde_json::json!({
                                "type": "chat",
                                "data": chat_item
                            });
                            let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                        }
                    }
                    "reaction" => {
                        if let (Some(message_id), Some(emoji)) = (
                            msg.get("message_id").and_then(|m| m.as_str()),
                            msg.get("emoji").and_then(|e| e.as_str()),
                        ) {
                            let client_username = client_uname_clone.read().await.clone();
                            let channel_id = msg.get("channel_id").and_then(|c| c.as_str()).unwrap_or(&session_clone.company_id);
                            
                            if let Some(mut list) = db_clone.messages.get_mut(channel_id) {
                                if let Some(idx) = list.iter().position(|m| m.id == message_id) {
                                    let mut reactions = list[idx].reactions.clone().unwrap_or_default();
                                    
                                    if let Some(pos) = reactions.iter().position(|r| r.username == client_username && r.emoji == emoji) {
                                        reactions.remove(pos);
                                    } else {
                                        reactions.push(database::MessageReaction {
                                            username: client_username.clone(),
                                            emoji: emoji.to_string(),
                                        });
                                    }
                                    list[idx].reactions = Some(reactions.clone());
                                    
                                    drop(list);
                                    // Persist reaction update to Turso
                                    let channel_id_owned = channel_id.to_string();
                                    let db_persist = db_clone.clone();
                                    let msgs_snap = db_persist.messages.get(&channel_id_owned).map(|m| m.value().clone());
                                    if let Some(msgs_snap) = msgs_snap {
                                        tokio::spawn(async move {
                                            db_persist.upsert_messages_pub(&channel_id_owned, &msgs_snap).await;
                                        });
                                    }
                                    
                                    {
                                        let mut st = session_clone.state.write().await;
                                        if let Some(w_idx) = st.chat_messages.iter().position(|m| m.id == message_id) {
                                            st.chat_messages[w_idx].reactions = Some(reactions.iter().map(|r| session::MessageReaction {
                                                username: r.username.clone(),
                                                emoji: r.emoji.clone(),
                                            }).collect());
                                        }
                                    }

                                    let broadcast_msg = serde_json::json!({
                                        "type": "reaction_update",
                                        "message_id": message_id,
                                        "reactions": reactions
                                    });
                                    let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                                }
                            }
                        }
                    }
                    "delete_message" => {
                        if let Some(message_id) = msg.get("message_id").and_then(|m| m.as_str()) {
                            let client_username = client_uname_clone.read().await.clone();
                            let channel_id = msg.get("channel_id").and_then(|c| c.as_str()).unwrap_or(&session_clone.company_id);
                            
                            let mut deleted = false;
                            if let Some(mut list) = db_clone.messages.get_mut(channel_id) {
                                if let Some(idx) = list.iter().position(|m| m.id == message_id) {
                                    if list[idx].username == client_username {
                                        list.remove(idx);
                                        deleted = true;
                                    }
                                }
                                if deleted {
                                    drop(list);
                                    // Persist deletion to Turso
                                    let channel_id_owned = channel_id.to_string();
                                    let db_persist = db_clone.clone();
                                    let msgs_snap = db_persist.messages.get(&channel_id_owned).map(|m| m.value().clone());
                                    if let Some(msgs_snap) = msgs_snap {
                                        tokio::spawn(async move {
                                            db_persist.upsert_messages_pub(&channel_id_owned, &msgs_snap).await;
                                        });
                                    }

                                    {
                                        let mut st = session_clone.state.write().await;
                                        st.chat_messages.retain(|m| m.id != message_id);
                                    }
                                    
                                    let broadcast_msg = serde_json::json!({
                                        "type": "message_deleted",
                                        "message_id": message_id
                                    });
                                    let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                                }
                            }
                        }
                    }
                    "excalidraw_elements" => {
                        if let Some(elements) = msg.get("elements").and_then(|e| e.as_array()) {
                            let mut st = session_clone.state.write().await;
                            st.excalidraw_elements = elements.clone();
                        }
                        let broadcast_msg = serde_json::json!({
                            "type": "excalidraw_elements",
                            "user_id": *client_uid_clone.read().await,
                            "elements": msg.get("elements")
                        });
                        let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                    }
                    "sheet_update" => {
                        if let Some(grid) = msg.get("data").and_then(|d| d.as_array()) {
                            let mut parsed_grid = Vec::new();
                            for row_val in grid {
                                if let Some(row_arr) = row_val.as_array() {
                                    let mut parsed_row = Vec::new();
                                    for cell_val in row_arr {
                                        parsed_row.push(cell_val.as_str().unwrap_or("").to_string());
                                    }
                                    parsed_grid.push(parsed_row);
                                }
                            }
                            {
                                let mut st = session_clone.state.write().await;
                                st.spreadsheet_grid = parsed_grid;
                            }
                            let broadcast_msg = serde_json::json!({
                                "type": "sheet_update",
                                "data": msg.get("data"),
                                "user_id": *client_uid_clone.read().await
                            });
                            let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                        }
                    }

                    "doc_update" => {
                        if let Some(doc_str) = msg.get("content").and_then(|c| c.as_str()) {
                            {
                                let mut st = session_clone.state.write().await;
                                st.document_content = doc_str.to_string();
                            }
                            let broadcast_msg = serde_json::json!({
                                "type": "doc_update",
                                "content": doc_str,
                                "user_id": *client_uid_clone.read().await
                            });
                            let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                        }
                    }
                    "webrtc_join_call" => {
                        let uid = client_uid_clone.read().await.clone();
                        let uname = client_uname_clone.read().await.clone();
                        let participant = CallParticipant {
                            user_id: uid.clone(),
                            username: uname,
                            is_audio_muted: msg.get("muted").and_then(|m| m.as_bool()).unwrap_or(false),
                            is_video_off: msg.get("video_off").and_then(|v| v.as_bool()).unwrap_or(false),
                            is_screen_sharing: false,
                            joined_at: chrono::Utc::now().to_rfc3339(),
                        };
                        {
                            let mut st = session_clone.state.write().await;
                            st.active_call_participants.insert(uid.clone(), participant.clone());
                        }
                        let broadcast_msg = serde_json::json!({
                            "type": "webrtc_user_joined_call",
                            "participant": participant
                        });
                        let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                    }
                    "webrtc_leave_call" => {
                        let uid = client_uid_clone.read().await.clone();
                        {
                            let mut st = session_clone.state.write().await;
                            st.active_call_participants.remove(&uid);
                        }
                        let broadcast_msg = serde_json::json!({
                            "type": "webrtc_user_left_call",
                            "user_id": uid
                        });
                        let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                    }
                    "webrtc_signal" => {
                        let broadcast_msg = serde_json::json!({
                            "type": "webrtc_signal",
                            "from_user_id": *client_uid_clone.read().await,
                            "to_user_id": msg.get("to_user_id"),
                            "signal": msg.get("signal")
                        });
                        let _ = session_clone.broadcast.send(broadcast_msg.to_string());
                    }
                    _ => {}
                }
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    session.user_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    if *authenticated.read().await {
        let uid = client_user_id.read().await.clone();
        if !uid.is_empty() {
            {
                let mut st = session.state.write().await;
                st.active_call_participants.remove(&uid);
            }
            let leave_msg = serde_json::json!({
                "type": "user_left",
                "user_id": uid
            });
            let _ = session.broadcast.send(leave_msg.to_string());
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteReq {
    pub token: String,
    pub company_id: String,
    pub role: CompanyRole,
    pub duration_mins: Option<u64>,
    pub max_uses: Option<u32>,
}

async fn create_invite_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateInviteReq>,
) -> impl IntoResponse {
    let user_id = match state.db.verify_token(&payload.token).await {
        Ok(claims) => claims.user_id,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Invalid token"}))),
    };

    match state.db.create_invite(&user_id, &payload.company_id, payload.role, payload.duration_mins, payload.max_uses).await {
        Ok(invite) => (StatusCode::OK, Json(serde_json::json!({"success": true, "invite": invite}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "error": e.to_string()}))),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListInvitesReq {
    pub token: String,
    pub company_id: String,
}

async fn list_invites_handler(
    State(state): State<AppState>,
    Query(payload): Query<ListInvitesReq>,
) -> impl IntoResponse {
    let claims = match state.db.verify_token(&payload.token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Invalid token"}))),
    };

    if !state.db.is_company_admin_or_owner(&claims.user_id, &payload.company_id) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "error": "Forbidden: only owners or admins can list invites", "invites": []})));
    }

    let invites = state.db.get_company_invites(&payload.company_id).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "invites": invites})))
}

#[derive(Debug, Deserialize)]
pub struct RevokeInviteReq {
    pub token: String,
    pub company_id: String,
    pub code: String,
}

async fn revoke_invite_handler(
    State(state): State<AppState>,
    Json(payload): Json<RevokeInviteReq>,
) -> impl IntoResponse {
    let user_id = match state.db.verify_token(&payload.token).await {
        Ok(claims) => claims.user_id,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Invalid token"}))),
    };

    match state.db.revoke_invite(&user_id, &payload.company_id, &payload.code).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"success": true}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "error": e.to_string()}))),
    }
}

#[derive(Debug, Deserialize)]
pub struct JoinInviteReq {
    pub token: String,
    pub code: String,
}

async fn join_invite_handler(
    State(state): State<AppState>,
    Json(payload): Json<JoinInviteReq>,
) -> impl IntoResponse {
    let (user_id, username) = match state.db.verify_token(&payload.token).await {
        Ok(claims) => (claims.user_id, claims.username),
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Invalid token"}))),
    };

    match state.db.join_by_invite(&user_id, &username, &payload.code).await {
        Ok(comp) => (StatusCode::OK, Json(serde_json::json!({"success": true, "company": comp}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "error": e.to_string()}))),
    }
}

// ── Storage / Media Upload Handlers ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct StorageUploadReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub name: String,
    pub file_type: String,
    pub data_base64: String,
}

#[derive(Serialize)]
pub struct StorageUploadRes {
    pub success: bool,
    pub url: String,
    pub name: String,
    pub file_type: String,
    pub size: usize,
}

async fn upload_storage_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<StorageUploadReq>,
) -> impl IntoResponse {
    let token = match extract_token(&headers, payload.token.as_deref()) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Unauthorized: missing token"}))).into_response(),
    };

    let claims = match state.db.verify_token(&token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Unauthorized: invalid token"}))).into_response(),
    };

    if let Some(ref cid) = payload.company_id {
        if !state.db.is_company_member(&claims.user_id, cid) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "error": "Forbidden: user does not belong to this organization"}))).into_response();
        }
    }

    use base64::Engine;
    let b64_clean = if let Some(pos) = payload.data_base64.find(',') {
        &payload.data_base64[pos + 1..]
    } else {
        &payload.data_base64
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(b64_clean) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "error": "Invalid base64"}))).into_response(),
    };

    let file_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let sanitized_name = payload.name.chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let stored_file_name = format!("{}_{}", file_id, sanitized_name);
    let upload_path = format!("public/uploads/{}", stored_file_name);

    if let Err(e) = tokio::fs::write(&upload_path, &bytes).await {
        tracing::error!("Failed to write uploaded file {}: {}", upload_path, e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"success": false, "error": "Failed to persist file"}))).into_response();
    }

    let download_url = format!("/api/storage/file/{}/{}", file_id, sanitized_name);
    (StatusCode::OK, Json(StorageUploadRes {
        success: true,
        url: download_url,
        name: payload.name,
        file_type: payload.file_type,
        size: bytes.len(),
    })).into_response()
}

async fn get_storage_file_handler(
    Path((key, filename)): Path<(String, String)>,
) -> impl IntoResponse {
    let stored_file_name = format!("{}_{}", key, filename);
    let path = format!("public/uploads/{}", stored_file_name);

    match tokio::fs::read(&path).await {
        Ok(contents) => {
            let mime = if filename.ends_with(".png") {
                "image/png"
            } else if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                "image/jpeg"
            } else if filename.ends_with(".gif") {
                "image/gif"
            } else if filename.ends_with(".webp") {
                "image/webp"
            } else if filename.ends_with(".svg") {
                "image/svg+xml"
            } else if filename.ends_with(".pdf") {
                "application/pdf"
            } else {
                "application/octet-stream"
            };

            let headers = [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ];
            (StatusCode::OK, headers, contents).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "File not found").into_response(),
    }
}

async fn purge_inactive_cron_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if let Ok(cron_secret) = std::env::var("CRON_SECRET") {
        let auth_hdr = headers.get("authorization").and_then(|h| h.to_str().ok());
        let expected = format!("Bearer {}", cron_secret);
        if auth_hdr != Some(&expected) {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Unauthorized cron trigger"}))).into_response();
        }
    }

    run_inactivity_sweeper_tick(&state.db, &state.sessions).await;
    (StatusCode::OK, Json(serde_json::json!({"success": true, "message": "Purge sweeper executed successfully"}))).into_response()
}



