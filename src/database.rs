use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use dashmap::DashMap;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use libsql::{Builder, Connection};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy};
use utoipa::ToSchema;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EnrolledPasskey {
    pub id: String,
    pub label: String,
    pub hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UserProfile {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    pub created_at: String,
    pub last_login: String,
    pub company_ids: Vec<String>,
    pub avatar_url: Option<String>,
    pub last_active_at: Option<String>,
    pub total_active_seconds: Option<u64>,
    pub daily_active_seconds: Option<std::collections::HashMap<String, u64>>,
    #[serde(default)]
    pub has_passkey: bool,
    #[serde(default)]
    pub enrolled_passkeys: Option<Vec<EnrolledPasskey>>,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub enum CompanyRole {
    Owner,
    Admin,
    Moderator,
    Member,
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CompanyMember {
    pub user_id: String,
    pub username: String,
    pub role: CompanyRole,
    pub joined_at: String,
    pub avatar_url: Option<String>,
    pub last_active_at: Option<String>,
    pub total_active_seconds: Option<u64>,
    pub daily_active_seconds: Option<std::collections::HashMap<String, u64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileAttachment {
    pub name: String,
    pub url: String,
    pub file_type: String,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MessageReaction {
    pub username: String,
    pub emoji: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChatMessage {
    pub id: String,
    pub company_id: String,
    pub team_id: Option<String>,
    pub user_id: String,
    pub username: String,
    pub message: String,
    pub timestamp: String,
    pub file_attachment: Option<FileAttachment>,
    pub reactions: Option<Vec<MessageReaction>>,
}


#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Company {
    pub id: String,
    pub name: String,
    pub join_code: String,
    pub owner_id: String,
    pub created_at: String,
    #[serde(default)]
    pub last_activity_at: Option<String>,
    pub member_ids: Vec<String>,
    pub members: Vec<CompanyMember>,
    pub is_public: bool,
    pub logo_url: Option<String>,
    pub public_headline: Option<String>,
    pub public_description: Option<String>,
    pub public_faqs: Option<String>,
    pub otp_passcode: Option<String>,
    pub otp_expires_at: Option<String>,
    #[serde(default)]
    pub kicked_users: Vec<(String, String)>, // (user_id, expires_at_rfc3339)
    #[serde(default)]
    pub banned_users: Vec<String>, // user_id
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ExportMetadata {
    pub exported_at: String,
    pub exported_by_user_id: String,
    pub exported_by_username: String,
    pub company_id: String,
    pub company_name: String,
    pub total_messages: usize,
    pub total_assets: usize,
    pub total_teams: usize,
    pub total_members: usize,
    pub checksum_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CompanyExportData {
    pub metadata: ExportMetadata,
    pub company: Company,
    pub teams: Vec<Team>,
    pub messages: Vec<ChatMessage>,
    pub assets: Vec<WorkspaceAsset>,
    pub invites: Vec<CompanyInvite>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CompanyInvite {
    pub code: String,
    pub company_id: String,
    pub creator_id: String,
    pub role: CompanyRole,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub expires_at: Option<String>,
    pub created_at: String,
}





#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Team {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
}


#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct WorkspaceAsset {
    pub id: String,
    pub company_id: String,
    pub team_id: Option<String>,
    pub asset_type: String, // "whiteboard", "spreadsheet", "doc", "pdf"
    pub name: String,
    pub content: String,
    pub created_by: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenClaims {
    pub user_id: String,
    pub username: String,
    pub exp: u64,
    pub iat: u64,
    #[serde(default)]
    pub purpose: Option<String>,
}


#[derive(Debug, Deserialize, Validate)]
pub struct SearchQueryReq {
    pub token: String,
    pub company_id: String,
    #[validate(length(min = 1))]
    pub query: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchResult {
    pub title: String,
    pub category: String,
    pub snippet: String,
}

pub struct Database {
    jwt_secret: String,
    // Turso (libSQL) remote database connection
    turso: Arc<Connection>,
    // Moka high-performance async caches with TTL
    pub user_cache: Cache<String, UserProfile>,
    pub company_cache: Cache<String, Company>,

    // Memory store maps (hot in-memory cache backed by Turso)
    pub users: Arc<DashMap<String, UserProfile>>,
    pub companies: Arc<DashMap<String, Company>>,
    pub teams: Arc<DashMap<String, Vec<Team>>>,
    pub assets: Arc<DashMap<String, Vec<WorkspaceAsset>>>,
    pub messages: Arc<DashMap<String, Vec<ChatMessage>>>,
    pub passkeys: Arc<DashMap<String, Vec<EnrolledPasskey>>>,
    pub invites: Arc<DashMap<String, CompanyInvite>>,

    // Tantivy full-text search engine
    pub search_index: Index,
    pub search_reader: IndexReader,
    schema_title: Field,
    schema_category: Field,
    schema_body: Field,

    // Virtual Filesystem Engine
    pub vfs: Arc<crate::vfs::VfsEngine>,
}

impl Database {
    pub async fn new() -> Result<Self> {
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "theysynced_enterprise_secret_jwt_key_2026".to_string());

        // ── Connect to Turso or Local SQLite database ─────────────────────────
        let turso_url_env = std::env::var("TURSO_DATABASE_URL").ok();
        let turso_token_env = std::env::var("TURSO_AUTH_TOKEN").unwrap_or_default();

        let db = match turso_url_env {
            Some(ref url) if url.starts_with("libsql://") || url.starts_with("https://") || url.starts_with("http://") => {
                tracing::info!("Connecting to remote Turso database: {}", url);
                Builder::new_remote(url.clone(), turso_token_env)
                    .build()
                    .await
                    .map_err(|e| anyhow!("Turso remote connection failed: {}", e))?
            }
            Some(ref path) if !path.is_empty() && path != "local" => {
                tracing::info!("Using local LibSQL database at: {}", path);
                Builder::new_local(path)
                    .build()
                    .await
                    .map_err(|e| anyhow!("Local LibSQL database failed at {}: {}", path, e))?
            }
            _ => {
                let default_path = "theysynced.db";
                tracing::info!("TURSO_DATABASE_URL not set; using persistent local SQLite database at: {}", default_path);
                Builder::new_local(default_path)
                    .build()
                    .await
                    .map_err(|e| anyhow!("Local LibSQL database failed at {}: {}", default_path, e))?
            }
        };

        let turso = Arc::new(
            db.connect().map_err(|e| anyhow!("Database connect() failed: {}", e))?
        );

        // ── Moka high-speed async caches with 1-hour TTL ──────────────────────
        let user_cache: Cache<String, UserProfile> = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(3600))
            .build();

        let company_cache: Cache<String, Company> = Cache::builder()
            .max_capacity(5_000)
            .time_to_live(Duration::from_secs(3600))
            .build();

        let users = Arc::new(DashMap::new());
        let companies = Arc::new(DashMap::new());
        let teams = Arc::new(DashMap::new());
        let assets = Arc::new(DashMap::new());
        let messages = Arc::new(DashMap::new());
        let passkeys = Arc::new(DashMap::new());
        let invites = Arc::new(DashMap::new());

        // ── Tantivy search engine ─────────────────────────────────────────────
        let mut schema_builder = Schema::builder();
        let schema_title = schema_builder.add_text_field("title", TEXT | STORED);
        let schema_category = schema_builder.add_text_field("category", TEXT | STORED);
        let schema_body = schema_builder.add_text_field("body", TEXT | STORED);
        let schema = schema_builder.build();

        let search_index = Index::create_in_ram(schema.clone());
        let search_reader = search_index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        let vfs = Arc::new(crate::vfs::VfsEngine::new(turso.clone()));

        let instance = Self {
            jwt_secret,
            turso,
            user_cache,
            company_cache,
            users,
            companies,
            teams,
            assets,
            messages,
            passkeys,
            invites,
            search_index,
            search_reader,
            schema_title,
            schema_category,
            schema_body,
            vfs,
        };

        instance.init_schema().await?;
        instance.load_from_turso().await?;
        instance.index_initial_search_data()?;

        Ok(instance)
    }

    // ── Turso Schema Initialization ───────────────────────────────────────────
    async fn init_schema(&self) -> Result<()> {
        let ddl = "
            CREATE TABLE IF NOT EXISTS ts_users     (key TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ts_companies (id  TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ts_teams     (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ts_assets    (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ts_messages  (key TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ts_passkeys  (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ts_invites   (code TEXT PRIMARY KEY, data TEXT NOT NULL);

            -- VFS Relational Schema
            CREATE TABLE IF NOT EXISTS vfs_users (
                company_id TEXT NOT NULL,
                uid TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'human',
                caps TEXT NOT NULL DEFAULT '[]',
                home_inode TEXT NOT NULL,
                PRIMARY KEY (company_id, uid)
            );
            CREATE TABLE IF NOT EXISTS vfs_groups (
                company_id TEXT NOT NULL,
                gid TEXT NOT NULL,
                name TEXT NOT NULL,
                PRIMARY KEY (company_id, gid)
            );
            CREATE TABLE IF NOT EXISTS vfs_group_members (
                company_id TEXT NOT NULL,
                gid TEXT NOT NULL,
                uid TEXT NOT NULL,
                PRIMARY KEY (company_id, gid, uid)
            );
            CREATE TABLE IF NOT EXISTS vfs_inodes (
                company_id TEXT NOT NULL,
                id TEXT NOT NULL,
                parent_id TEXT,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                owner TEXT NOT NULL,
                gid TEXT NOT NULL,
                mode INTEGER NOT NULL,
                sealed INTEGER NOT NULL DEFAULT 0,
                size INTEGER NOT NULL DEFAULT 0,
                mtime TEXT NOT NULL,
                ctime TEXT NOT NULL,
                blob_ref TEXT,
                meta_json TEXT,
                PRIMARY KEY (company_id, id),
                UNIQUE (company_id, parent_id, name)
            );
            CREATE TABLE IF NOT EXISTS vfs_acl (
                company_id TEXT NOT NULL,
                inode_id TEXT NOT NULL,
                uid TEXT NOT NULL,
                perms INTEGER NOT NULL,
                PRIMARY KEY (company_id, inode_id, uid)
            );
            CREATE TABLE IF NOT EXISTS vfs_messages (
                company_id TEXT NOT NULL,
                id TEXT NOT NULL,
                chat_inode_id TEXT NOT NULL,
                sender_uid TEXT NOT NULL,
                ts TEXT NOT NULL,
                body_encrypted TEXT NOT NULL,
                PRIMARY KEY (company_id, id)
            );
            CREATE TABLE IF NOT EXISTS vfs_audit (
                company_id TEXT NOT NULL,
                ts TEXT NOT NULL,
                uid TEXT NOT NULL,
                op TEXT NOT NULL,
                inode_id TEXT,
                allowed INTEGER NOT NULL,
                detail TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_vfs_inodes_parent ON vfs_inodes (company_id, parent_id);
            CREATE INDEX IF NOT EXISTS idx_vfs_messages_chat ON vfs_messages (company_id, chat_inode_id, ts);
            CREATE INDEX IF NOT EXISTS idx_vfs_audit_company ON vfs_audit (company_id, ts);
        ";
        self.turso.execute_batch(ddl).await
            .map(|_| ())
            .map_err(|e| anyhow!("Turso schema init failed: {}", e))
    }

    // ── Load all data from Turso into DashMaps on startup ─────────────────────
    async fn load_from_turso(&self) -> Result<()> {
        // users
        let mut rows = self.turso.query("SELECT key, data FROM ts_users", ()).await
            .map_err(|e| anyhow!("Turso load users failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(v) = serde_json::from_str::<UserProfile>(&data) {
                self.users.insert(key, v);
            }
        }

        // companies
        let mut rows = self.turso.query("SELECT id, data FROM ts_companies", ()).await
            .map_err(|e| anyhow!("Turso load companies failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(bytes) = crate::crypto::decrypt_payload(Some(&key), &data) {
                if let Ok(v) = serde_json::from_slice::<Company>(&bytes) {
                    self.companies.insert(key, v);
                }
            }
        }

        // teams
        let mut rows = self.turso.query("SELECT company_id, data FROM ts_teams", ()).await
            .map_err(|e| anyhow!("Turso load teams failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(bytes) = crate::crypto::decrypt_payload(Some(&key), &data) {
                if let Ok(v) = serde_json::from_slice::<Vec<Team>>(&bytes) {
                    self.teams.insert(key, v);
                }
            }
        }

        // assets
        let mut rows = self.turso.query("SELECT company_id, data FROM ts_assets", ()).await
            .map_err(|e| anyhow!("Turso load assets failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(bytes) = crate::crypto::decrypt_payload(Some(&key), &data) {
                if let Ok(v) = serde_json::from_slice::<Vec<WorkspaceAsset>>(&bytes) {
                    self.assets.insert(key, v);
                }
            }
        }

        // messages
        let mut rows = self.turso.query("SELECT key, data FROM ts_messages", ()).await
            .map_err(|e| anyhow!("Turso load messages failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(bytes) = crate::crypto::decrypt_payload(None, &data) {
                if let Ok(v) = serde_json::from_slice::<Vec<ChatMessage>>(&bytes) {
                    self.messages.insert(key, v);
                }
            }
        }

        // passkeys
        let mut rows = self.turso.query("SELECT user_id, data FROM ts_passkeys", ()).await
            .map_err(|e| anyhow!("Turso load passkeys failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(v) = serde_json::from_str::<Vec<EnrolledPasskey>>(&data) {
                self.passkeys.insert(key, v);
            }
        }

        // invites
        let mut rows = self.turso.query("SELECT code, data FROM ts_invites", ()).await
            .map_err(|e| anyhow!("Turso load invites failed: {}", e))?;
        while let Some(row) = rows.next().await.map_err(|e| anyhow!("{}", e))? {
            let key: String = row.get(0).map_err(|e| anyhow!("{}", e))?;
            let data: String = row.get(1).map_err(|e| anyhow!("{}", e))?;
            if let Ok(v) = serde_json::from_str::<CompanyInvite>(&data) {
                self.invites.insert(key, v);
            }
        }

        tracing::info!("✅ Turso: loaded all data into memory");
        Ok(())
    }

    // ── Fine-grained Turso upsert helpers ─────────────────────────────────────
    async fn upsert_user(&self, key: &str, user: &UserProfile) {
        if let Ok(data) = serde_json::to_string(user) {
            let _ = self.turso.execute(
                "INSERT OR REPLACE INTO ts_users (key, data) VALUES (?1, ?2)",
                libsql::params![key.to_string(), data],
            ).await;
        }
    }

    async fn upsert_all_users(&self) {
        for entry in self.users.iter() {
            self.upsert_user(entry.key(), entry.value()).await;
        }
    }

    async fn upsert_company(&self, id: &str, company: &Company) {
        if let Ok(json_bytes) = serde_json::to_vec(company) {
            let data = match crate::crypto::encrypt_for_org(id, &json_bytes) {
                Ok(enc) => enc,
                Err(e) => {
                    tracing::error!("Failed to encrypt company {}: {}", id, e);
                    return;
                }
            };
            let _ = self.turso.execute(
                "INSERT OR REPLACE INTO ts_companies (id, data) VALUES (?1, ?2)",
                libsql::params![id.to_string(), data],
            ).await;
        }
    }

    async fn delete_company_from_turso(&self, id: &str) {
        let _ = self.turso.execute(
            "DELETE FROM ts_companies WHERE id = ?1",
            libsql::params![id.to_string()],
        ).await;
    }

    async fn upsert_teams(&self, company_id: &str, teams: &[Team]) {
        if let Ok(json_bytes) = serde_json::to_vec(teams) {
            let data = match crate::crypto::encrypt_for_org(company_id, &json_bytes) {
                Ok(enc) => enc,
                Err(e) => {
                    tracing::error!("Failed to encrypt teams for company {}: {}", company_id, e);
                    return;
                }
            };
            let _ = self.turso.execute(
                "INSERT OR REPLACE INTO ts_teams (company_id, data) VALUES (?1, ?2)",
                libsql::params![company_id.to_string(), data],
            ).await;
        }
    }

    async fn delete_teams_from_turso(&self, company_id: &str) {
        let _ = self.turso.execute(
            "DELETE FROM ts_teams WHERE company_id = ?1",
            libsql::params![company_id.to_string()],
        ).await;
    }

    async fn upsert_assets(&self, company_id: &str, assets: &[WorkspaceAsset]) {
        if let Ok(json_bytes) = serde_json::to_vec(assets) {
            let data = match crate::crypto::encrypt_for_org(company_id, &json_bytes) {
                Ok(enc) => enc,
                Err(e) => {
                    tracing::error!("Failed to encrypt assets for company {}: {}", company_id, e);
                    return;
                }
            };
            let _ = self.turso.execute(
                "INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES (?1, ?2)",
                libsql::params![company_id.to_string(), data],
            ).await;
        }
    }

    async fn delete_assets_from_turso(&self, company_id: &str) {
        let _ = self.turso.execute(
            "DELETE FROM ts_assets WHERE company_id = ?1",
            libsql::params![company_id.to_string()],
        ).await;
    }

    async fn upsert_messages(&self, key: &str, messages: &[ChatMessage]) {
        if messages.is_empty() {
            return;
        }
        let company_id = messages.first().map(|m| m.company_id.as_str()).unwrap_or_else(|| {
            if key.starts_with("team_") && key.ends_with("_gen") {
                key.trim_start_matches("team_").trim_end_matches("_gen")
            } else {
                key
            }
        });

        match serde_json::to_vec(messages) {
            Ok(json_bytes) => {
                let data = match crate::crypto::encrypt_for_org(company_id, &json_bytes) {
                    Ok(enc) => enc,
                    Err(e) => {
                        tracing::error!("Failed to encrypt chat messages for key '{}': {}", key, e);
                        return;
                    }
                };
                if let Err(e) = self.turso.execute(
                    "INSERT OR REPLACE INTO ts_messages (key, data) VALUES (?1, ?2)",
                    libsql::params![key.to_string(), data],
                ).await {
                    tracing::error!("Failed to persist chat messages for key '{}': {}", key, e);
                } else {
                    tracing::debug!("Persisted {} encrypted messages for key '{}'", messages.len(), key);
                }
            }
            Err(e) => {
                tracing::error!("Failed to serialize chat messages for key '{}': {}", key, e);
            }
        }
    }

    /// Public alias for use in WebSocket handlers in main.rs
    pub async fn upsert_messages_pub(&self, key: &str, messages: &[ChatMessage]) {
        self.upsert_messages(key, messages).await;
    }

    async fn delete_messages_for_company_from_turso(&self, company_id: &str) {
        let team_prefix = format!("team_{}_%", company_id);
        let enc_prefix = format!("enc:v1:{}:%", company_id);
        let _ = self.turso.execute(
            "DELETE FROM ts_messages WHERE key = ?1 OR key LIKE ?2 OR data LIKE ?3",
            libsql::params![company_id.to_string(), team_prefix, enc_prefix],
        ).await;
    }

    async fn upsert_passkeys(&self, user_id: &str, passkeys: &[EnrolledPasskey]) {
        if let Ok(data) = serde_json::to_string(passkeys) {
            let _ = self.turso.execute(
                "INSERT OR REPLACE INTO ts_passkeys (user_id, data) VALUES (?1, ?2)",
                libsql::params![user_id.to_string(), data],
            ).await;
        } else {
            let _ = self.turso.execute(
                "DELETE FROM ts_passkeys WHERE user_id = ?1",
                libsql::params![user_id.to_string()],
            ).await;
        }
    }

    async fn upsert_invite(&self, code: &str, invite: &CompanyInvite) {
        if let Ok(data) = serde_json::to_string(invite) {
            let _ = self.turso.execute(
                "INSERT OR REPLACE INTO ts_invites (code, data) VALUES (?1, ?2)",
                libsql::params![code.to_string(), data],
            ).await;
        }
    }

    async fn delete_invite_from_turso(&self, code: &str) {
        let _ = self.turso.execute(
            "DELETE FROM ts_invites WHERE code = ?1",
            libsql::params![code.to_string()],
        ).await;
    }


    fn index_initial_search_data(&self) -> Result<()> {
        let mut index_writer: IndexWriter = self.search_index.writer(50_000_000)?;
        
        let mut doc1 = TantivyDocument::default();
        doc1.add_text(self.schema_title, "Excalidraw Whiteboard Architecture");
        doc1.add_text(self.schema_category, "Whiteboard");
        doc1.add_text(self.schema_body, "System vector whiteboards and microservice flowcharts");
        index_writer.add_document(doc1)?;

        let mut doc2 = TantivyDocument::default();
        doc2.add_text(self.schema_title, "Q3 Revenue Statistics");
        doc2.add_text(self.schema_category, "Spreadsheet");
        doc2.add_text(self.schema_body, "Excel financial grid with SUM formulas and charts");
        index_writer.add_document(doc2)?;

        index_writer.commit()?;
        Ok(())
    }

    pub fn search(&self, query_str: &str) -> Vec<SearchResult> {
        let searcher = self.search_reader.searcher();
        let query_parser = QueryParser::for_index(
            &self.search_index,
            vec![self.schema_title, self.schema_category, self.schema_body],
        );

        let query = match query_parser.parse_query(query_str) {
            Ok(q) => q,
            Err(_) => return Vec::new(),
        };

        let top_docs = match searcher.search(&query, &TopDocs::with_limit(10)) {
            Ok(docs) => docs,
            Err(_) => return Vec::new(),
        };

        let mut results = Vec::new();
        for (_score, doc_address) in top_docs {
            if let Ok(retrieved_doc) = searcher.doc::<TantivyDocument>(doc_address) {
                let title = retrieved_doc
                    .get_first(self.schema_title)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let category = retrieved_doc
                    .get_first(self.schema_category)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let snippet = retrieved_doc
                    .get_first(self.schema_body)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                results.push(SearchResult {
                    title,
                    category,
                    snippet,
                });
            }
        }

        results
    }

    #[allow(dead_code)]
    async fn seed_default_workspace(&self) {
        // No default company seeded — every user creates or joins their own company
    }


    // Enterprise Argon2id Password Hashing
    fn hash_password_argon2(&self, password: &str) -> Result<String> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| anyhow!("Argon2 hashing error: {}", e))?
            .to_string();
        Ok(password_hash)
    }

    fn verify_password_argon2(&self, password: &str, hash_str: &str) -> bool {
        let parsed_hash = match PasswordHash::new(hash_str) {
            Ok(h) => h,
            Err(_) => return false,
        };
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok()
    }

    pub async fn sign_up(&self, username: &str, password: &str) -> Result<(String, UserProfile)> {
        let username_clean = username.trim().to_lowercase();
        if username_clean.is_empty() || password.is_empty() {
            return Err(anyhow!("Username and password are required"));
        }
        if password.len() < 4 {
            return Err(anyhow!("Password must be at least 4 characters"));
        }
        if self.users.contains_key(&username_clean) {
            return Err(anyhow!("Username already taken"));
        }

        let user_id = format!("user_{}", uuid::Uuid::new_v4().to_string()[..8].to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let password_hash = self.hash_password_argon2(password)?;

        // New users start clean with 0 companies so they can create or join explicitly
        let mut daily_active = std::collections::HashMap::new();
        for day in &["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] {
            daily_active.insert(day.to_string(), 0);
        }

        let profile = UserProfile {
            id: user_id.clone(),
            username: username_clean.clone(),
            password_hash,
            created_at: now.clone(),
            last_login: now.clone(),
            company_ids: vec![],
            avatar_url: None,
            last_active_at: Some(now.clone()),
            total_active_seconds: Some(0),
            daily_active_seconds: Some(daily_active),
            has_passkey: false,
            enrolled_passkeys: None,
        };

        self.users.insert(username_clean.clone(), profile.clone());
        self.user_cache.insert(username_clean.clone(), profile.clone()).await;
        self.upsert_user(&username_clean, &profile).await;

        let token = self.generate_token(&profile.id, &profile.username)?;
        Ok((token, profile))
    }


    pub async fn update_user_profile(
        &self,
        user_id: &str,
        new_username: Option<String>,
        avatar_url: Option<String>,
    ) -> Result<UserProfile> {
        let mut target_key = None;
        let mut target_profile = None;

        for entry in self.users.iter() {
            if entry.value().id == user_id {
                target_key = Some(entry.key().clone());
                target_profile = Some(entry.value().clone());
                break;
            }
        }

        let key = target_key.ok_or_else(|| anyhow!("User not found"))?;
        let mut profile = target_profile.unwrap();

        if let Some(uname) = new_username {
            if !uname.trim().is_empty() {
                profile.username = uname.trim().to_string();
            }
        }
        if let Some(avatar) = avatar_url {
            profile.avatar_url = Some(avatar);
        }

        // Propagate changes to companies member list
        {
            for mut comp_entry in self.companies.iter_mut() {
                let comp = comp_entry.value_mut();
                if comp.member_ids.contains(&profile.id) {
                    for member in &mut comp.members {
                        if member.user_id == profile.id {
                            member.username = profile.username.clone();
                            member.avatar_url = profile.avatar_url.clone();
                        }
                    }
                }
            }
        }

        self.users.insert(key.clone(), profile.clone());
        self.user_cache.insert(key.clone(), profile.clone()).await;
        self.upsert_user(&key, &profile).await;
        // propagate company member changes
        for entry in self.companies.iter() {
            if entry.value().member_ids.contains(&profile.id) {
                self.upsert_company(entry.key(), entry.value()).await;
            }
        }
        Ok(profile)
    }

    /// Returns (token, profile, requires_passkey).
    /// If the account has a passkey enrolled, `token` is a short-lived *pending*
    /// token that only unlocks `/api/auth/login/passkey` — the real session
    /// token & full profile aren't issued until the passkey step succeeds.
    pub async fn sign_in(&self, username: &str, password: &str) -> Result<(String, UserProfile, bool)> {

        let username_clean = username.trim().to_lowercase();
        if username_clean.is_empty() || password.is_empty() {
            return Err(anyhow!("Username and password are required"));
        }

        if !self.users.contains_key(&username_clean) {
            let (token, profile) = self.sign_up(username, password).await?;
            return Ok((token, profile, false));
        }

        let profile_cached = self.user_cache.get(&username_clean).await;
        let mut profile = match profile_cached {
            Some(p) => p,
            None => self.users.get(&username_clean).unwrap().clone(),
        };

        if !self.verify_password_argon2(password, &profile.password_hash) {
            return Err(anyhow!("Invalid credentials"));
        }

        if profile.has_passkey && self.passkeys.contains_key(&profile.id) {
            // Credentials are correct, but don't finish the session yet —
            // the caller must complete the passkey challenge first.
            let pending_token = self.generate_pending_passkey_token(&profile.id, &profile.username)?;
            return Ok((pending_token, profile, true));
        }

        profile.last_login = chrono::Utc::now().to_rfc3339();
        self.users.insert(username_clean.clone(), profile.clone());
        self.user_cache.insert(username_clean.clone(), profile.clone()).await;

        let token = self.generate_token(&profile.id, &profile.username)?;
        Ok((token, profile, false))
    }

    /// Completes login after the password step when a passkey is enrolled.
    /// Verifies the pending token, then the passkey assertion, then issues
    /// the real session token.
    pub async fn complete_passkey_login(&self, pending_token: &str, passkey: &str) -> Result<(String, UserProfile)> {
        let claims = self.verify_pending_passkey_token(pending_token)?;

        let key = self
            .users
            .iter()
            .find(|e| e.value().id == claims.user_id)
            .map(|e| e.key().clone())
            .ok_or_else(|| anyhow!("User not found"))?;

        if !self.verify_user_passkey(&claims.user_id, passkey).await {
            return Err(anyhow!("Passkey verification failed"));
        }

        let mut profile = self.users.get(&key).unwrap().clone();
        profile.last_login = chrono::Utc::now().to_rfc3339();
        self.users.insert(key.clone(), profile.clone());
        self.user_cache.insert(key, profile.clone()).await;

        let token = self.generate_token(&profile.id, &profile.username)?;
        Ok((token, profile))
    }

    pub async fn verify_token(&self, token: &str) -> Result<TokenClaims> {
        let validation = Validation::new(Algorithm::HS256);
        let token_data = decode::<TokenClaims>(
            token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &validation,
        )?;

        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        if token_data.claims.exp < now {
            return Err(anyhow!("Token expired"));
        }
        if token_data.claims.purpose.is_some() {
            // Pending passkey tokens can't be used to access the app.
            return Err(anyhow!("Passkey verification required"));
        }

        Ok(token_data.claims)
    }

    pub fn generate_token(&self, user_id: &str, username: &str) -> Result<String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let claims = TokenClaims {
            user_id: user_id.to_string(),
            username: username.to_string(),
            iat: now,
            exp: now + (86400 * 30),
            purpose: None,
        };

        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )?;

        Ok(token)
    }

    pub fn generate_pending_passkey_token(&self, user_id: &str, username: &str) -> Result<String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let claims = TokenClaims {
            user_id: user_id.to_string(),
            username: username.to_string(),
            iat: now,
            exp: now + 300, // 5 minutes to complete the passkey challenge
            purpose: Some("pending_passkey".to_string()),
        };

        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )?;

        Ok(token)
    }

    pub fn verify_pending_passkey_token(&self, token: &str) -> Result<TokenClaims> {
        let validation = Validation::new(Algorithm::HS256);
        let token_data = decode::<TokenClaims>(
            token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &validation,
        )?;

        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        if token_data.claims.exp < now {
            return Err(anyhow!("Passkey challenge expired, please sign in again"));
        }
        if token_data.claims.purpose.as_deref() != Some("pending_passkey") {
            return Err(anyhow!("Invalid token for this step"));
        }

        Ok(token_data.claims)
    }

    pub async fn create_company(&self, owner_id: &str, owner_username: &str, name: &str, is_public: bool, logo_url: Option<String>) -> Result<Company> {
        let company_id = format!("comp_{}", uuid::Uuid::new_v4().to_string()[..8].to_string());
        let join_code = format!("TS-{}", uuid::Uuid::new_v4().to_string()[..6].to_uppercase());
        let now = chrono::Utc::now().to_rfc3339();

        let (owner_avatar, last_act, tot_sec, daily_act) = if let Some(u) = self.users.iter().find(|e| e.value().id == owner_id) {
            let val = u.value();
            (val.avatar_url.clone(), val.last_active_at.clone(), val.total_active_seconds, val.daily_active_seconds.clone())
        } else {
            (None, None, None, None)
        };
        let owner_member = CompanyMember {
            user_id: owner_id.to_string(),
            username: owner_username.to_string(),
            role: CompanyRole::Owner,
            joined_at: now.clone(),
            avatar_url: owner_avatar,
            last_active_at: last_act,
            total_active_seconds: tot_sec,
            daily_active_seconds: daily_act,
        };

        let company = Company {
            id: company_id.clone(),
            name: name.to_string(),
            join_code,
            owner_id: owner_id.to_string(),
            created_at: now.clone(),
            last_activity_at: Some(now.clone()),
            member_ids: vec![owner_id.to_string()],
            members: vec![owner_member],
            is_public,
            logo_url,
            public_headline: Some(format!("Welcome to {}", name)),
            public_description: Some(format!("{} is an innovative organization collaborating real-time on TheySynced Office.", name)),
            public_faqs: Some(serde_json::json!([
                {"q": format!("What does {} do?", name), "a": "We build cutting-edge solutions and collaborate seamlessly on TheySynced."},
                {"q": "How can I join?", "a": "Enter an admin OTP passcode or company join code."}
            ]).to_string()),
            otp_passcode: None,
            otp_expires_at: None,
            kicked_users: vec![],
            banned_users: vec![],
        };




        self.companies.insert(company_id.clone(), company.clone());
        self.company_cache.insert(company_id.clone(), company.clone()).await;

        let default_teams = vec![
            Team {
                id: format!("team_{}_gen", company_id),
                company_id: company_id.clone(),
                name: "General".to_string(),
                description: "Company wide chatter & updates".to_string(),
                created_at: now.clone(),
            },
            Team {
                id: format!("team_{}_proj", company_id),
                company_id: company_id.clone(),
                name: "Projects".to_string(),
                description: "Whiteboards, docs & statistics".to_string(),
                created_at: now.clone(),
            },
        ];
        self.teams.insert(company_id.clone(), default_teams);

        for mut user in self.users.iter_mut() {
            if user.value().id == owner_id {
                if !user.value().company_ids.contains(&company_id) {
                    user.company_ids.push(company_id.clone());
                }
                break;
            }
        }

        // Persist company, its default teams, and the owner's user profile
        self.upsert_company(&company_id, &company).await;
        if let Some(t) = self.teams.get(&company_id) {
            self.upsert_teams(&company_id, &t).await;
        }
        if let Some(entry) = self.users.iter().find(|e| e.value().id == owner_id) {
            self.upsert_user(entry.key(), entry.value()).await;
        }

        // Initialize per-company VFS standard layout (/etc, /home, /chats, /projects, /var/log/audit, /tmp, /proc)
        if let Err(e) = self.vfs.init_company_vfs(&company_id, owner_id, owner_username).await {
            tracing::error!("init_company_vfs failed: {:?}", e);
            eprintln!("init_company_vfs failed: {:?}", e);
            return Err(anyhow!("init_company_vfs failed: {:?}", e));
        }

        Ok(self.enrich_company(company))
    }


    pub async fn join_company(&self, user_id: &str, username: &str, code_or_otp: &str) -> Result<Company> {
        let code_clean = code_or_otp.trim().to_uppercase();
        let now_ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();

        let target_company = self
            .companies
            .iter()
            .find(|c| {
                let comp = c.value();
                if comp.join_code.to_uppercase() == code_clean {
                    return true;
                }
                if let (Some(otp), Some(exp_str)) = (&comp.otp_passcode, &comp.otp_expires_at) {
                    if otp.to_uppercase() == code_clean {
                        if let Ok(exp_date) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                            if exp_date.timestamp() as u64 > now_ts {
                                return true;
                            }
                        }
                    }
                }
                false
            })
            .map(|c| c.value().clone());

        if let Some(company) = target_company {
            let comp_id = company.id.clone();
            let now = chrono::Utc::now().to_rfc3339();

            let mut final_comp = None;
            if let Some(mut comp) = self.companies.get_mut(&comp_id) {
                // Check if banned
                if comp.banned_users.contains(&user_id.to_string()) {
                    return Err(anyhow!("You are permanently banned from this company workspace"));
                }

                // Check if kicked
                if let Some(kick_index) = comp.kicked_users.iter().position(|(id, _)| id == user_id) {
                    let (_, exp_str) = &comp.kicked_users[kick_index];
                    if let Ok(exp_date) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                        if exp_date.timestamp() > chrono::Utc::now().timestamp() {
                            let minutes_left = (exp_date.timestamp() - chrono::Utc::now().timestamp()) / 60;
                            return Err(anyhow!("You have been kicked. You can rejoin in {} minutes.", minutes_left + 1));
                        } else {
                            comp.kicked_users.remove(kick_index);
                        }
                    }
                }

                if !comp.member_ids.contains(&user_id.to_string()) {
                    let (avatar, last_act, tot_sec, daily_act) = if let Some(u) = self.users.iter().find(|e| e.value().id == user_id) {
                        let val = u.value();
                        (val.avatar_url.clone(), val.last_active_at.clone(), val.total_active_seconds, val.daily_active_seconds.clone())
                    } else {
                        (None, None, None, None)
                    };
                    comp.member_ids.push(user_id.to_string());
                    comp.members.push(CompanyMember {
                        user_id: user_id.to_string(),
                        username: username.to_string(),
                        role: CompanyRole::Member,
                        joined_at: now,
                        avatar_url: avatar,
                        last_active_at: last_act,
                        total_active_seconds: tot_sec,
                        daily_active_seconds: daily_act,
                    });
                }
                final_comp = Some(comp.clone());
            }

            for mut user in self.users.iter_mut() {
                if user.value().id == user_id {
                    if !user.value().company_ids.contains(&comp_id) {
                        user.company_ids.push(comp_id.clone());
                    }
                    break;
                }
            }

            let comp_to_return = final_comp.unwrap_or(company);
            self.upsert_company(&comp_id, &comp_to_return).await;

            // Register joining user in company VFS
            let user_home_ino = format!("home_{}", user_id);
            let _ = self.turso.execute(
                "INSERT OR IGNORE INTO vfs_users (company_id, uid, name, kind, caps, home_inode) VALUES (?, ?, ?, 'human', '[\"member\"]', ?)",
                libsql::params![comp_id.clone(), user_id, username, user_home_ino.clone()],
            ).await;
            let _ = self.turso.execute(
                "INSERT OR IGNORE INTO vfs_group_members (company_id, gid, uid) VALUES (?, 'everyone', ?)",
                libsql::params![comp_id.clone(), user_id],
            ).await;
            let now_utc = chrono::Utc::now().to_rfc3339();
            let _ = self.turso.execute(
                "INSERT OR IGNORE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
                 VALUES (?, ?, 'dir_home', ?, 'dir', ?, ?, ?, 0, 0, ?, ?, NULL, NULL)",
                libsql::params![comp_id.clone(), user_home_ino.clone(), user_id, user_id, user_id, 0o700 as i64, now_utc.clone(), now_utc.clone()],
            ).await;
            let user_dms_ino = format!("dir_dms_{}", user_id);
            let _ = self.turso.execute(
                "INSERT OR IGNORE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
                 VALUES (?, ?, ?, 'dms', 'dir', ?, ?, ?, 0, 0, ?, ?, NULL, NULL)",
                libsql::params![comp_id.clone(), user_dms_ino, user_home_ino, user_id, user_id, 0o700 as i64, now_utc.clone(), now_utc],
            ).await;

            Ok(self.enrich_company(comp_to_return))
        } else {
            Err(anyhow!("Invalid or expired company join code or OTP passcode"))
        }
    }

    pub fn is_company_member(&self, user_id: &str, company_id: &str) -> bool {
        if let Some(comp) = self.companies.get(company_id) {
            comp.owner_id == user_id || comp.member_ids.iter().any(|id| id == user_id) || comp.members.iter().any(|m| m.user_id == user_id)
        } else {
            false
        }
    }

    pub fn get_member_role(&self, user_id: &str, company_id: &str) -> Option<CompanyRole> {
        if let Some(comp) = self.companies.get(company_id) {
            if comp.owner_id == user_id {
                return Some(CompanyRole::Owner);
            }
            comp.members.iter().find(|m| m.user_id == user_id).map(|m| m.role.clone())
        } else {
            None
        }
    }

    pub fn is_company_admin_or_owner(&self, user_id: &str, company_id: &str) -> bool {
        if let Some(comp) = self.companies.get(company_id) {
            comp.owner_id == user_id || comp.members.iter().any(|m| m.user_id == user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin))
        } else {
            false
        }
    }

    pub async fn generate_company_otp(&self, user_id: &str, company_id: &str) -> Result<String> {
        if let Some(mut comp) = self.companies.get_mut(company_id) {
            let is_admin = comp.members.iter().any(|m| m.user_id == user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
            if !is_admin {
                return Err(anyhow!("Only Company Owners or Admins can generate access OTPs"));
            }

            let otp = format!("{:06}", rand::random::<u32>() % 1000000);
            let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(15)).to_rfc3339();

            comp.otp_passcode = Some(otp.clone());
            comp.otp_expires_at = Some(expires_at);

            self.company_cache.insert(company_id.to_string(), comp.clone()).await;
            Ok(otp)
        } else {
            Err(anyhow!("Company not found"))
        }
    }

    pub async fn update_company_public_site(
        &self,
        user_id: &str,
        company_id: &str,
        headline: Option<String>,
        description: Option<String>,
        faqs: Option<String>,
        is_public: Option<bool>,
    ) -> Result<Company> {
        let updated_comp = {
            if let Some(mut comp) = self.companies.get_mut(company_id) {
                let is_admin = comp.members.iter().any(|m| m.user_id == user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                if !is_admin {
                    return Err(anyhow!("Only Company Owners or Admins can update public site settings"));
                }

                if let Some(h) = headline { comp.public_headline = Some(h); }
                if let Some(d) = description { comp.public_description = Some(d); }
                if let Some(f) = faqs { comp.public_faqs = Some(f); }
                if let Some(p) = is_public { comp.is_public = p; }

                comp.clone()
            } else {
                return Err(anyhow!("Company not found"));
            }
        };

        self.company_cache.insert(company_id.to_string(), updated_comp.clone()).await;
        self.upsert_company(company_id, &updated_comp).await;
        Ok(self.enrich_company(updated_comp))
    }

    pub async fn kick_company_member(&self, admin_id: &str, company_id: &str, target_user_id: &str, duration_mins: u64) -> Result<Company> {
        let updated_comp = {
            if let Some(mut comp) = self.companies.get_mut(company_id) {
                let is_admin = comp.members.iter().any(|m| m.user_id == admin_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                if !is_admin {
                    return Err(anyhow!("Only Company Owners or Admins can kick members"));
                }

                // Remove from members list
                comp.member_ids.retain(|id| id != target_user_id);
                comp.members.retain(|m| m.user_id != target_user_id);

                // Add to kicked list
                let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(duration_mins as i64)).to_rfc3339();
                comp.kicked_users.push((target_user_id.to_string(), expires_at));

                comp.clone()
            } else {
                return Err(anyhow!("Company not found"));
            }
        };

        // Remove company from target user's profile
        {
            for mut user in self.users.iter_mut() {
                if user.value().id == target_user_id {
                    user.company_ids.retain(|id| id != company_id);
                    break;
                }
            }
        }

        self.company_cache.insert(company_id.to_string(), updated_comp.clone()).await;
        self.upsert_company(company_id, &updated_comp).await;
        // persist affected user
        if let Some(entry) = self.users.iter().find(|e| e.value().id == target_user_id) {
            self.upsert_user(entry.key(), entry.value()).await;
        }
        Ok(self.enrich_company(updated_comp))
    }

    pub async fn ban_company_member(&self, admin_id: &str, company_id: &str, target_user_id: &str) -> Result<Company> {
        let updated_comp = {
            if let Some(mut comp) = self.companies.get_mut(company_id) {
                let is_admin = comp.members.iter().any(|m| m.user_id == admin_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                if !is_admin {
                    return Err(anyhow!("Only Company Owners or Admins can ban members"));
                }

                // Remove from members list
                comp.member_ids.retain(|id| id != target_user_id);
                comp.members.retain(|m| m.user_id != target_user_id);

                // Add to banned list
                comp.banned_users.push(target_user_id.to_string());

                comp.clone()
            } else {
                return Err(anyhow!("Company not found"));
            }
        };

        // Remove company from target user's profile
        {
            for mut user in self.users.iter_mut() {
                if user.value().id == target_user_id {
                    user.company_ids.retain(|id| id != company_id);
                    break;
                }
            }
        }

        self.company_cache.insert(company_id.to_string(), updated_comp.clone()).await;
        self.upsert_company(company_id, &updated_comp).await;
        if let Some(entry) = self.users.iter().find(|e| e.value().id == target_user_id) {
            self.upsert_user(entry.key(), entry.value()).await;
        }
        Ok(self.enrich_company(updated_comp))
    }

    pub async fn change_member_role(&self, actor_id: &str, company_id: &str, target_user_id: &str, new_role: CompanyRole) -> Result<Company> {
        let updated_comp = {
            if let Some(mut comp) = self.companies.get_mut(company_id) {
                let is_actor_admin = comp.members.iter().any(|m| m.user_id == actor_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                let is_actor_mod = comp.members.iter().any(|m| m.user_id == actor_id && m.role == CompanyRole::Moderator);
                let is_target_admin_or_owner = comp.members.iter().any(|m| m.user_id == target_user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                let is_target_mod = comp.members.iter().any(|m| m.user_id == target_user_id && m.role == CompanyRole::Moderator);

                if !is_actor_admin && !is_actor_mod {
                    return Err(anyhow!("Only Admins or Moderators can change roles"));
                }

                if is_actor_mod && !is_actor_admin {
                    if is_target_admin_or_owner || is_target_mod {
                        return Err(anyhow!("Moderators cannot change roles of Admins or other Moderators"));
                    }
                    if new_role == CompanyRole::Admin || new_role == CompanyRole::Owner || new_role == CompanyRole::Moderator {
                        return Err(anyhow!("Moderators can only assign Member or Guest roles"));
                    }
                }

                if is_target_admin_or_owner && !is_actor_admin {
                    // Just a safety check, already covered above but good to be explicit
                    return Err(anyhow!("Cannot change role of Admin/Owner"));
                }

                let mut role_changed = false;
                for m in comp.members.iter_mut() {
                    if m.user_id == target_user_id {
                        m.role = new_role.clone();
                        role_changed = true;
                        break;
                    }
                }

                if !role_changed {
                    return Err(anyhow!("Target member not found in company"));
                }

                comp.clone()
            } else {
                return Err(anyhow!("Company not found"));
            }
        };

        self.company_cache.insert(company_id.to_string(), updated_comp.clone()).await;
        self.upsert_company(company_id, &updated_comp).await;
        Ok(self.enrich_company(updated_comp))
    }





    pub async fn rename_company(&self, user_id: &str, company_id: &str, new_name: &str) -> Result<Company> {
        let updated_comp = {
            if let Some(mut comp) = self.companies.get_mut(company_id) {
                let is_admin = comp.members.iter().any(|m| m.user_id == user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                if !is_admin {
                    return Err(anyhow!("Only Company Owners or Admins can rename the company"));
                }

                comp.name = new_name.to_string();
                comp.clone()
            } else {
                return Err(anyhow!("Company not found"));
            }
        };

        self.company_cache.insert(company_id.to_string(), updated_comp.clone()).await;
        self.upsert_company(company_id, &updated_comp).await;
        Ok(self.enrich_company(updated_comp))
    }

    pub async fn update_company_logo(&self, user_id: &str, company_id: &str, logo_url: &str) -> Result<Company> {
        let updated_comp = {
            if let Some(mut comp) = self.companies.get_mut(company_id) {
                let is_admin = comp.members.iter().any(|m| m.user_id == user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin));
                if !is_admin {
                    return Err(anyhow!("Only Company Owners or Admins can update logo"));
                }

                comp.logo_url = Some(logo_url.to_string());
                comp.clone()
            } else {
                return Err(anyhow!("Company not found"));
            }
        };

        self.company_cache.insert(company_id.to_string(), updated_comp.clone()).await;
        self.upsert_company(company_id, &updated_comp).await;
        Ok(self.enrich_company(updated_comp))
    }



    pub async fn touch_company_activity(&self, company_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(mut comp) = self.companies.get_mut(company_id) {
            comp.last_activity_at = Some(now.clone());
            let updated = comp.clone();
            drop(comp);
            self.company_cache.insert(company_id.to_string(), updated.clone()).await;
            self.upsert_company(company_id, &updated).await;
        }
    }

    pub async fn purge_company_data(&self, company_id: &str) -> Result<()> {
        // 1. Remove company & invalidate cache
        self.companies.remove(company_id);
        self.company_cache.invalidate(company_id).await;
        // 1. Remove all teams and assets for this company
        let team_ids: std::collections::HashSet<String> = self.teams.get(company_id)
            .map(|teams| teams.iter().map(|t| t.id.clone()).collect())
            .unwrap_or_default();
        self.teams.remove(company_id);
        self.assets.remove(company_id);

        // 2. Remove all in-memory chat messages for company and its teams
        self.messages.retain(|k, v| {
            if k == company_id || team_ids.contains(k) {
                return false;
            }
            !v.iter().any(|m| m.company_id == company_id)
        });

        // 3. Remove all company invites from memory and disk
        let invite_codes: Vec<String> = self.invites
            .iter()
            .filter(|entry| entry.value().company_id == company_id)
            .map(|entry| entry.key().clone())
            .collect();
        for code in &invite_codes {
            self.invites.remove(code);
            self.delete_invite_from_turso(code).await;
        }

        // 4. Remove company ID from all users and persist
        {
            for mut user in self.users.iter_mut() {
                user.company_ids.retain(|id| id != company_id);
            }
        }
        self.upsert_all_users().await;

        // 5. Delete company, teams, assets, and messages from Turso/SQLite
        self.delete_company_from_turso(company_id).await;
        self.delete_teams_from_turso(company_id).await;
        self.delete_assets_from_turso(company_id).await;
        self.delete_messages_for_company_from_turso(company_id).await;

        tracing::info!("Irreversibly purged all data for organization {}", company_id);
        Ok(())
    }

    pub async fn delete_company(&self, user_id: &str, company_id: &str) -> Result<()> {
        let is_owner = self.companies.get(company_id).map(|c| c.owner_id == user_id).unwrap_or(false);
        if !is_owner {
            return Err(anyhow!("Only the Company Owner can delete the company"));
        }
        self.purge_company_data(company_id).await
    }

    pub async fn purge_inactive_company(&self, company_id: &str) -> Result<()> {
        self.purge_company_data(company_id).await
    }

    pub async fn export_company_data(&self, user_id: &str, company_id: &str) -> Result<CompanyExportData> {
        let company = self.companies.get(company_id)
            .map(|c| self.enrich_company(c.value().clone()))
            .ok_or_else(|| anyhow!("Company not found"))?;

        // Authorization check: User must be Owner or Admin
        let is_admin_or_owner = company.members.iter().any(|m| {
            m.user_id == user_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin)
        });
        if !is_admin_or_owner {
            return Err(anyhow!("Forbidden: Only workspace Owner or Admin can export organization data"));
        }

        let user_name = company.members.iter()
            .find(|m| m.user_id == user_id)
            .map(|m| m.username.clone())
            .unwrap_or_else(|| "admin".to_string());

        let teams = self.get_teams(company_id).await;
        let assets = self.get_assets(company_id).await;

        let invites: Vec<CompanyInvite> = self.invites
            .iter()
            .filter(|inv| inv.value().company_id == company_id)
            .map(|inv| inv.value().clone())
            .collect();

        // Collect all messages belonging to this company across general and all teams
        let mut all_messages = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        for entry in self.messages.iter() {
            for msg in entry.value().iter() {
                if msg.company_id == company_id && seen_ids.insert(msg.id.clone()) {
                    all_messages.push(msg.clone());
                }
            }
        }
        all_messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        let now = chrono::Utc::now().to_rfc3339();

        // Compute SHA-256 integrity hash
        let digest_input = serde_json::to_vec(&( &company.id, &company.name, teams.len(), assets.len(), all_messages.len() ))
            .unwrap_or_default();
        let sha = ring::digest::digest(&ring::digest::SHA256, &digest_input);
        let checksum = sha.as_ref().iter().map(|b| format!("{:02x}", b)).collect::<String>();

        let metadata = ExportMetadata {
            exported_at: now,
            exported_by_user_id: user_id.to_string(),
            exported_by_username: user_name,
            company_id: company.id.clone(),
            company_name: company.name.clone(),
            total_messages: all_messages.len(),
            total_assets: assets.len(),
            total_teams: teams.len(),
            total_members: company.members.len(),
            checksum_sha256: checksum,
        };

        Ok(CompanyExportData {
            metadata,
            company,
            teams,
            messages: all_messages,
            assets,
            invites,
        })
    }

    pub async fn leave_company(&self, user_id: &str, company_id: &str) -> Result<()> {
        if let Some(mut comp) = self.companies.get_mut(company_id) {
            comp.member_ids.retain(|id| id != user_id);
        }
        for mut user in self.users.iter_mut() {
            if user.value().id == user_id {
                user.company_ids.retain(|id| id != company_id);
                break;
            }
        }
        Ok(())
    }

    pub fn enrich_company(&self, mut company: Company) -> Company {
        if company.last_activity_at.is_none() {
            company.last_activity_at = Some(company.created_at.clone());
        }
        for member in &mut company.members {
            if let Some(user_profile) = self.users.iter().find(|e| e.value().id == member.user_id) {
                member.username = user_profile.value().username.clone();
                member.avatar_url = user_profile.value().avatar_url.clone();
                member.last_active_at = user_profile.value().last_active_at.clone();
                member.total_active_seconds = user_profile.value().total_active_seconds;
                member.daily_active_seconds = user_profile.value().daily_active_seconds.clone();
            }
        }
        company
    }

    pub async fn get_user_companies(&self, user_id: &str) -> Vec<Company> {
        let mut list = Vec::new();
        for entry in self.companies.iter() {
            if entry.value().id != "comp_theysynced" && entry.value().member_ids.contains(&user_id.to_string()) {
                list.push(self.enrich_company(entry.value().clone()));
            }
        }
        list
    }


    pub async fn create_team(&self, company_id: &str, name: &str, description: &str) -> Result<Team> {
        let team_id = format!("team_{}", uuid::Uuid::new_v4().to_string()[..8].to_string());
        let team = Team {
            id: team_id,
            company_id: company_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        if let Some(mut list) = self.teams.get_mut(company_id) {
            list.push(team.clone());
        } else {
            self.teams.insert(company_id.to_string(), vec![team.clone()]);
        }

        if let Some(t) = self.teams.get(company_id) {
            self.upsert_teams(company_id, &t).await;
        }
        Ok(team)
    }

    pub async fn get_teams(&self, company_id: &str) -> Vec<Team> {
        self.teams.get(company_id).map(|t| t.value().clone()).unwrap_or_default()
    }

    pub async fn delete_team(&self, company_id: &str, team_id: &str) -> Result<()> {
        if let Some(mut list) = self.teams.get_mut(company_id) {
            list.retain(|t| t.id != team_id);
        }
        if let Some(t) = self.teams.get(company_id) {
            self.upsert_teams(company_id, &t).await;
        }
        Ok(())
    }



    pub async fn create_invite(
        &self,
        admin_id: &str,
        company_id: &str,
        role: CompanyRole,
        duration_mins: Option<u64>,
        max_uses: Option<u32>,
    ) -> Result<CompanyInvite> {
        let is_admin = if let Some(comp) = self.companies.get(company_id) {
            comp.owner_id == admin_id || comp.members.iter().any(|m| m.user_id == admin_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin))
        } else {
            return Err(anyhow!("Company not found"));
        };

        if !is_admin {
            return Err(anyhow!("Only admins/owners can create invite links"));
        }

        let code = format!("invite_{}", uuid::Uuid::new_v4().to_string()[..8].to_string());
        let now = chrono::Utc::now();
        let expires_at = duration_mins.map(|mins| (now + chrono::Duration::minutes(mins as i64)).to_rfc3339());
        
        let invite = CompanyInvite {
            code: code.clone(),
            company_id: company_id.to_string(),
            creator_id: admin_id.to_string(),
            role,
            max_uses,
            uses: 0,
            expires_at,
            created_at: now.to_rfc3339(),
        };

        self.invites.insert(code.clone(), invite.clone());
        self.upsert_invite(&code, &invite).await;
        Ok(invite)
    }

    pub async fn get_company_invites(&self, company_id: &str) -> Vec<CompanyInvite> {
        self.invites
            .iter()
            .filter(|e| e.value().company_id == company_id)
            .map(|e| e.value().clone())
            .collect()
    }

    pub async fn revoke_invite(&self, admin_id: &str, company_id: &str, code: &str) -> Result<()> {
        let is_admin = if let Some(comp) = self.companies.get(company_id) {
            comp.owner_id == admin_id || comp.members.iter().any(|m| m.user_id == admin_id && (m.role == CompanyRole::Owner || m.role == CompanyRole::Admin))
        } else {
            return Err(anyhow!("Company not found"));
        };

        if !is_admin {
            return Err(anyhow!("Only admins/owners can revoke invite links"));
        }

        self.invites.remove(code);
        self.delete_invite_from_turso(code).await;
        Ok(())
    }

    pub async fn join_by_invite(&self, user_id: &str, username: &str, code: &str) -> Result<Company> {
        let invite = match self.invites.get_mut(code) {
            Some(mut inv) => {
                if let Some(exp_str) = &inv.expires_at {
                    if let Ok(exp_date) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                        if exp_date.timestamp() < chrono::Utc::now().timestamp() {
                            return Err(anyhow!("This invite link has expired"));
                        }
                    }
                }
                
                if let Some(max) = inv.max_uses {
                    if inv.uses >= max {
                        return Err(anyhow!("This invite link has reached its maximum usage limit"));
                    }
                }

                inv.uses += 1;
                inv.clone()
            }
            None => return Err(anyhow!("Invalid or expired invite link")),
        };

        let company_id = invite.company_id.clone();
        
        if let Some(mut comp) = self.companies.get_mut(&company_id) {
            if comp.banned_users.contains(&user_id.to_string()) {
                return Err(anyhow!("You are permanently banned from this company workspace"));
            }

            if let Some(kick_index) = comp.kicked_users.iter().position(|(id, _)| id == user_id) {
                let (_, exp_str) = &comp.kicked_users[kick_index];
                if let Ok(exp_date) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                    if exp_date.timestamp() > chrono::Utc::now().timestamp() {
                        let minutes_left = (exp_date.timestamp() - chrono::Utc::now().timestamp()) / 60;
                        return Err(anyhow!("You have been kicked. You can rejoin in {} minutes.", minutes_left + 1));
                    } else {
                        comp.kicked_users.remove(kick_index);
                    }
                }
            }

            if !comp.member_ids.contains(&user_id.to_string()) {
                let (avatar, last_act, tot_sec, daily_act) = if let Some(u) = self.users.iter().find(|e| e.value().id == user_id) {
                    let val = u.value();
                    (val.avatar_url.clone(), val.last_active_at.clone(), val.total_active_seconds, val.daily_active_seconds.clone())
                } else {
                    (None, None, None, None)
                };
                comp.member_ids.push(user_id.to_string());
                comp.members.push(CompanyMember {
                    user_id: user_id.to_string(),
                    username: username.to_string(),
                    role: invite.role,
                    joined_at: chrono::Utc::now().to_rfc3339(),
                    avatar_url: avatar,
                    last_active_at: last_act,
                    total_active_seconds: tot_sec,
                    daily_active_seconds: daily_act,
                });
            }
        }

        for mut u in self.users.iter_mut() {
            if u.value().id == user_id {
                if !u.value().company_ids.contains(&company_id) {
                    u.company_ids.push(company_id.clone());
                }
                break;
            }
        }

        // Persist company + updated user
        if let Some(comp) = self.companies.get(&company_id) {
            self.upsert_company(&company_id, &comp).await;
        }
        if let Some(inv) = self.invites.get(code) {
            self.upsert_invite(code, &inv).await;
        }
        if let Some(entry) = self.users.iter().find(|e| e.value().id == user_id) {
            self.upsert_user(entry.key(), entry.value()).await;
        }
        if let Some(comp) = self.companies.get(&company_id) {
            Ok(self.enrich_company(comp.clone()))
        } else {
            Err(anyhow!("Company not found after joining"))
        }
    }


    pub async fn save_asset(&self, company_id: &str, asset: WorkspaceAsset) -> Result<WorkspaceAsset> {

        let comp_id = company_id.to_string();
        if let Some(mut list) = self.assets.get_mut(&comp_id) {
            if let Some(idx) = list.iter().position(|a| a.id == asset.id) {
                list[idx] = asset.clone();
            } else {
                list.push(asset.clone());
            }
        } else {
            self.assets.insert(comp_id, vec![asset.clone()]);
        }

        // Index in Tantivy search engine
        if let Ok(mut writer) = self.search_index.writer(10_000_000) {
            let mut doc = TantivyDocument::default();
            doc.add_text(self.schema_title, &asset.name);
            doc.add_text(self.schema_category, &asset.asset_type);
            doc.add_text(self.schema_body, &asset.content);
            let _ = writer.add_document(doc);
            let _ = writer.commit();
        }

        if let Some(a) = self.assets.get(company_id) {
            self.upsert_assets(company_id, &a).await;
        }
        self.touch_company_activity(company_id).await;
        Ok(asset)
    }

    pub async fn save_chat_message(&self, channel_or_company_id: &str, msg: ChatMessage) -> Result<ChatMessage> {
        let key = channel_or_company_id.to_string();
        let current_list = {
            let mut list = self.messages.entry(key.clone()).or_insert_with(Vec::new);
            if !list.iter().any(|m| m.id == msg.id) {
                list.push(msg.clone());
            }
            list.clone()
        };

        // Index chat message in Tantivy search
        if let Ok(mut writer) = self.search_index.writer(10_000_000) {
            let mut doc = TantivyDocument::default();
            doc.add_text(self.schema_title, &format!("Chat from @{}", msg.username));
            doc.add_text(self.schema_category, "chat");
            doc.add_text(self.schema_body, &msg.message);
            let _ = writer.add_document(doc);
            let _ = writer.commit();
        }

        self.upsert_messages(&key, &current_list).await;
        self.touch_company_activity(&msg.company_id).await;
        Ok(msg)
    }

    pub async fn get_channel_messages(&self, channel_or_company_id: &str) -> Vec<ChatMessage> {
        let mut results = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        // 1. Check in-memory DashMap for primary key
        if let Some(m) = self.messages.get(channel_or_company_id) {
            for item in m.value().iter() {
                if seen_ids.insert(item.id.clone()) {
                    results.push(item.clone());
                }
            }
        }

        // 2. Check aliased keys for General channel (e.g. "team_<id>_gen" vs "<id>")
        let mut alias_keys = Vec::new();
        if channel_or_company_id.starts_with("team_") && channel_or_company_id.ends_with("_gen") {
            let comp_id = channel_or_company_id
                .trim_start_matches("team_")
                .trim_end_matches("_gen");
            alias_keys.push(comp_id.to_string());
        } else {
            alias_keys.push(format!("team_{}_gen", channel_or_company_id));
        }

        for alias in &alias_keys {
            if let Some(m) = self.messages.get(alias) {
                for item in m.value().iter() {
                    if seen_ids.insert(item.id.clone()) {
                        results.push(item.clone());
                    }
                }
            }
        }

        // 3. Fallback: Query database directly from ts_messages if empty
        if results.is_empty() {
            let mut keys_to_query = vec![channel_or_company_id.to_string()];
            keys_to_query.extend(alias_keys.clone());

            for qk in keys_to_query {
                if let Ok(mut rows) = self.turso.query(
                    "SELECT data FROM ts_messages WHERE key = ?1",
                    libsql::params![qk.clone()],
                ).await {
                    if let Ok(Some(row)) = rows.next().await {
                        if let Ok(data_str) = row.get::<String>(0) {
                            if let Ok(bytes) = crate::crypto::decrypt_payload(None, &data_str) {
                                if let Ok(loaded) = serde_json::from_slice::<Vec<ChatMessage>>(&bytes) {
                                    self.messages.insert(qk, loaded.clone());
                                    for item in loaded {
                                        if seen_ids.insert(item.id.clone()) {
                                            results.push(item);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        results.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        results
    }

    pub async fn set_user_passkey(&self, user_id: &str, pin_or_passkey: &str) -> Result<()> {
        let hashed = self.hash_password_argon2(pin_or_passkey)?;
        
        let label = if pin_or_passkey.starts_with("WEBAUTHN_") {
            "Biometric Touch ID / Passkey".to_string()
        } else {
            "Custom Secret Passkey".to_string()
        };

        let new_key = EnrolledPasskey {
            id: uuid::Uuid::new_v4().to_string(),
            label,
            hash: hashed,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        {
            let mut entry = self.passkeys.entry(user_id.to_string()).or_insert_with(Vec::new);
            entry.push(new_key);
        }

        let key_opt = self.users.iter().find(|e| e.value().id == user_id).map(|e| e.key().clone());
        if let Some(key) = key_opt {
            if let Some(mut entry) = self.users.get_mut(&key) {
                entry.has_passkey = true;
            }
            if let Some(updated) = self.users.get(&key).map(|e| e.value().clone()) {
                self.user_cache.insert(key, updated).await;
            }
        }

        if let Some(list) = self.passkeys.get(user_id) {
            self.upsert_passkeys(user_id, &list).await;
        }
        // also persist user (has_passkey flag updated)
        if let Some(entry) = self.users.iter().find(|e| e.value().id == user_id) {
            self.upsert_user(entry.key(), entry.value()).await;
        }
        Ok(())
    }

    pub async fn verify_user_passkey(&self, user_id: &str, pin_or_passkey: &str) -> bool {
        if let Some(list) = self.passkeys.get(user_id) {
            for key in list.value() {
                if let Ok(parsed) = PasswordHash::new(&key.hash) {
                    if Argon2::default().verify_password(pin_or_passkey.as_bytes(), &parsed).is_ok() {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub async fn delete_user_passkey(&self, user_id: &str, passkey_id: &str) -> Result<()> {
        let mut list_empty = false;
        if let Some(mut list) = self.passkeys.get_mut(user_id) {
            list.value_mut().retain(|key| key.id != passkey_id);
            if list.value().is_empty() {
                list_empty = true;
            }
        }
        
        if list_empty {
            self.passkeys.remove(user_id);
            let key_opt = self.users.iter().find(|e| e.value().id == user_id).map(|e| e.key().clone());
            if let Some(key) = key_opt {
                if let Some(mut entry) = self.users.get_mut(&key) {
                    entry.has_passkey = false;
                }
                if let Some(updated) = self.users.get(&key).map(|e| e.value().clone()) {
                    self.user_cache.insert(key, updated).await;
                }
            }
        }
        
        // Persist passkeys (or delete row if empty)
        let passkey_list = self.passkeys.get(user_id).map(|p| p.value().clone()).unwrap_or_default();
        self.upsert_passkeys(user_id, &passkey_list).await;
        if let Some(entry) = self.users.iter().find(|e| e.value().id == user_id) {
            self.upsert_user(entry.key(), entry.value()).await;
        }
        Ok(())
    }

    pub fn populate_profile_passkeys(&self, mut profile: UserProfile) -> UserProfile {
        if let Some(list) = self.passkeys.get(&profile.id) {
            profile.enrolled_passkeys = Some(list.value().clone());
        } else {
            profile.enrolled_passkeys = Some(vec![]);
        }
        profile
    }

    pub async fn get_assets(&self, company_id: &str) -> Vec<WorkspaceAsset> {
        self.assets.get(company_id).map(|a| a.value().clone()).unwrap_or_default()
    }

    pub async fn update_user_active_seconds(&self, user_id: &str, total_seconds: u64) -> Result<UserProfile> {
        let mut target_key = None;
        let mut target_profile = None;

        for entry in self.users.iter() {
            if entry.value().id == user_id {
                target_key = Some(entry.key().clone());
                target_profile = Some(entry.value().clone());
                break;
            }
        }

        let key = target_key.ok_or_else(|| anyhow!("User not found"))?;
        let mut profile = target_profile.unwrap();

        let prev_total = profile.total_active_seconds.unwrap_or(0);
        let increment = total_seconds.saturating_sub(prev_total);

        profile.last_active_at = Some(chrono::Utc::now().to_rfc3339());
        profile.total_active_seconds = Some(total_seconds);

        // Update daily active seconds
        let current_day = chrono::Utc::now().format("%a").to_string(); // e.g. "Mon", "Tue"
        let mut daily = profile.daily_active_seconds.unwrap_or_else(|| {
            let mut h = std::collections::HashMap::new();
            for d in &["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] {
                h.insert(d.to_string(), 0);
            }
            h
        });
        let day_val = daily.entry(current_day).or_insert(0);
        *day_val = day_val.saturating_add(increment);
        profile.daily_active_seconds = Some(daily);

        // Propagate changes to companies member list
        {
            for mut comp_entry in self.companies.iter_mut() {
                let comp = comp_entry.value_mut();
                if comp.member_ids.contains(&profile.id) {
                    for member in &mut comp.members {
                        if member.user_id == profile.id {
                            member.last_active_at = profile.last_active_at.clone();
                            member.total_active_seconds = profile.total_active_seconds;
                        }
                    }
                }
            }
        }

        self.users.insert(key.clone(), profile.clone());
        self.user_cache.insert(key.clone(), profile.clone()).await;
        self.upsert_user(&key, &profile).await;
        // propagate activity to company member entries
        for entry in self.companies.iter() {
            if entry.value().member_ids.contains(&profile.id) {
                self.upsert_company(entry.key(), entry.value()).await;
            }
        }
        Ok(profile)
    }

    pub async fn get_user_vfs_cred(&self, company_id: &str, user_id: &str) -> Option<crate::vfs::Cred> {
        if !self.is_company_member(user_id, company_id) {
            return None;
        }
        let is_admin = self.is_company_admin_or_owner(user_id, company_id);
        let mut gids = vec!["everyone".to_string()];
        if is_admin {
            gids.push("admin".to_string());
        }
        if let Ok(mut rows) = self.turso.query(
            "SELECT gid FROM vfs_group_members WHERE company_id = ? AND uid = ?",
            libsql::params![company_id, user_id],
        ).await {
            while let Ok(Some(row)) = rows.next().await {
                if let Ok(gid) = row.get::<String>(0) {
                    if !gids.contains(&gid) {
                        gids.push(gid);
                    }
                }
            }
        }
        Some(crate::vfs::Cred::new(company_id, user_id, gids, is_admin))
    }

    pub fn get_user_by_id(&self, user_id: &str) -> Option<UserProfile> {
        self.users.iter().find(|e| e.value().id == user_id).map(|e| e.value().clone())
    }
}


