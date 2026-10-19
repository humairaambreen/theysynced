use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use std::sync::Arc;
use dashmap::DashMap;
use tower::ServiceExt; // for oneshot
use theysynced::{create_app, database::Database, AppState};

async fn setup_test_app() -> (axum::Router, Arc<Database>) {
    std::env::set_var("TURSO_DATABASE_URL", ":memory:");
    std::env::set_var("JWT_SECRET", "test_secret_key_1234567890_test_jwt");
    let db = Arc::new(Database::new().await.expect("Failed to initialize test database"));
    let state = AppState {
        db: db.clone(),
        sessions: Arc::new(DashMap::new()),
        vfs_hub: Arc::new(theysynced::vfs::VfsHub::new()),
        cookie_jar: Arc::new(DashMap::new()),
    };
    let app = create_app(state);
    (app, db)
}

#[tokio::test]
async fn test_terminal_disabled_503() {
    let (app, _) = setup_test_app().await;

    let req = Request::builder()
        .uri("/ws/terminal")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn test_browser_proxy_requires_auth() {
    let (app, _) = setup_test_app().await;

    // 1. Missing token
    let req = Request::builder()
        .uri("/api/browser/proxy?url=https://example.com")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 2. Invalid token
    let req = Request::builder()
        .uri("/api/browser/proxy?url=https://example.com&token=invalid_token")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_browser_proxy_blocks_ssrf() {
    let (app, db) = setup_test_app().await;

    // Create a user and get a valid token
    let (token, _user, _) = db.sign_in("alice", "password123").await.unwrap();

    // Loopback IPv4
    let req = Request::builder()
        .uri(format!("/api/browser/proxy?url=http://127.0.0.1:8080&token={}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Cloud Metadata
    let req = Request::builder()
        .uri(format!("/api/browser/proxy?url=http://169.254.169.254/latest/meta-data/&token={}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Localhost hostname
    let req = Request::builder()
        .uri(format!("/api/browser/proxy?url=http://localhost:3000&token={}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_cross_company_isolation_and_authorization() {
    let (app, db) = setup_test_app().await;

    // Register User A (Alice) and User B (Bob)
    let (token_a, user_a, _) = db.sign_in("alice", "password123").await.unwrap();
    let (_token_b, user_b, _) = db.sign_in("bob", "password123").await.unwrap();

    // Create Company A (owned by Alice) and Company B (owned by Bob)
    let _comp_a = db.create_company(&user_a.id, "alice", "Alice Corp", true, None).await.unwrap();
    let comp_b = db.create_company(&user_b.id, "bob", "Bob Corp", true, None).await.unwrap();

    // Alice attempts to list assets in Bob's company -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .uri(format!("/api/assets/list?token={}&company_id={}", token_a, comp_b.id))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Alice attempts to list teams in Bob's company -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .uri(format!("/api/teams/list?token={}&company_id={}", token_a, comp_b.id))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Alice attempts to create a team in Bob's company -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .method("POST")
        .uri("/api/teams/create")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_a,
            "company_id": comp_b.id,
            "name": "Intruder Team",
            "description": "Exploit"
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Alice attempts to save chat message in Bob's company -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .method("POST")
        .uri("/api/chat/messages/save")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_a,
            "channel_id": comp_b.id,
            "company_id": comp_b.id,
            "message": "Spying message"
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Alice attempts to touch Bob's company activity -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .method("POST")
        .uri("/api/companies/touch-activity")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_a,
            "company_id": comp_b.id,
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Alice attempts to search Bob's company -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .method("POST")
        .uri("/api/search")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_a,
            "company_id": comp_b.id,
            "query": "financials"
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Alice attempts to list invites in Bob's company -> MUST BE FORBIDDEN (403)
    let req = Request::builder()
        .uri(format!("/api/invites/list?token={}&company_id={}", token_a, comp_b.id))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_purge_inactive_cron() {
    let (app, _db) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/cron/purge-inactive")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

