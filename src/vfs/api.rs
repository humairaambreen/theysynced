use std::sync::Arc;
use axum::{
    extract::{Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use chrono::Utc;
use tokio::sync::mpsc;

use crate::{database::Database, extract_token, AppState};
use super::{
    perms::can_read,
    schema::{Cred, InodeKind, VfsError, VfsInode},
};

// ── VFS Realtime Event Hub ────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VfsChangeEvent {
    pub company_id: String,
    pub op: String,
    pub path: String,
    pub inode_id: String,
    pub kind: String,
    pub ts: String,
}

pub struct VfsSubscriber {
    pub cred: Cred,
    pub sender: mpsc::UnboundedSender<String>,
}

#[derive(Clone)]
pub struct VfsHub {
    subscribers: Arc<DashMap<String, VfsSubscriber>>,
}

impl VfsHub {
    pub fn new() -> Self {
        Self {
            subscribers: Arc::new(DashMap::new()),
        }
    }

    pub fn subscribe(&self, id: String, cred: Cred, sender: mpsc::UnboundedSender<String>) {
        self.subscribers.insert(id, VfsSubscriber { cred, sender });
    }

    pub fn unsubscribe(&self, id: &str) {
        self.subscribers.remove(id);
    }

    /// Broadcasts a live filesystem event to connected subscribers.
    /// CRITICAL: Every subscriber is filtered with `can_read(&sub.cred, inode, acl)`.
    /// If the subscriber lacks read permission, the event is completely omitted.
    pub async fn broadcast_change(&self, db: &Database, op: &str, path: &str, inode: &VfsInode) {
        let event = VfsChangeEvent {
            company_id: inode.company_id.clone(),
            op: op.to_string(),
            path: path.to_string(),
            inode_id: inode.id.clone(),
            kind: inode.kind.as_str().to_string(),
            ts: Utc::now().to_rfc3339(),
        };

        let msg = serde_json::json!({
            "type": "vfs_change",
            "op": event.op,
            "path": event.path,
            "inode_id": event.inode_id,
            "kind": event.kind,
            "ts": event.ts,
        }).to_string();

        for entry in self.subscribers.iter() {
            let sub = entry.value();
            if sub.cred.company_id == event.company_id {
                let acl = db.vfs.get_acl(&event.company_id, &inode.id, &sub.cred.uid).await.unwrap_or(None);
                if can_read(&sub.cred, inode, acl.as_ref()) {
                    let _ = sub.sender.send(msg.clone());
                }
            }
        }
    }
}

// ── Shared Helper to Authenticate & Build Cred ────────────────────────────────

async fn authenticate_cred(
    db: &Database,
    headers: &HeaderMap,
    query_or_body_token: Option<&str>,
    req_company_id: Option<&str>,
) -> Result<(Cred, String), (StatusCode, Json<serde_json::Value>)> {
    let token = extract_token(headers, query_or_body_token)
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Unauthorized: missing token"}))))?;

    let claims = db.verify_token(&token).await
        .map_err(|_| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "Unauthorized: invalid session token"}))))?;

    // Determine target company_id
    let company_id = if let Some(cid) = req_company_id {
        cid.to_string()
    } else {
        // Fallback to user's first company
        let user = db.get_user_by_id(&claims.user_id)
            .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"success": false, "error": "User not found"}))))?;
        user.company_ids.first().cloned().unwrap_or_else(|| "comp_theysynced".to_string())
    };

    let cred = db.get_user_vfs_cred(&company_id, &claims.user_id).await
        .ok_or_else(|| (StatusCode::FORBIDDEN, Json(serde_json::json!({"success": false, "error": "Forbidden: user does not belong to this organization"}))))?;

    Ok((cred, claims.username))
}

fn vfs_err_resp(e: VfsError) -> (StatusCode, Json<serde_json::Value>) {
    (e.status_code(), Json(serde_json::json!({
        "success": false,
        "error": e.to_string(),
        "errno": e.errno_str()
    })))
}

// ── Request Structs ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct VfsQuery {
    pub path: Option<String>,
    pub company_id: Option<String>,
    pub token: Option<String>,
    pub limit: Option<usize>,
    pub before_ts: Option<String>,
}

#[derive(Deserialize)]
pub struct VfsWriteReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct VfsCreateReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub kind: String,
    pub mode: Option<u32>,
}

#[derive(Deserialize)]
pub struct VfsMkdirReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub mode: Option<u32>,
}

