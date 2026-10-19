use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use std::sync::Arc;
use tower::ServiceExt;
use dashmap::DashMap;

use theysynced::{
    create_app,
    database::Database,
    vfs::{Cred, InodeKind, VfsHub},
    AppState,
};

async fn setup_vfs_test_app() -> (axum::Router, Arc<Database>) {
    std::env::set_var("TURSO_DATABASE_URL", ":memory:");
    std::env::set_var("JWT_SECRET", "test_jwt_secret_key_vfs_test_suite_2026");
    std::env::set_var("ORG_ENCRYPTION_SECRET", "test_org_encryption_secret_vfs_2026");

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
async fn test_vfs_standard_layout_and_stat() {
    let (app, db) = setup_vfs_test_app().await;

    // Register user Alice and create Company Alpha
    let (token_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp_a = db.create_company(&alice.id, &alice.username, "Alpha Corp", false, None).await.unwrap();

    let cred_alice = db.get_user_vfs_cred(&comp_a.id, &alice.id).await.unwrap();

    // Verify root inode '/'
    let root = db.vfs.stat(&cred_alice, "/").await.unwrap();
    assert_eq!(root.kind, InodeKind::Dir);
    assert_eq!(root.mode, 0o755);

    // Verify /etc, /home, /chats, /projects, /shared, /tmp, /proc
    let etc = db.vfs.stat(&cred_alice, "/etc").await.unwrap();
    assert_eq!(etc.kind, InodeKind::Dir);

    let chat_general = db.vfs.stat(&cred_alice, "/chats/public/general").await.unwrap();
    assert_eq!(chat_general.kind, InodeKind::Chat);
    assert_eq!(chat_general.mode, 0o664);

    let audit_log = db.vfs.stat(&cred_alice, "/var/log/audit").await.unwrap();
    assert_eq!(audit_log.kind, InodeKind::File);
    assert_eq!(audit_log.mode, 0o640);

    // Read /etc/passwd generated view
    let passwd_bytes = db.vfs.read(&cred_alice, "/etc/passwd").await.unwrap();
    let passwd_str = String::from_utf8(passwd_bytes).unwrap();
    assert!(passwd_str.contains("alice"));
    assert!(passwd_str.contains("/home/"));

    // Verify audit log has recorded the stat and read operations
    let req = Request::builder()
        .uri(format!("/api/vfs/stat?path=/chats/public/general&company_id={}&token={}", comp_a.id, token_alice))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_vfs_traversal_denial() {
    let (_app, db) = setup_vfs_test_app().await;

    // Create Company Alpha with Alice (owner) and Bob (regular member)
    let (_, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let (_, bob, _) = db.sign_in("bob", "password123").await.unwrap();
    let comp_a = db.create_company(&alice.id, &alice.username, "Alpha Corp", false, None).await.unwrap();
    let _ = db.join_company(&bob.id, &bob.username, &comp_a.join_code).await.unwrap();

    let cred_alice = db.get_user_vfs_cred(&comp_a.id, &alice.id).await.unwrap();
    let cred_bob = db.get_user_vfs_cred(&comp_a.id, &bob.id).await.unwrap();

    // Alice creates /restricted directory with mode 0700 (owner only rwx)
    let _ = db.vfs.mkdir(&cred_alice, "/restricted", 0o700).await.unwrap();

    // Alice creates /restricted/secret.txt
    let _ = db.vfs.create(&cred_alice, "/restricted/secret.txt", InodeKind::File, 0o644).await.unwrap();
    db.vfs.write(&cred_alice, "/restricted/secret.txt", b"top secret data").await.unwrap();

    // Alice can read
    let data = db.vfs.read(&cred_alice, "/restricted/secret.txt").await.unwrap();
    assert_eq!(data, b"top secret data");

    // Bob tries to read /restricted/secret.txt -> Traversal check MUST fail on /restricted with EACCES
    let bob_read = db.vfs.read(&cred_bob, "/restricted/secret.txt").await;
    assert!(bob_read.is_err());
    assert_eq!(bob_read.unwrap_err(), theysynced::vfs::VfsError::EACCES);

    // Bob tries to stat /restricted/secret.txt -> Traversal denied
    let bob_stat = db.vfs.stat(&cred_bob, "/restricted/secret.txt").await;
    assert!(bob_stat.is_err());
    assert_eq!(bob_stat.unwrap_err(), theysynced::vfs::VfsError::EACCES);
}

#[tokio::test]
async fn test_vfs_cross_company_isolation() {
    let (app, db) = setup_vfs_test_app().await;

    // Company Alpha (Alice) and Company Beta (Mallory)
    let (_, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let (token_mallory, mallory, _) = db.sign_in("mallory", "password123").await.unwrap();

    let comp_a = db.create_company(&alice.id, &alice.username, "Alpha Corp", false, None).await.unwrap();
    let comp_b = db.create_company(&mallory.id, &mallory.username, "Beta Corp", false, None).await.unwrap();

    let _cred_mallory = db.get_user_vfs_cred(&comp_b.id, &mallory.id).await.unwrap();

    // Mallory tries to access Alpha's root via VFS syscall directly with Beta credentials
    let cross_cred = Cred::new(&comp_a.id, &mallory.id, vec!["everyone".to_string()], false);
    // Mallory is not in company Alpha -> get_user_vfs_cred for comp_a returns None
    assert!(db.get_user_vfs_cred(&comp_a.id, &mallory.id).await.is_none());

    // Even if an attacker synthesizes a Cred struct with comp_a.id:
    // Mallory attempts to read Alpha's /etc/passwd
    let read_result = db.vfs.read(&cross_cred, "/etc/passwd").await;
    assert!(read_result.is_err());

    // Mallory attempts to access Alpha's VFS via HTTP API -> 403 Forbidden
    let req = Request::builder()
        .uri(format!("/api/vfs/readdir?path=/&company_id={}&token={}", comp_a.id, token_mallory))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Mallory can access her own company Beta VFS
    let req = Request::builder()
        .uri(format!("/api/vfs/stat?path=/&company_id={}&token={}", comp_b.id, token_mallory))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_vfs_chat_plain_text_rendering() {
    let (_app, db) = setup_vfs_test_app().await;

    let (_, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "Chat Test Org", false, None).await.unwrap();
    let cred = db.get_user_vfs_cred(&comp.id, &alice.id).await.unwrap();

    // Append messages to /chats/public/general
    let msg1 = db.vfs.append_message(&cred, "/chats/public/general", "Hello team! Welcome to TheySynced VFS.").await.unwrap();
    assert_eq!(msg1.body_encrypted, "Hello team! Welcome to TheySynced VFS.");

    let msg2 = db.vfs.append_message(&cred, "/chats/public/general", "This chat behaves like a real Linux file!").await.unwrap();
    assert_eq!(msg2.body_encrypted, "This chat behaves like a real Linux file!");

    // Reading /chats/public/general returns plain text lines so cat/grep work
    let content_bytes = db.vfs.read(&cred, "/chats/public/general").await.unwrap();
    let content_str = String::from_utf8(content_bytes).unwrap();

    assert!(content_str.contains("alice: Hello team! Welcome to TheySynced VFS."));
    assert!(content_str.contains("alice: This chat behaves like a real Linux file!"));
}

#[tokio::test]
async fn test_vfs_sealed_dm_isolation() {
    let (_app, db) = setup_vfs_test_app().await;

    // Admin Alice, Member Bob, Member Charlie in Company Alpha
    let (_, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let (_, bob, _) = db.sign_in("bob", "password123").await.unwrap();
    let (_, charlie, _) = db.sign_in("charlie", "password123").await.unwrap();

    let comp = db.create_company(&alice.id, &alice.username, "DM Test Org", false, None).await.unwrap();
    let _ = db.join_company(&bob.id, &bob.username, &comp.join_code).await.unwrap();
    let _ = db.join_company(&charlie.id, &charlie.username, &comp.join_code).await.unwrap();

    let cred_alice = db.get_user_vfs_cred(&comp.id, &alice.id).await.unwrap();
    let cred_bob = db.get_user_vfs_cred(&comp.id, &bob.id).await.unwrap();

    // Bob opens sealed DM with Charlie
    let dm_inode = db.vfs.open_or_create_dm(&cred_bob, &charlie.id, "charlie", "bob").await.unwrap();
    assert!(dm_inode.sealed);
    assert_eq!(dm_inode.mode, 0o660);

    let dm_path = format!("/chats/dm/{}", dm_inode.name);

    // Refresh credentials to load the new DM group membership
    let cred_bob = db.get_user_vfs_cred(&comp.id, &bob.id).await.unwrap();
    let cred_charlie = db.get_user_vfs_cred(&comp.id, &charlie.id).await.unwrap();

    // Bob appends message to DM
    let _ = db.vfs.append_message(&cred_bob, &dm_path, "Confidential: Q3 performance review").await.unwrap();

    // Charlie can read DM
    let charlie_read = db.vfs.read(&cred_charlie, &dm_path).await.unwrap();
    let charlie_text = String::from_utf8(charlie_read).unwrap();
    assert!(charlie_text.contains("Confidential: Q3 performance review"));

    // Alice (Company Owner/Admin) tries to read sealed DM -> MUST BE DENIED!
    let admin_read = db.vfs.read(&cred_alice, &dm_path).await;
    assert!(admin_read.is_err());
    assert_eq!(admin_read.unwrap_err(), theysynced::vfs::VfsError::EACCES);

    // Admin WITH break_glass explicitly set -> Allowed and audited
    let break_glass_cred = cred_alice.with_break_glass(true);
    let admin_break_glass_read = db.vfs.read(&break_glass_cred, &dm_path).await.unwrap();
    assert!(String::from_utf8(admin_break_glass_read).unwrap().contains("Confidential"));
}

#[tokio::test]
async fn test_vfs_http_api_crud() {
    let (app, db) = setup_vfs_test_app().await;

    let (token_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "HTTP VFS Org", false, None).await.unwrap();

    // 1. Create directory via POST /api/vfs/mkdir
    let req = Request::builder()
        .method("POST")
        .uri("/api/vfs/mkdir")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_alice,
            "company_id": comp.id,
            "path": "/shared/testdir",
            "mode": 0o775
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // 2. Create file via POST /api/vfs/create
    let req = Request::builder()
        .method("POST")
        .uri("/api/vfs/create")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_alice,
            "company_id": comp.id,
            "path": "/shared/testdir/notes.txt",
            "kind": "file",
            "mode": 0o644
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // 3. Write file via POST /api/vfs/write
    let req = Request::builder()
        .method("POST")
        .uri("/api/vfs/write")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_alice,
            "company_id": comp.id,
            "path": "/shared/testdir/notes.txt",
            "content": "Engineered with pure Rust VFS"
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 4. Read file via GET /api/vfs/read
    let req = Request::builder()
        .uri(format!("/api/vfs/read?path=/shared/testdir/notes.txt&company_id={}&token={}", comp.id, token_alice))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    assert_eq!(bytes.as_ref(), b"Engineered with pure Rust VFS");

    // 5. Rename file via POST /api/vfs/rename
    let req = Request::builder()
        .method("POST")
        .uri("/api/vfs/rename")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_alice,
            "company_id": comp.id,
            "old_path": "/shared/testdir/notes.txt",
            "new_path": "/shared/testdir/renamed_notes.txt"
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 6. Delete file via POST /api/vfs/unlink
    let req = Request::builder()
        .method("POST")
        .uri("/api/vfs/unlink")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&serde_json::json!({
            "token": token_alice,
            "company_id": comp.id,
            "path": "/shared/testdir/renamed_notes.txt"
        })).unwrap()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
