use std::sync::Arc;
use std::time::Duration;
use dashmap::DashMap;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use theysynced::{create_app, cleanup_inactive_sessions, run_inactivity_sweeper_tick, AppState, database::Database};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db = Database::new().await?;

    let state = AppState {
        db: Arc::new(db),
        sessions: Arc::new(DashMap::new()),
        vfs_hub: Arc::new(theysynced::vfs::VfsHub::new()),
        cookie_jar: Arc::new(DashMap::new()),
    };

    let cleanup_state = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            cleanup_inactive_sessions(&cleanup_state).await;
        }
    });

    let app = create_app(state.clone());

    // Background Inactivity Auto-Purge Sweeper:
    // Workspaces inactive for 90 days (3 months) are permanently and irreversibly purged
    let sweeper_db = state.db.clone();
    let sweeper_sessions = state.sessions.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            run_inactivity_sweeper_tick(&sweeper_db, &sweeper_sessions).await;
        }
    });

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "8000".to_string());
    let addr = format!("{}:{}", host, port);

    tracing::info!("🚀 TheySynced Rust Axum API & WebSocket engine running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
