use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{vfs::Cred, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalMode {
    ModeA, // Browser-side real Linux via v86 (default)
    ModeB, // Server-side ephemeral container per company/session
}

pub fn get_configured_terminal_mode() -> TerminalMode {
    match std::env::var("TERMINAL_MODE")
        .unwrap_or_else(|_| "mode_a".to_string())
        .to_lowercase()
        .as_str()
    {
        "mode_b" | "container" => TerminalMode::ModeB,
        _ => TerminalMode::ModeA,
    }
}

pub fn is_container_runtime_available() -> bool {
    if let Ok(output) = std::process::Command::new("docker").arg("--version").output() {
        if output.status.success() {
            if let Ok(info) = std::process::Command::new("docker").arg("info").output() {
                return info.status.success();
            }
        }
    }
    if let Ok(output) = std::process::Command::new("podman").arg("--version").output() {
        if output.status.success() {
            if let Ok(info) = std::process::Command::new("podman").arg("info").output() {
                return info.status.success();
            }
        }
    }
    false
}

#[derive(Debug, Serialize)]
pub struct TerminalConfigResponse {
    pub mode: TerminalMode,
    pub container_runtime_available: bool,
    pub active_mode: TerminalMode,
    pub kernel_url: &'static str,
    pub wasm_url: &'static str,
    pub bios_url: &'static str,
    pub vga_bios_url: &'static str,
    pub arch_snapshot_usable: bool,
    pub explanation: &'static str,
}

pub async fn terminal_config_handler() -> impl IntoResponse {
    let configured_mode = get_configured_terminal_mode();
    let runtime_available = is_container_runtime_available();

    let active_mode = if configured_mode == TerminalMode::ModeB {
        if runtime_available {
            TerminalMode::ModeB
        } else {
            tracing::warn!(
                "TERMINAL_MODE=mode_b configured, but container runtime (Docker/Podman) is not active. Falling back to Mode A (v86)."
            );
            TerminalMode::ModeA
        }
    } else {
        TerminalMode::ModeA
    };

    Json(TerminalConfigResponse {
        mode: configured_mode,
        container_runtime_available: runtime_available,
        active_mode,
        kernel_url: "/v86/buildroot-bzimage.bin",
        wasm_url: "/v86/v86.wasm",
        bios_url: "/v86/seabios.bin",
        vga_bios_url: "/v86/vgabios.bin",
        arch_snapshot_usable: false,
        explanation: "arch_state-v3.bin.zst requires its original matching disk image (arch.img) which is not in repository assets. Mode A boots real Linux 5.6.15 Buildroot kernel with native BusyBox userland.",
    })
}

#[derive(Deserialize)]
pub struct TerminalWsQuery {
    pub token: Option<String>,
    pub company_id: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

pub async fn terminal_ws_handler(
    State(state): State<AppState>,
    ws: Option<WebSocketUpgrade>,
    headers: HeaderMap,
    Query(query): Query<TerminalWsQuery>,
) -> impl IntoResponse {
    let configured_mode = get_configured_terminal_mode();
    let runtime_available = is_container_runtime_available();

    if configured_mode == TerminalMode::ModeA || !runtime_available {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "text/plain".to_string())],
            "503 Mode A is active: browser-side real Linux via v86. Connect to terminal via v86 client.".to_string(),
        ).into_response();
    }

    let ws = match ws {
        Some(w) => w,
        None => return (StatusCode::BAD_REQUEST, "WebSocket upgrade required").into_response(),
    };

    let token = match crate::extract_token(&headers, query.token.as_deref()) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "Unauthorized: valid session token required").into_response(),
    };

    let claims = match state.db.verify_token(&token).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, "Unauthorized: invalid session token").into_response(),
    };

    let company_id = match query.company_id {
        Some(ref cid) if !cid.is_empty() => cid.clone(),
        _ => return (StatusCode::BAD_REQUEST, "Missing company_id parameter").into_response(),
    };

    let cred = match state.db.get_user_vfs_cred(&company_id, &claims.user_id).await {
        Some(c) => c,
        None => return (StatusCode::FORBIDDEN, "Forbidden: not a member of this company").into_response(),
    };

    let state_clone = state.clone();
    ws.on_upgrade(move |socket| handle_container_terminal_websocket(socket, state_clone, cred, company_id))
        .into_response()
}

async fn handle_container_terminal_websocket(
    socket: WebSocket,
    state: AppState,
    cred: Cred,
    _company_id: String,
) {
    let runtime = if std::process::Command::new("docker").arg("--version").output().is_ok() {
        "docker"
    } else {
        "podman"
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    let session_dir = std::env::temp_dir().join(format!("theysynced-term-{}", session_id));
    let workspace_dir = session_dir.join("workspace");

    if let Err(e) = tokio::fs::create_dir_all(&workspace_dir).await {
        let mut s = socket;
        let _ = s.send(Message::Text(format!("\r\n\x1b[31mFailed to create session workspace: {}\x1b[0m\r\n", e))).await;
        return;
    }

    // Project accessible VFS files into workspace with session user permissions
    if let Ok(files) = state.db.vfs.export_tree(&cred).await {
        for file in files {
            let rel_path = file.path.trim_start_matches('/');
            let target_path = workspace_dir.join(rel_path);
            if let Some(parent) = target_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            let _ = tokio::fs::write(&target_path, file.content.as_bytes()).await;
        }
    }

    let container_name = format!("theysynced-term-{}", session_id);
    let mut cmd = tokio::process::Command::new(runtime);
    cmd.args([
        "run",
        "-i",
        "--rm",
        &format!("--name={}", container_name),
        "--cap-drop=ALL",
        "--cap-add=CHOWN",
        "--cap-add=SETUID",
        "--cap-add=SETGID",
        "--security-opt=no-new-privileges",
        "--memory=128m",
        "--cpus=0.5",
        "--pids-limit=64",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=32m",
        "--network",
        "none",
        "-v",
        &format!("{}:/workspace:rw", workspace_dir.display()),
        "--user",
        "10001:10001",
        "theysynced:latest",
        "/bin/sh",
    ]);

    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let mut s = socket;
            let _ = s.send(Message::Text(format!("\r\n\x1b[31mFailed to spawn container: {}\x1b[0m\r\n", e))).await;
            let _ = tokio::fs::remove_dir_all(&session_dir).await;
            return;
        }
    };

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();

    let (mut ws_sender, mut ws_receiver) = socket.split();

    let client_to_container = async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(t) => {
                    if stdin.write_all(t.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Message::Binary(b) => {
                    if stdin.write_all(&b).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };

    let container_to_client = async move {
        let mut buf = [0u8; 1024];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_sender.send(Message::Binary(buf[..n].to_vec())).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    };

    tokio::select! {
        _ = client_to_container => {},
        _ = container_to_client => {},
    }

    // Session ended: clean up container and temporary workspace
    let _ = child.kill().await;
    let _ = tokio::process::Command::new(runtime)
        .args(["rm", "-f", &container_name])
        .output()
        .await;
    let _ = tokio::fs::remove_dir_all(&session_dir).await;
}
