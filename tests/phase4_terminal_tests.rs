use std::sync::Arc;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dashmap::DashMap;
use tower::ServiceExt;

use theysynced::{
    create_app,
    database::Database,
    vfs::VfsHub,
    AppState,
};

async fn setup_phase4_test_app() -> (axum::Router, Arc<Database>) {
    std::env::set_var("TURSO_DATABASE_URL", ":memory:");
    std::env::set_var("JWT_SECRET", "test_jwt_secret_phase4_terminal_suite_2026");
    std::env::set_var("ORG_ENCRYPTION_SECRET", "test_org_encryption_secret_phase4_2026");

    let db = Arc::new(Database::new().await.unwrap());
    let vfs_hub = Arc::new(VfsHub::new());
    let state = AppState {
        db: db.clone(),
        sessions: Arc::new(DashMap::new()),
        vfs_hub,
        cookie_jar: Arc::new(DashMap::new()),
    };
    let app = create_app(state);
    (app, db)
}

#[tokio::test]
async fn test_terminal_config_endpoint() {
    let (app, _db) = setup_phase4_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/terminal/config")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    // Verify Mode A default, honest explanation, and real Linux kernel URL
    assert_eq!(json["mode"], "mode_a");
    assert_eq!(json["active_mode"], "mode_a");
    assert_eq!(json["arch_snapshot_usable"], false);
    assert_eq!(json["kernel_url"], "/v86/buildroot-bzimage.bin");
    assert!(json["explanation"].as_str().unwrap().contains("arch_state-v3.bin.zst requires its original matching disk image"));
}

#[tokio::test]
async fn test_terminal_ws_auth_and_isolation() {
    let (app, db) = setup_phase4_test_app().await;

    let (_tok_alice, alice, _) = db.sign_in("alice", "pass123").await.unwrap();
    let comp_a = db.create_company(&alice.id, &alice.username, "Comp A", false, None).await.unwrap();

    let (_tok_bob, bob, _) = db.sign_in("bob", "pass123").await.unwrap();
    let _comp_b = db.create_company(&bob.id, &bob.username, "Comp B", false, None).await.unwrap();

    // 1. Unauthenticated request to /ws/terminal fails with 401 or 503
    let req = Request::builder()
        .method("GET")
        .uri("/ws/terminal?company_id=comp_a")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status() == StatusCode::SERVICE_UNAVAILABLE || res.status() == StatusCode::UNAUTHORIZED);

    // 2. Token generation
    let alice_token = db.generate_token(&alice.id, &alice.username).unwrap();
    let bob_token = db.generate_token(&bob.id, &bob.username).unwrap();

    // 3. Mode A return message check
    let req = Request::builder()
        .method("GET")
        .uri(format!("/ws/terminal?token={}&company_id={}", alice_token, comp_a.id))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let text = String::from_utf8_lossy(&body);
    assert!(text.contains("Mode A is active: browser-side real Linux via v86"));

    // 4. Cross-company check: Bob tries to access Company A terminal
    let req = Request::builder()
        .method("GET")
        .uri(format!("/ws/terminal?token={}&company_id={}", bob_token, comp_a.id))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status() == StatusCode::SERVICE_UNAVAILABLE || res.status() == StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_vfs_export_tree_permissions_and_sealed_dm() {
    let (app, db) = setup_phase4_test_app().await;

    // 1. Sign in Alice (admin) and Bob and Charlie (members)
    let (_tok_alice, alice, _) = db.sign_in("alice_adm", "pass123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "Acme Corp", false, None).await.unwrap();

    let (_tok_bob, bob, _) = db.sign_in("bob_user", "pass123").await.unwrap();
    let _ = db.join_company(&bob.id, &bob.username, &comp.join_code).await.unwrap();

    let (_tok_charlie, charlie, _) = db.sign_in("charlie_user", "pass123").await.unwrap();
    let _ = db.join_company(&charlie.id, &charlie.username, &comp.join_code).await.unwrap();

    // 2. Open a sealed DM between Bob and Charlie
    let bob_cred = db.get_user_vfs_cred(&comp.id, &bob.id).await.unwrap();
    let dm_inode = db.vfs.open_or_create_dm(&bob_cred, &charlie.id, &charlie.username, &bob.username).await.unwrap();
    assert!(dm_inode.sealed, "DMs must be sealed");

    let dm_path = format!("/chats/dm/{}", dm_inode.name);

    // Refresh bob_cred so it contains the newly created DM group membership
    let bob_cred = db.get_user_vfs_cred(&comp.id, &bob.id).await.unwrap();
    db.vfs.append_message(&bob_cred, &dm_path, "confidential meeting notes").await.unwrap();

    // 3. Alice (Company Admin) calls /api/vfs/export-tree
    let alice_token = db.generate_token(&alice.id, &alice.username).unwrap();
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/vfs/export-tree?token={}&company_id={}", alice_token, comp.id))
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["success"].as_bool().unwrap());

    let files = json["files"].as_array().unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f["path"].as_str().unwrap()).collect();

    // Alice MUST NOT see Bob and Charlie's sealed DM
    assert!(!paths.contains(&dm_path.as_str()), "Admin must not see sealed DM between other users");

    // 4. Bob calls /api/vfs/export-tree
    let bob_token = db.generate_token(&bob.id, &bob.username).unwrap();
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/vfs/export-tree?token={}&company_id={}", bob_token, comp.id))
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let files = json["files"].as_array().unwrap();
    let bob_paths: Vec<&str> = files.iter().map(|f| f["path"].as_str().unwrap()).collect();

    // Bob IS part of the DM, so Bob MUST see the DM
    assert!(bob_paths.contains(&dm_path.as_str()), "Participant must see their own sealed DM");

    // Check message rendering as plain text lines
    let dm_file = files.iter().find(|f| f["path"].as_str().unwrap() == dm_path).unwrap();
    let content = dm_file["content"].as_str().unwrap();
    assert!(content.contains("confidential meeting notes"), "Chat file should render message text for cat/grep");
}

#[tokio::test]
async fn test_vfs_export_tree_cross_company_denial() {
    let (app, db) = setup_phase4_test_app().await;

    let (_tok_alice, alice, _) = db.sign_in("alice_x", "pass123").await.unwrap();
    let comp_a = db.create_company(&alice.id, &alice.username, "Company Alpha", false, None).await.unwrap();

    let (_tok_bob, bob, _) = db.sign_in("bob_x", "pass123").await.unwrap();
    let _comp_b = db.create_company(&bob.id, &bob.username, "Company Beta", false, None).await.unwrap();

    let bob_token = db.generate_token(&bob.id, &bob.username).unwrap();

    // Bob (member of Beta) attempts to export Alpha's tree
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/vfs/export-tree?token={}&company_id={}", bob_token, comp_a.id))
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}
