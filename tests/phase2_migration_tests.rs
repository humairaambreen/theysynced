use std::sync::Arc;
use dashmap::DashMap;

use theysynced::{
    create_app,
    database::{Database, WorkspaceAsset, ChatMessage, CompanyRole},
    vfs::{InodeKind, VfsHub},
    AppState,
};

async fn setup_phase2_test_db() -> Arc<Database> {
    std::env::set_var("TURSO_DATABASE_URL", ":memory:");
    std::env::set_var("JWT_SECRET", "test_jwt_secret_phase2_migration_suite_2026");
    std::env::set_var("ORG_ENCRYPTION_SECRET", "test_org_encryption_secret_phase2_2026");

    let db = Arc::new(Database::new().await.unwrap());
    let vfs_hub = Arc::new(VfsHub::new());
    let state = AppState {
        db: db.clone(),
        sessions: Arc::new(DashMap::new()),
        vfs_hub,
        cookie_jar: Arc::new(DashMap::new()),
    };
    let _app = create_app(state);
    db
}

#[tokio::test]
async fn test_phase2_migration_and_backup() {
    let db = setup_phase2_test_db().await;

    // 1. Sign in Alice and create company
    let (_tok_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let _comp = db.create_company(&alice.id, &alice.username, "Legacy Corp", false, None).await.unwrap();

    // 2. Insert dummy legacy data into ts_* tables
    let _ = db.get_turso().execute_batch("
        CREATE TABLE IF NOT EXISTS ts_companies (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ts_teams (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ts_assets (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ts_messages (key TEXT PRIMARY KEY, data TEXT NOT NULL);

        INSERT OR REPLACE INTO ts_companies (id, data) VALUES ('legacy_comp_1', '{\"id\":\"legacy_comp_1\"}');
        INSERT OR REPLACE INTO ts_teams (company_id, data) VALUES ('legacy_comp_1', '[]');
        INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES ('legacy_comp_1', '[]');
        INSERT OR REPLACE INTO ts_messages (key, data) VALUES ('legacy_comp_1', '[]');
    ").await;

    // Reset migration lock so migrate_legacy_to_vfs processes the legacy data
    let _ = db.get_turso().execute("DELETE FROM vfs_migrations WHERE name = '0001_legacy_to_vfs'", ()).await;

    // 3. Run migration
    db.migrate_legacy_to_vfs().await.unwrap();

    // 4. Verify backup tables were created and hold the rows
    let mut comp_rows = db.get_turso().query("SELECT COUNT(*) FROM ts_companies_backup", ()).await.unwrap();
    let count: i64 = comp_rows.next().await.unwrap().unwrap().get(0).unwrap();
    assert!(count >= 1, "ts_companies_backup should contain backed up rows");

    // 5. Verify migration lock 0001_legacy_to_vfs was registered
    let mut mig_rows = db.get_turso().query("SELECT name FROM vfs_migrations WHERE name = '0001_legacy_to_vfs'", ()).await.unwrap();
    assert!(mig_rows.next().await.unwrap().is_some(), "vfs_migrations should record 0001_legacy_to_vfs");

    // 6. Test idempotency: running migration again succeeds with no error and changes nothing
    db.migrate_legacy_to_vfs().await.unwrap();
}

#[tokio::test]
async fn test_phase2_asset_save_read_delete() {
    let db = setup_phase2_test_db().await;

    let (_tok_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "Asset Corp", false, None).await.unwrap();

    let asset = WorkspaceAsset {
        id: "asset_sheet_1".to_string(),
        company_id: comp.id.clone(),
        team_id: None,
        asset_type: "spreadsheet".to_string(),
        name: "Budget 2026.sheet".to_string(),
        content: "[[Revenue, 1000000], [Expenses, 450000]]".to_string(),
        created_by: alice.username.clone(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    // Save asset
    let saved = db.save_asset(&comp.id, asset.clone()).await.unwrap();
    assert_eq!(saved.id, "asset_sheet_1");

    // Verify it was stored in vfs_inodes under sheets
    let mut rows = db.get_turso().query(
        "SELECT id, kind, meta_json FROM vfs_inodes WHERE company_id = ? AND id = 'ino_asset_sheet_1'",
        libsql::params![comp.id.clone()],
    ).await.unwrap();
    let row = rows.next().await.unwrap().expect("Inode must exist in vfs_inodes");
    let kind: String = row.get(1).unwrap();
    let enc_meta: String = row.get(2).unwrap();
    assert_eq!(kind, "sheet");
    assert_ne!(enc_meta, asset.content, "Data at rest must be encrypted");

    // Verify get_assets reads from VFS and decrypts properly
    let loaded_assets = db.get_assets(&comp.id).await;
    assert_eq!(loaded_assets.len(), 1);
    assert_eq!(loaded_assets[0].id, "asset_sheet_1");
    assert_eq!(loaded_assets[0].name, "Budget 2026.sheet");
    assert_eq!(loaded_assets[0].content, asset.content, "Decrypted content must match original");

    // Delete asset
    db.delete_asset(&comp.id, "asset_sheet_1").await.unwrap();
    let after_delete = db.get_assets(&comp.id).await;
    assert_eq!(after_delete.len(), 0, "Asset must be removed after deletion");
}

#[tokio::test]
async fn test_phase2_chat_message_vfs_persistence() {
    let db = setup_phase2_test_db().await;

    let (_tok_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "Chat Corp", false, None).await.unwrap();

    let msg = ChatMessage {
        id: "msg_test_1".to_string(),
        company_id: comp.id.clone(),
        team_id: None,
        user_id: alice.id.clone(),
        username: alice.username.clone(),
        message: "Hello VFS team!".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        file_attachment: None,
        reactions: None,
    };

    // Save chat message
    db.save_chat_message(&comp.id, msg.clone()).await.unwrap();

    // Verify stored in vfs_messages with encryption
    let mut rows = db.get_turso().query(
        "SELECT id, sender_uid, body_encrypted FROM vfs_messages WHERE company_id = ? AND id = 'msg_test_1'",
        libsql::params![comp.id.clone()],
    ).await.unwrap();
    let row = rows.next().await.unwrap().expect("Message must exist in vfs_messages");
    let enc_body: String = row.get(2).unwrap();
    assert_ne!(enc_body, msg.message, "Chat body must be encrypted at rest");

    // Verify get_channel_messages decrypts and returns the message
    let loaded_messages = db.get_channel_messages(&comp.id).await;
    assert_eq!(loaded_messages.len(), 1);
    assert_eq!(loaded_messages[0].id, "msg_test_1");
    assert_eq!(loaded_messages[0].message, "Hello VFS team!");

    // Verify reading through VFS read syscall renders plain text
    let cred_alice = db.get_user_vfs_cred(&comp.id, &alice.id).await.unwrap();
    let plain_bytes = db.vfs.read(&cred_alice, "/chats/public/general").await.unwrap();
    let plain_text = String::from_utf8(plain_bytes).unwrap();
    assert!(plain_text.contains("alice: Hello VFS team!"), "VFS read on chat node must render plain text: {}", plain_text);
}

#[tokio::test]
async fn test_phase2_team_and_member_role_sync() {
    let db = setup_phase2_test_db().await;

    let (_tok_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "Sync Corp", false, None).await.unwrap();

    let (_tok_bob, bob, _) = db.sign_in("bob", "password123").await.unwrap();
    db.join_company(&bob.id, &bob.username, &comp.join_code).await.unwrap();

    // 1. Create team
    let team = db.create_team(&comp.id, "backend", "Backend services").await.unwrap();

    // Verify vfs_groups has the team
    let mut grp_rows = db.get_turso().query(
        "SELECT gid, name FROM vfs_groups WHERE company_id = ? AND gid = ?",
        libsql::params![comp.id.clone(), team.id.clone()],
    ).await.unwrap();
    assert!(grp_rows.next().await.unwrap().is_some(), "vfs_groups must contain the created team");

    // Verify /projects/backend exists in vfs_inodes
    let cred_alice = db.get_user_vfs_cred(&comp.id, &alice.id).await.unwrap();
    let proj_node = db.vfs.stat(&cred_alice, "/projects/backend").await.unwrap();
    assert_eq!(proj_node.kind, InodeKind::Dir);

    // 2. Change Bob's role to Admin
    db.change_member_role(&alice.id, &comp.id, &bob.id, CompanyRole::Admin).await.unwrap();

    // Verify vfs_group_members has Bob in 'admin'
    let mut adm_rows = db.get_turso().query(
        "SELECT 1 FROM vfs_group_members WHERE company_id = ? AND gid = 'admin' AND uid = ?",
        libsql::params![comp.id.clone(), bob.id.clone()],
    ).await.unwrap();
    assert!(adm_rows.next().await.unwrap().is_some(), "Bob must be in admin vfs_group_members");

    // Verify Cred reflects is_admin
    let cred_bob_admin = db.get_user_vfs_cred(&comp.id, &bob.id).await.unwrap();
    assert!(cred_bob_admin.is_admin, "Bob cred must reflect admin status");

    // 3. Demote Bob back to Member
    db.change_member_role(&alice.id, &comp.id, &bob.id, CompanyRole::Member).await.unwrap();
    let cred_bob_member = db.get_user_vfs_cred(&comp.id, &bob.id).await.unwrap();
    assert!(!cred_bob_member.is_admin, "Bob cred must not be admin after demotion");

    // 4. Delete team
    db.delete_team(&comp.id, &team.id).await.unwrap();
    let mut grp_del = db.get_turso().query(
        "SELECT 1 FROM vfs_groups WHERE company_id = ? AND gid = ?",
        libsql::params![comp.id.clone(), team.id.clone()],
    ).await.unwrap();
    assert!(grp_del.next().await.unwrap().is_none(), "Team group must be deleted");
}

#[tokio::test]
async fn test_phase2_purge_company_data() {
    let db = setup_phase2_test_db().await;

    let (_tok_alice, alice, _) = db.sign_in("alice", "password123").await.unwrap();
    let comp = db.create_company(&alice.id, &alice.username, "Purge Corp", false, None).await.unwrap();

    // Add asset and chat message
    db.save_asset(&comp.id, WorkspaceAsset {
        id: "purge_asset_1".to_string(),
        company_id: comp.id.clone(),
        team_id: None,
        asset_type: "doc".to_string(),
        name: "Confidential.doc".to_string(),
        content: "Top secret content".to_string(),
        created_by: alice.username.clone(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }).await.unwrap();

    db.save_chat_message(&comp.id, ChatMessage {
        id: "purge_msg_1".to_string(),
        company_id: comp.id.clone(),
        team_id: None,
        user_id: alice.id.clone(),
        username: alice.username.clone(),
        message: "Purge me soon".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        file_attachment: None,
        reactions: None,
    }).await.unwrap();

    // Purge organization
    db.purge_company_data(&comp.id).await.unwrap();

    // Verify all VFS tables have 0 rows for this company
    for table in &["vfs_users", "vfs_groups", "vfs_group_members", "vfs_inodes", "vfs_acl", "vfs_messages", "vfs_audit"] {
        let sql = format!("SELECT COUNT(*) FROM {} WHERE company_id = ?", table);
        let mut rows = db.get_turso().query(&sql, libsql::params![comp.id.clone()]).await.unwrap();
        let count: i64 = rows.next().await.unwrap().unwrap().get(0).unwrap();
        assert_eq!(count, 0, "Table {} must have 0 rows for purged company", table);
    }
}