#[derive(Deserialize)]
pub struct VfsPathReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
pub struct VfsRenameReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub old_path: String,
    pub new_path: String,
}

#[derive(Deserialize)]
pub struct VfsChmodReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub mode: u32,
}

#[derive(Deserialize)]
pub struct VfsChownReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub owner: String,
}

#[derive(Deserialize)]
pub struct VfsChgrpReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub gid: String,
}

#[derive(Deserialize)]
pub struct VfsSymlinkReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub target: String,
    pub link_path: String,
}

#[derive(Deserialize)]
pub struct VfsSetfaclReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub target_uid: String,
    pub perms: u32,
}

#[derive(Deserialize)]
pub struct VfsAppendMessageReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub path: String,
    pub message: String,
}

#[derive(Deserialize)]
pub struct VfsOpenDmReq {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub target_uid: String,
    pub target_name: String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

pub async fn vfs_stat_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let path = q.path.as_deref().unwrap_or("/");
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.stat(&cred, path).await {
        Ok(inode) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "inode": inode }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_readdir_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let path = q.path.as_deref().unwrap_or("/");
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.readdir(&cred, path).await {
        Ok(entries) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "entries": entries }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_read_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let path = q.path.as_deref().unwrap_or("/");
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.read(&cred, path).await {
        Ok(bytes) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        ).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_write_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsWriteReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.write(&cred, &payload.path, payload.content.as_bytes()).await {
        Ok(()) => {
            if let Ok(inode) = state.db.vfs.stat(&cred, &payload.path).await {
                state.vfs_hub.broadcast_change(&state.db, "write", &payload.path, &inode).await;
            }
            (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_create_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsCreateReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    let kind = InodeKind::from_str_name(&payload.kind).unwrap_or(InodeKind::File);
    let mode = payload.mode.unwrap_or(0o644);

    match state.db.vfs.create(&cred, &payload.path, kind, mode).await {
        Ok(inode) => {
            state.vfs_hub.broadcast_change(&state.db, "create", &payload.path, &inode).await;
            (StatusCode::CREATED, Json(serde_json::json!({ "success": true, "inode": inode }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_mkdir_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsMkdirReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    let mode = payload.mode.unwrap_or(0o755);

    match state.db.vfs.mkdir(&cred, &payload.path, mode).await {
        Ok(inode) => {
            state.vfs_hub.broadcast_change(&state.db, "mkdir", &payload.path, &inode).await;
            (StatusCode::CREATED, Json(serde_json::json!({ "success": true, "inode": inode }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_unlink_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsPathReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    let existing = state.db.vfs.stat(&cred, &payload.path).await.ok();

    match state.db.vfs.unlink(&cred, &payload.path).await {
        Ok(()) => {
            if let Some(inode) = existing {
                state.vfs_hub.broadcast_change(&state.db, "unlink", &payload.path, &inode).await;
            }
            (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_rmdir_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsPathReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    let existing = state.db.vfs.stat(&cred, &payload.path).await.ok();

    match state.db.vfs.rmdir(&cred, &payload.path).await {
        Ok(()) => {
            if let Some(inode) = existing {
                state.vfs_hub.broadcast_change(&state.db, "rmdir", &payload.path, &inode).await;
            }
            (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_rename_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsRenameReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.rename(&cred, &payload.old_path, &payload.new_path).await {
        Ok(()) => {
            if let Ok(inode) = state.db.vfs.stat(&cred, &payload.new_path).await {
                state.vfs_hub.broadcast_change(&state.db, "rename", &payload.new_path, &inode).await;
            }
            (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_chmod_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsChmodReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.chmod(&cred, &payload.path, payload.mode).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_chown_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsChownReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.chown(&cred, &payload.path, &payload.owner).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_chgrp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsChgrpReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.chgrp(&cred, &payload.path, &payload.gid).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_symlink_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsSymlinkReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.symlink(&cred, &payload.target, &payload.link_path).await {
        Ok(inode) => {
            state.vfs_hub.broadcast_change(&state.db, "symlink", &payload.link_path, &inode).await;
            (StatusCode::CREATED, Json(serde_json::json!({ "success": true, "inode": inode }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_readlink_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let path = q.path.as_deref().unwrap_or("/");
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.readlink(&cred, path).await {
        Ok(target) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "target": target }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_setfacl_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsSetfaclReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.setfacl(&cred, &payload.path, &payload.target_uid, payload.perms).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_getfacl_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let path = q.path.as_deref().unwrap_or("/");
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.getfacl(&cred, path).await {
        Ok(acls) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "acl": acls }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_append_message_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsAppendMessageReq>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.append_message(&cred, &payload.path, &payload.message).await {
        Ok(msg) => {
            if let Ok(inode) = state.db.vfs.stat(&cred, &payload.path).await {
                state.vfs_hub.broadcast_change(&state.db, "message", &payload.path, &inode).await;
            }
            (StatusCode::OK, Json(serde_json::json!({ "success": true, "message": msg }))).into_response()
        }
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_read_messages_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let path = q.path.as_deref().unwrap_or("/");
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    let limit = q.limit.unwrap_or(50);
    match state.db.vfs.read_messages(&cred, path, limit, q.before_ts.as_deref()).await {
        Ok(msgs) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "messages": msgs }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

pub async fn vfs_open_dm_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VfsOpenDmReq>,
) -> impl IntoResponse {
    let (cred, caller_name) = match authenticate_cred(&state.db, &headers, payload.token.as_deref(), payload.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.open_or_create_dm(&cred, &payload.target_uid, &payload.target_name, &caller_name).await {
        Ok(inode) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "inode": inode }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

// ── WebSocket Handler: /ws/vfs ────────────────────────────────────────────────

pub async fn vfs_websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err((status, msg)) => return (status, msg.to_string()).into_response(),
    };

    ws.on_upgrade(move |socket| handle_vfs_socket(socket, state, cred))
}

async fn handle_vfs_socket(socket: WebSocket, state: AppState, cred: Cred) {
    let (mut sender, mut receiver) = socket.split();
    let sub_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    state.vfs_hub.subscribe(sub_id.clone(), cred.clone(), tx);

    // Task to forward change events from channel to client websocket
    let mut send_task = tokio::spawn(async move {
        while let Some(msg_str) = rx.recv().await {
            if sender.send(Message::Text(msg_str)).await.is_err() {
                break;
            }
        }
    });

    // Task to read incoming client messages (e.g. ping)
    let hub_clone = state.vfs_hub.clone();
    let sub_id_clone = sub_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Close(_) => break,
                _ => {}
            }
        }
        hub_clone.unsubscribe(&sub_id_clone);
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    state.vfs_hub.unsubscribe(&sub_id);
}

pub async fn vfs_export_tree_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<VfsQuery>,
) -> impl IntoResponse {
    let (cred, _) = match authenticate_cred(&state.db, &headers, q.token.as_deref(), q.company_id.as_deref()).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };

    match state.db.vfs.export_tree(&cred).await {
        Ok(files) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "files": files }))).into_response(),
        Err(e) => vfs_err_resp(e).into_response(),
    }
}

// ── Router Registration ───────────────────────────────────────────────────────

pub fn vfs_routes() -> Router<AppState> {
    Router::new()
        .route("/api/vfs/stat", get(vfs_stat_handler))
        .route("/api/vfs/readdir", get(vfs_readdir_handler))
        .route("/api/vfs/read", get(vfs_read_handler))
        .route("/api/vfs/write", post(vfs_write_handler))
        .route("/api/vfs/create", post(vfs_create_handler))
        .route("/api/vfs/mkdir", post(vfs_mkdir_handler))
        .route("/api/vfs/unlink", post(vfs_unlink_handler))
        .route("/api/vfs/rmdir", post(vfs_rmdir_handler))
        .route("/api/vfs/rename", post(vfs_rename_handler))
        .route("/api/vfs/chmod", post(vfs_chmod_handler))
        .route("/api/vfs/chown", post(vfs_chown_handler))
        .route("/api/vfs/chgrp", post(vfs_chgrp_handler))
        .route("/api/vfs/symlink", post(vfs_symlink_handler))
        .route("/api/vfs/readlink", get(vfs_readlink_handler))
        .route("/api/vfs/setfacl", post(vfs_setfacl_handler))
        .route("/api/vfs/getfacl", get(vfs_getfacl_handler))
        .route("/api/vfs/message/append", post(vfs_append_message_handler))
        .route("/api/vfs/message/list", get(vfs_read_messages_handler))
        .route("/api/vfs/dm/open", post(vfs_open_dm_handler))
        .route("/api/vfs/export-tree", get(vfs_export_tree_handler))
        .route("/ws/vfs", get(vfs_websocket_handler))
}
