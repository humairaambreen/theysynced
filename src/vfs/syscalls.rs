use std::sync::Arc;
use anyhow::Result;
use libsql::Connection;
use chrono::Utc;

use crate::crypto;
use super::perms::{can_exec, can_read, can_write};
use super::path::{normalize_path, split_parent_child, split_path};
use super::schema::{Cred, InodeKind, VfsAcl, VfsInode, VfsMessage, VfsError};

#[derive(Clone)]
pub struct VfsEngine {
    turso: Arc<Connection>,
}

impl VfsEngine {
    pub fn new(turso: Arc<Connection>) -> Self {
        Self { turso }
    }

    // ── Audit Logging Helper ──────────────────────────────────────────────────
    pub async fn write_audit(
        &self,
        company_id: &str,
        uid: &str,
        op: &str,
        inode_id: Option<&str>,
        allowed: bool,
        detail: Option<&str>,
    ) {
        let ts = Utc::now().to_rfc3339();
        let allowed_int = if allowed { 1 } else { 0 };
        let _ = self.turso.execute(
            "INSERT INTO vfs_audit (company_id, ts, uid, op, inode_id, allowed, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
            libsql::params![
                company_id,
                ts,
                uid,
                op,
                inode_id.unwrap_or(""),
                allowed_int,
                detail.unwrap_or("")
            ],
        ).await;
    }

    // ── Inode Query Helpers ───────────────────────────────────────────────────
    async fn get_root_inode(&self, company_id: &str) -> Result<VfsInode, VfsError> {
        let mut rows = self.turso.query(
            "SELECT company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json
             FROM vfs_inodes WHERE company_id = ? AND parent_id IS NULL",
            libsql::params![company_id],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        if let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            Self::row_to_inode(&row)
        } else {
            Err(VfsError::ENOENT)
        }
    }

    pub async fn get_inode_by_id(&self, company_id: &str, id: &str) -> Result<VfsInode, VfsError> {
        let mut rows = self.turso.query(
            "SELECT company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json
             FROM vfs_inodes WHERE company_id = ? AND id = ?",
            libsql::params![company_id, id],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        if let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            Self::row_to_inode(&row)
        } else {
            Err(VfsError::ENOENT)
        }
    }

    pub async fn unlink_by_id(&self, cred: &Cred, inode_id: &str) -> Result<(), VfsError> {
        let target = self.get_inode_by_id(&cred.company_id, inode_id).await?;
        if target.kind == InodeKind::Dir {
            return Err(VfsError::EISDIR);
        }

        if let Some(ref pid) = target.parent_id {
            let parent = self.get_inode_by_id(&cred.company_id, pid).await?;
            let acl = self.get_acl(&cred.company_id, &parent.id, &cred.uid).await?;
            if !can_write(cred, &parent, acl.as_ref()) {
                self.write_audit(&cred.company_id, &cred.uid, "unlink", Some(&target.id), false, Some(inode_id)).await;
                return Err(VfsError::EACCES);
            }
        }

        if let Some(ref blob_key) = target.blob_ref {
            let file_path = format!("public/uploads/{}", blob_key);
            let _ = tokio::fs::remove_file(file_path).await;
        }

        self.turso.execute(
            "DELETE FROM vfs_inodes WHERE company_id = ? AND id = ?",
            libsql::params![cred.company_id.clone(), target.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let _ = self.turso.execute(
            "DELETE FROM vfs_acl WHERE company_id = ? AND inode_id = ?",
            libsql::params![cred.company_id.clone(), target.id.clone()],
        ).await;

        self.write_audit(&cred.company_id, &cred.uid, "unlink", Some(&target.id), true, Some(inode_id)).await;
        Ok(())
    }

    async fn get_child_inode(&self, company_id: &str, parent_id: &str, name: &str) -> Result<Option<VfsInode>, VfsError> {
        let mut rows = self.turso.query(
            "SELECT company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json
             FROM vfs_inodes WHERE company_id = ? AND parent_id = ? AND name = ?",
            libsql::params![company_id, parent_id, name],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        if let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            Ok(Some(Self::row_to_inode(&row)?))
        } else {
            Ok(None)
        }
    }

    pub async fn get_acl(&self, company_id: &str, inode_id: &str, uid: &str) -> Result<Option<VfsAcl>, VfsError> {
        let mut rows = self.turso.query(
            "SELECT company_id, inode_id, uid, perms FROM vfs_acl WHERE company_id = ? AND inode_id = ? AND uid = ?",
            libsql::params![company_id, inode_id, uid],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        if let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            let cid: String = row.get(0).map_err(|e| VfsError::EIO(e.to_string()))?;
            let iid: String = row.get(1).map_err(|e| VfsError::EIO(e.to_string()))?;
            let u: String = row.get(2).map_err(|e| VfsError::EIO(e.to_string()))?;
            let perms: i64 = row.get(3).map_err(|e| VfsError::EIO(e.to_string()))?;
            Ok(Some(VfsAcl { company_id: cid, inode_id: iid, uid: u, perms: perms as u32 }))
        } else {
            Ok(None)
        }
    }

    fn row_to_inode(row: &libsql::Row) -> Result<VfsInode, VfsError> {
        let company_id: String = row.get(0).map_err(|e| VfsError::EIO(e.to_string()))?;
        let id: String = row.get(1).map_err(|e| VfsError::EIO(e.to_string()))?;
        let parent_id: Option<String> = row.get(2).unwrap_or(None);
        let name: String = row.get(3).map_err(|e| VfsError::EIO(e.to_string()))?;
        let kind_str: String = row.get(4).map_err(|e| VfsError::EIO(e.to_string()))?;
        let owner: String = row.get(5).map_err(|e| VfsError::EIO(e.to_string()))?;
        let gid: String = row.get(6).map_err(|e| VfsError::EIO(e.to_string()))?;
        let mode: i64 = row.get(7).map_err(|e| VfsError::EIO(e.to_string()))?;
        let sealed: i64 = row.get(8).unwrap_or(0);
        let size: i64 = row.get(9).unwrap_or(0);
        let mtime: String = row.get(10).map_err(|e| VfsError::EIO(e.to_string()))?;
        let ctime: String = row.get(11).map_err(|e| VfsError::EIO(e.to_string()))?;
        let blob_ref: Option<String> = row.get(12).unwrap_or(None);
        let meta_json: Option<String> = row.get(13).unwrap_or(None);

        let kind = InodeKind::from_str_name(&kind_str).unwrap_or(InodeKind::File);

        Ok(VfsInode {
            company_id,
            id,
            parent_id,
            name,
            kind,
            owner,
            gid,
            mode: mode as u32,
            sealed: sealed != 0,
            size: size as u64,
            mtime,
            ctime,
            blob_ref,
            meta_json,
        })
    }

    pub async fn is_valid_user(&self, company_id: &str, uid: &str) -> bool {
        let mut rows = match self.turso.query(
            "SELECT 1 FROM vfs_users WHERE company_id = ? AND uid = ?",
            libsql::params![company_id, uid],
        ).await {
            Ok(r) => r,
            Err(_) => return false,
        };
        matches!(rows.next().await, Ok(Some(_)))
    }

    pub async fn get_user_name(&self, company_id: &str, uid: &str) -> Option<String> {
        let mut rows = match self.turso.query(
            "SELECT name FROM vfs_users WHERE company_id = ? AND uid = ?",
            libsql::params![company_id, uid],
        ).await {
            Ok(r) => r,
            Err(_) => return None,
        };
        if let Ok(Some(row)) = rows.next().await {
            row.get::<String>(0).ok()
        } else {
            None
        }
    }

    // ── Path Resolution with Ancestor Traversal Checks ────────────────────────
    /// Resolves a path to an inode within the caller's company.
    /// Traversal requires execute (`MAY_EXEC`) permission on every ancestor directory.
    pub async fn resolve_path(&self, cred: &Cred, path: &str, follow_trailing_symlink: bool) -> Result<VfsInode, VfsError> {
        if !self.is_valid_user(&cred.company_id, &cred.uid).await {
            return Err(VfsError::EACCES);
        }

        let norm = normalize_path(path);
        let mut curr = self.get_root_inode(&cred.company_id).await?;

        if norm == "/" {
            return Ok(curr);
        }

        let segments = split_path(&norm);
        let num_segments = segments.len();

        for (idx, seg) in segments.into_iter().enumerate() {
            let is_last = idx == num_segments - 1;

            if curr.kind != InodeKind::Dir {
                return Err(VfsError::ENOTDIR);
            }

            // Every ancestor directory requires execute (search) permission
            let acl = self.get_acl(&cred.company_id, &curr.id, &cred.uid).await?;
            if !can_exec(cred, &curr, acl.as_ref()) {
                return Err(VfsError::EACCES);
            }

            let child = match self.get_child_inode(&cred.company_id, &curr.id, &seg).await? {
                Some(c) => c,
                None => return Err(VfsError::ENOENT),
            };

            // If symlink, resolve target
            if child.kind == InodeKind::Symlink && (!is_last || follow_trailing_symlink) {
                if let Some(ref meta) = child.meta_json {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(meta) {
                        if let Some(target) = val.get("target").and_then(|t| t.as_str()) {
                            curr = Box::pin(self.resolve_path(cred, target, true)).await?;
                            continue;
                        }
                    }
                }
            }

            curr = child;
        }

        Ok(curr)
    }

    // ── Standard Company VFS Initialization ───────────────────────────────────
    /// Creates the standard per-company filesystem hierarchy upon company creation.
    pub async fn init_company_vfs(&self, company_id: &str, owner_uid: &str, owner_name: &str) -> Result<(), VfsError> {
        // Check if root already initialized
        if self.get_root_inode(company_id).await.is_ok() {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();

        // 1. Root inode '/'
        let root_id = "root";
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, ?, NULL, '', 'dir', ?, 'admin', ?, 0, 0, ?, ?, NULL, NULL)",
            libsql::params![company_id, root_id, owner_uid, 0o755 as i64, now.clone(), now.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        // 2. Default Groups: admin, everyone
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_groups (company_id, gid, name) VALUES (?, 'admin', 'Administrators')",
            libsql::params![company_id],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_groups (company_id, gid, name) VALUES (?, 'everyone', 'Everyone')",
            libsql::params![company_id],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        // 3. Register user and group membership
        let owner_home_ino = format!("home_{}", owner_uid);
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_users (company_id, uid, name, kind, caps, home_inode) VALUES (?, ?, ?, 'human', '[\"admin\"]', ?)",
            libsql::params![company_id, owner_uid, owner_name, owner_home_ino.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_group_members (company_id, gid, uid) VALUES (?, 'admin', ?)",
            libsql::params![company_id, owner_uid],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_group_members (company_id, gid, uid) VALUES (?, 'everyone', ?)",
            libsql::params![company_id, owner_uid],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        // Helper closure to create directories
        let create_dir = |id: &str, parent_id: &str, name: &str, gid: &str, mode: u32| {
            let cid = company_id.to_string();
            let i = id.to_string();
            let p = parent_id.to_string();
            let n = name.to_string();
            let g = gid.to_string();
            let o = owner_uid.to_string();
            let t = now.clone();
            async move {
                self.turso.execute(
                    "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
                     VALUES (?, ?, ?, ?, 'dir', ?, ?, ?, 0, 0, ?, ?, NULL, NULL)",
                    libsql::params![cid, i, p, n, o, g, mode as i64, t.clone(), t],
                ).await.map_err(|e| VfsError::EIO(e.to_string()))
            }
        };

        // Standard directories:
        create_dir("dir_etc", root_id, "etc", "admin", 0o755).await?;
        create_dir("dir_home", root_id, "home", "admin", 0o755).await?;
        create_dir(&owner_home_ino, "dir_home", owner_uid, owner_uid, 0o700).await?;
        create_dir(&format!("dir_dms_{}", owner_uid), &owner_home_ino, "dms", owner_uid, 0o700).await?;

        create_dir("dir_chats", root_id, "chats", "everyone", 0o755).await?;
        create_dir("dir_chats_public", "dir_chats", "public", "everyone", 0o755).await?;
        create_dir("dir_chats_private", "dir_chats", "private", "admin", 0o750).await?;
        create_dir("dir_chats_dm", "dir_chats", "dm", "everyone", 0o711).await?;

        // Public General chat channel (0664, group everyone)
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, 'chat_public_general', 'dir_chats_public', 'general', 'chat', ?, 'everyone', ?, 0, 0, ?, ?, NULL, NULL)",
            libsql::params![company_id, owner_uid, 0o664 as i64, now.clone(), now.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        // Projects structure
        create_dir("dir_projects", root_id, "projects", "everyone", 0o755).await?;
        create_dir("dir_projects_general", "dir_projects", "general", "everyone", 0o775).await?;
        create_dir("dir_proj_gen_docs", "dir_projects_general", "docs", "everyone", 0o775).await?;
        create_dir("dir_proj_gen_sheets", "dir_projects_general", "sheets", "everyone", 0o775).await?;
        create_dir("dir_proj_gen_boards", "dir_projects_general", "boards", "everyone", 0o775).await?;
        create_dir("dir_proj_gen_tasks", "dir_projects_general", "tasks", "everyone", 0o775).await?;

        create_dir("dir_shared", root_id, "shared", "everyone", 0o777).await?;
        create_dir("dir_var", root_id, "var", "admin", 0o755).await?;
        create_dir("dir_var_log", "dir_var", "log", "admin", 0o750).await?;

        // /var/log/audit: admin read-only (0640)
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, 'file_audit_log', 'dir_var_log', 'audit', 'file', ?, 'admin', ?, 0, 0, ?, ?, NULL, NULL)",
            libsql::params![company_id, owner_uid, 0o640 as i64, now.clone(), now.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        create_dir("dir_tmp", root_id, "tmp", "everyone", 0o777).await?;
        create_dir("dir_proc", root_id, "proc", "admin", 0o555).await?;

        // Read-only generated views in /etc
        let etc_passwd_content = format!("{}:x:1000:1000:{}:/home/{}:/bin/sh\n", owner_name, owner_name, owner_uid);
        let enc_passwd = crypto::encrypt_for_org(company_id, etc_passwd_content.as_bytes())
            .map_err(|e| VfsError::EIO(e.to_string()))?;
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, 'file_etc_passwd', 'dir_etc', 'passwd', 'file', ?, 'admin', ?, 0, ?, ?, ?, NULL, ?)",
            libsql::params![company_id, owner_uid, 0o644 as i64, etc_passwd_content.len() as i64, now.clone(), now.clone(), enc_passwd],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let etc_group_content = "admin:x:1000:\neveryone:x:1001:\n".to_string();
        let enc_group = crypto::encrypt_for_org(company_id, etc_group_content.as_bytes())
            .map_err(|e| VfsError::EIO(e.to_string()))?;
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, 'file_etc_group', 'dir_etc', 'group', 'file', ?, 'admin', ?, 0, ?, ?, ?, NULL, ?)",
            libsql::params![company_id, owner_uid, 0o644 as i64, etc_group_content.len() as i64, now.clone(), now.clone(), enc_group],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let org_conf_content = format!("company_id={}\ncreated_at={}\n", company_id, now);
        let enc_org_conf = crypto::encrypt_for_org(company_id, org_conf_content.as_bytes())
            .map_err(|e| VfsError::EIO(e.to_string()))?;
        self.turso.execute(
            "INSERT OR REPLACE INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, 'file_etc_org_conf', 'dir_etc', 'org.conf', 'file', ?, 'admin', ?, 0, ?, ?, ?, NULL, ?)",
            libsql::params![company_id, owner_uid, 0o644 as i64, org_conf_content.len() as i64, now.clone(), now.clone(), enc_org_conf],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.write_audit(company_id, owner_uid, "init_company_vfs", Some(root_id), true, Some("Standard VFS initialized")).await;
        Ok(())
    }

    // ── Deterministic DM Helper ───────────────────────────────────────────────
    /// Opens or creates a deterministic sealed DM between two users.
    /// Inode path: `/chats/dm/<uidLow>_<uidHigh>`, mode `0660`, group = the two participants, sealed = true.
    /// Symlinks created at `/home/<user>/dms/<peer_name>`.
    pub async fn open_or_create_dm(&self, cred: &Cred, target_uid: &str, target_name: &str, caller_name: &str) -> Result<VfsInode, VfsError> {
        let (uid_low, uid_high) = if cred.uid.as_str() < target_uid {
            (cred.uid.clone(), target_uid.to_string())
        } else {
            (target_uid.to_string(), cred.uid.clone())
        };

        let dm_name = format!("{}_{}", uid_low, uid_high);
        let dm_path = format!("/chats/dm/{}", dm_name);

        // Check if DM node already exists
        if let Ok(existing) = self.resolve_path(cred, &dm_path, false).await {
            return Ok(existing);
        }

        let dm_gid = format!("dm_{}", dm_name);
        let now = Utc::now().to_rfc3339();

        // 1. Create DM group and add both members
        let _ = self.turso.execute(
            "INSERT OR IGNORE INTO vfs_groups (company_id, gid, name) VALUES (?, ?, ?)",
            libsql::params![cred.company_id.clone(), dm_gid.clone(), format!("DM: {}", dm_name)],
        ).await;

        let _ = self.turso.execute(
            "INSERT OR IGNORE INTO vfs_group_members (company_id, gid, uid) VALUES (?, ?, ?)",
            libsql::params![cred.company_id.clone(), dm_gid.clone(), uid_low.clone()],
        ).await;

        let _ = self.turso.execute(
            "INSERT OR IGNORE INTO vfs_group_members (company_id, gid, uid) VALUES (?, ?, ?)",
            libsql::params![cred.company_id.clone(), dm_gid.clone(), uid_high.clone()],
        ).await;

        // 2. Resolve parent `/chats/dm`
        let dm_dir = self.resolve_path(cred, "/chats/dm", false).await?;

        // 3. Create sealed chat inode with mode 0660
        let dm_inode_id = format!("chat_dm_{}", dm_name);
        self.turso.execute(
            "INSERT INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, ?, ?, ?, 'chat', ?, ?, ?, 1, 0, ?, ?, NULL, NULL)",
            libsql::params![
                cred.company_id.clone(),
                dm_inode_id.clone(),
                dm_dir.id,
                dm_name,
                uid_low,
                dm_gid.clone(),
                0o660 as i64,
                now.clone(),
                now.clone()
            ],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        // 4. Create symlinks in both users' /home/<uid>/dms/
        let _ = self.symlink(cred, &dm_path, &format!("/home/{}/dms/{}", cred.uid, target_name)).await;
        let peer_cred = Cred::new(&cred.company_id, target_uid, vec![dm_gid.clone()], false);
        let _ = self.symlink(&peer_cred, &dm_path, &format!("/home/{}/dms/{}", target_uid, caller_name)).await;

        let created_inode = self.get_inode_by_id(&cred.company_id, &dm_inode_id).await?;
        self.write_audit(&cred.company_id, &cred.uid, "open_or_create_dm", Some(&dm_inode_id), true, Some(&dm_path)).await;

        Ok(created_inode)
    }

    // ── SYSCALL: stat ─────────────────────────────────────────────────────────
    pub async fn stat(&self, cred: &Cred, path: &str) -> Result<VfsInode, VfsError> {
        let inode = match self.resolve_path(cred, path, false).await {
            Ok(i) => i,
            Err(e) => {
                self.write_audit(&cred.company_id, &cred.uid, "stat", None, false, Some(path)).await;
                return Err(e);
            }
        };

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_read(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "stat", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        self.write_audit(&cred.company_id, &cred.uid, "stat", Some(&inode.id), true, Some(path)).await;
        Ok(inode)
    }

    // ── SYSCALL: readdir ──────────────────────────────────────────────────────
    pub async fn readdir(&self, cred: &Cred, path: &str) -> Result<Vec<VfsInode>, VfsError> {
        let dir_inode = match self.resolve_path(cred, path, true).await {
            Ok(i) => i,
            Err(e) => {
                self.write_audit(&cred.company_id, &cred.uid, "readdir", None, false, Some(path)).await;
                return Err(e);
            }
        };

        if dir_inode.kind != InodeKind::Dir {
            self.write_audit(&cred.company_id, &cred.uid, "readdir", Some(&dir_inode.id), false, Some("Not a directory")).await;
            return Err(VfsError::ENOTDIR);
        }

        let acl = self.get_acl(&cred.company_id, &dir_inode.id, &cred.uid).await?;
        if !can_read(cred, &dir_inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "readdir", Some(&dir_inode.id), false, Some("Read permission denied")).await;
            return Err(VfsError::EACCES);
        }

        let mut rows = self.turso.query(
            "SELECT company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json
             FROM vfs_inodes WHERE company_id = ? AND parent_id = ? ORDER BY name ASC",
            libsql::params![cred.company_id.clone(), dir_inode.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let mut results = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            let child = Self::row_to_inode(&row)?;
            // Filter children: omit nodes the user has no permissions to view if sealed
            let child_acl = self.get_acl(&cred.company_id, &child.id, &cred.uid).await?;
            if can_read(cred, &child, child_acl.as_ref()) || can_exec(cred, &child, child_acl.as_ref()) {
                results.push(child);
            }
        }

        self.write_audit(&cred.company_id, &cred.uid, "readdir", Some(&dir_inode.id), true, Some(path)).await;
        Ok(results)
    }

    // ── SYSCALL: read ─────────────────────────────────────────────────────────
    /// Reads file content.
    /// For chat inodes: formats decrypted messages as plain text lines (`[ts] user: message\n`), so cat/grep work.
    pub async fn read(&self, cred: &Cred, path: &str) -> Result<Vec<u8>, VfsError> {
        let inode = match self.resolve_path(cred, path, true).await {
            Ok(i) => i,
            Err(e) => {
                self.write_audit(&cred.company_id, &cred.uid, "read", None, false, Some(path)).await;
                return Err(e);
            }
        };

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_read(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "read", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if inode.kind == InodeKind::Dir {
            return Err(VfsError::EISDIR);
        }

        // Chat node reading renders plain text lines for cat/grep
        if inode.kind == InodeKind::Chat {
            let msgs = self.read_messages(cred, path, 1000, None).await?;
            let mut formatted = String::new();
            for m in msgs {
                let sender_display = self.get_user_name(&cred.company_id, &m.sender_uid).await
                    .unwrap_or_else(|| m.sender_uid.clone());
                let text = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&m.body_encrypted) {
                    parsed.get("message").and_then(|v| v.as_str()).map(|s| s.to_string())
                        .unwrap_or_else(|| m.body_encrypted.clone())
                } else {
                    m.body_encrypted.clone()
                };
                formatted.push_str(&format!("[{}] {}: {}\n", m.ts, sender_display, text));
            }
            self.write_audit(&cred.company_id, &cred.uid, "read", Some(&inode.id), true, Some("chat plain-text render")).await;
            return Ok(formatted.into_bytes());
        }

        // Regular file / doc / sheet / board / task
        if let Some(ref blob_key) = inode.blob_ref {
            let file_path = format!("public/uploads/{}", blob_key);
            match tokio::fs::read(&file_path).await {
                Ok(enc_bytes) => {
                    let enc_str = String::from_utf8_lossy(&enc_bytes);
                    let decrypted_bytes = match crypto::decrypt_for_org(Some(&cred.company_id), &enc_str) {
                        Ok((_, bytes)) => bytes,
                        Err(e) => return Err(VfsError::EIO(format!("Decryption failed: {}", e))),
                    };
                    self.write_audit(&cred.company_id, &cred.uid, "read", Some(&inode.id), true, Some(path)).await;
                    return Ok(decrypted_bytes);
                }
                Err(e) => return Err(VfsError::EIO(format!("Failed to read blob storage: {}", e))),
            }
        }

        if let Some(ref meta) = inode.meta_json {
            let decrypted_bytes = match crypto::decrypt_for_org(Some(&cred.company_id), meta) {
                Ok((_, bytes)) => bytes,
                Err(_) => meta.as_bytes().to_vec(),
            };
            self.write_audit(&cred.company_id, &cred.uid, "read", Some(&inode.id), true, Some(path)).await;
            return Ok(decrypted_bytes);
        }

        self.write_audit(&cred.company_id, &cred.uid, "read", Some(&inode.id), true, Some(path)).await;
        Ok(Vec::new())
    }

    // ── SYSCALL: write ────────────────────────────────────────────────────────
    /// Writes or updates content of a file node.
    /// Encrypts data at rest using AES-256-GCM (crypto.rs).
    pub async fn write(&self, cred: &Cred, path: &str, data: &[u8]) -> Result<(), VfsError> {
        let inode = match self.resolve_path(cred, path, true).await {
            Ok(i) => i,
            Err(e) => {
                self.write_audit(&cred.company_id, &cred.uid, "write", None, false, Some(path)).await;
                return Err(e);
            }
        };

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_write(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "write", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if inode.kind == InodeKind::Dir {
            return Err(VfsError::EISDIR);
        }

        if inode.kind == InodeKind::Chat {
            return Err(VfsError::EINVAL("Cannot raw-write chat inode; use append_message".to_string()));
        }

        let now = Utc::now().to_rfc3339();
        let enc_str = crypto::encrypt_for_org(&cred.company_id, data)
            .map_err(|e| VfsError::EIO(format!("Encryption failed: {}", e)))?;

        // Small files (<= 64KB) stored inline in meta_json; larger files chunked into storage
        if enc_str.len() <= 65536 {
            self.turso.execute(
                "UPDATE vfs_inodes SET size = ?, mtime = ?, meta_json = ?, blob_ref = NULL WHERE company_id = ? AND id = ?",
                libsql::params![data.len() as i64, now, enc_str, cred.company_id.clone(), inode.id.clone()],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?;
        } else {
            let blob_key = format!("vfs_{}_{}", cred.company_id, inode.id);
            let file_path = format!("public/uploads/{}", blob_key);
            tokio::fs::write(&file_path, enc_str.as_bytes()).await
                .map_err(|e| VfsError::EIO(format!("Failed to write blob: {}", e)))?;

            self.turso.execute(
                "UPDATE vfs_inodes SET size = ?, mtime = ?, blob_ref = ?, meta_json = NULL WHERE company_id = ? AND id = ?",
                libsql::params![data.len() as i64, now, blob_key, cred.company_id.clone(), inode.id.clone()],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?;
        }

        self.write_audit(&cred.company_id, &cred.uid, "write", Some(&inode.id), true, Some(path)).await;
        Ok(())
    }

    // ── SYSCALL: create ───────────────────────────────────────────────────────
    pub async fn create(&self, cred: &Cred, path: &str, kind: InodeKind, mode: u32) -> Result<VfsInode, VfsError> {
        let (parent_path, child_name) = split_parent_child(path)?;
        let parent = match self.resolve_path(cred, &parent_path, true).await {
            Ok(p) => p,
            Err(e) => {
                self.write_audit(&cred.company_id, &cred.uid, "create", None, false, Some(path)).await;
                return Err(e);
            }
        };

        if parent.kind != InodeKind::Dir {
            return Err(VfsError::ENOTDIR);
        }

        let acl = self.get_acl(&cred.company_id, &parent.id, &cred.uid).await?;
        if !can_write(cred, &parent, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "create", Some(&parent.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if self.get_child_inode(&cred.company_id, &parent.id, &child_name).await?.is_some() {
            return Err(VfsError::EEXIST);
        }

        let inode_id = format!("ino_{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        let effective_mode = if mode == 0 { 0o644 } else { mode & 0o777 };
        let gid = cred.gids.first().cloned().unwrap_or_else(|| "everyone".to_string());

        self.turso.execute(
            "INSERT INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, NULL)",
            libsql::params![
                cred.company_id.clone(),
                inode_id.clone(),
                parent.id,
                child_name,
                kind.as_str(),
                cred.uid.clone(),
                gid,
                effective_mode as i64,
                now.clone(),
                now
            ],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let created = self.get_inode_by_id(&cred.company_id, &inode_id).await?;
        self.write_audit(&cred.company_id, &cred.uid, "create", Some(&inode_id), true, Some(path)).await;
        Ok(created)
    }

    // ── SYSCALL: mkdir ────────────────────────────────────────────────────────
    pub async fn mkdir(&self, cred: &Cred, path: &str, mode: u32) -> Result<VfsInode, VfsError> {
        let (parent_path, child_name) = split_parent_child(path)?;
        let parent = match self.resolve_path(cred, &parent_path, true).await {
            Ok(p) => p,
            Err(e) => {
                self.write_audit(&cred.company_id, &cred.uid, "mkdir", None, false, Some(path)).await;
                return Err(e);
            }
        };

        if parent.kind != InodeKind::Dir {
            return Err(VfsError::ENOTDIR);
        }

        let acl = self.get_acl(&cred.company_id, &parent.id, &cred.uid).await?;
        if !can_write(cred, &parent, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "mkdir", Some(&parent.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if self.get_child_inode(&cred.company_id, &parent.id, &child_name).await?.is_some() {
            return Err(VfsError::EEXIST);
        }

        let inode_id = format!("dir_{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        let effective_mode = if mode == 0 { 0o755 } else { mode & 0o777 };
        let gid = cred.gids.first().cloned().unwrap_or_else(|| "everyone".to_string());

        self.turso.execute(
            "INSERT INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, ?, ?, ?, 'dir', ?, ?, ?, 0, 0, ?, ?, NULL, NULL)",
            libsql::params![
                cred.company_id.clone(),
                inode_id.clone(),
                parent.id,
                child_name,
                cred.uid.clone(),
                gid,
                effective_mode as i64,
                now.clone(),
                now
            ],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let created = self.get_inode_by_id(&cred.company_id, &inode_id).await?;
        self.write_audit(&cred.company_id, &cred.uid, "mkdir", Some(&inode_id), true, Some(path)).await;
        Ok(created)
    }

    // ── SYSCALL: unlink ───────────────────────────────────────────────────────
    pub async fn unlink(&self, cred: &Cred, path: &str) -> Result<(), VfsError> {
        let (parent_path, _name) = split_parent_child(path)?;
        let parent = self.resolve_path(cred, &parent_path, true).await?;
        let target = self.resolve_path(cred, path, false).await?;

        if target.kind == InodeKind::Dir {
            return Err(VfsError::EISDIR);
        }

        let acl = self.get_acl(&cred.company_id, &parent.id, &cred.uid).await?;
        if !can_write(cred, &parent, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "unlink", Some(&target.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        // Clean up any blob storage file
        if let Some(ref blob_key) = target.blob_ref {
            let file_path = format!("public/uploads/{}", blob_key);
            let _ = tokio::fs::remove_file(file_path).await;
        }

        self.turso.execute(
            "DELETE FROM vfs_inodes WHERE company_id = ? AND id = ?",
            libsql::params![cred.company_id.clone(), target.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let _ = self.turso.execute(
            "DELETE FROM vfs_acl WHERE company_id = ? AND inode_id = ?",
            libsql::params![cred.company_id.clone(), target.id.clone()],
        ).await;

        self.write_audit(&cred.company_id, &cred.uid, "unlink", Some(&target.id), true, Some(path)).await;
        Ok(())
    }

    // ── SYSCALL: rmdir ────────────────────────────────────────────────────────
    pub async fn rmdir(&self, cred: &Cred, path: &str) -> Result<(), VfsError> {
        let (parent_path, _name) = split_parent_child(path)?;
        let parent = self.resolve_path(cred, &parent_path, true).await?;
        let target = self.resolve_path(cred, path, false).await?;

        if target.kind != InodeKind::Dir {
            return Err(VfsError::ENOTDIR);
        }

        let acl = self.get_acl(&cred.company_id, &parent.id, &cred.uid).await?;
        if !can_write(cred, &parent, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "rmdir", Some(&target.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        // Check if directory is empty
        let mut rows = self.turso.query(
            "SELECT count(*) FROM vfs_inodes WHERE company_id = ? AND parent_id = ?",
            libsql::params![cred.company_id.clone(), target.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        if let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            let count: i64 = row.get(0).unwrap_or(0);
            if count > 0 {
                return Err(VfsError::ENOTEMPTY);
            }
        }

        self.turso.execute(
            "DELETE FROM vfs_inodes WHERE company_id = ? AND id = ?",
            libsql::params![cred.company_id.clone(), target.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.write_audit(&cred.company_id, &cred.uid, "rmdir", Some(&target.id), true, Some(path)).await;
        Ok(())
    }

    // ── SYSCALL: rename ───────────────────────────────────────────────────────
    pub async fn rename(&self, cred: &Cred, old_path: &str, new_path: &str) -> Result<(), VfsError> {
        let (old_parent_path, _) = split_parent_child(old_path)?;
        let (new_parent_path, new_name) = split_parent_child(new_path)?;

        let old_parent = self.resolve_path(cred, &old_parent_path, true).await?;
        let new_parent = self.resolve_path(cred, &new_parent_path, true).await?;
        let src_inode = self.resolve_path(cred, old_path, false).await?;

        let old_acl = self.get_acl(&cred.company_id, &old_parent.id, &cred.uid).await?;
        let new_acl = self.get_acl(&cred.company_id, &new_parent.id, &cred.uid).await?;

        if !can_write(cred, &old_parent, old_acl.as_ref()) || !can_write(cred, &new_parent, new_acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "rename", Some(&src_inode.id), false, Some("Write permission denied")).await;
            return Err(VfsError::EACCES);
        }

        // If destination exists, handle replacement
        if let Some(existing_target) = self.get_child_inode(&cred.company_id, &new_parent.id, &new_name).await? {
            if existing_target.kind == InodeKind::Dir {
                if src_inode.kind != InodeKind::Dir {
                    return Err(VfsError::EISDIR);
                }
                // Check if target dir is empty
                let mut rows = self.turso.query(
                    "SELECT count(*) FROM vfs_inodes WHERE company_id = ? AND parent_id = ?",
                    libsql::params![cred.company_id.clone(), existing_target.id.clone()],
                ).await.map_err(|e| VfsError::EIO(e.to_string()))?;
                if let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
                    let count: i64 = row.get(0).unwrap_or(0);
                    if count > 0 {
                        return Err(VfsError::ENOTEMPTY);
                    }
                }
            } else if src_inode.kind == InodeKind::Dir {
                return Err(VfsError::ENOTDIR);
            }

            self.turso.execute(
                "DELETE FROM vfs_inodes WHERE company_id = ? AND id = ?",
                libsql::params![cred.company_id.clone(), existing_target.id],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?;
        }

        let now = Utc::now().to_rfc3339();
        self.turso.execute(
            "UPDATE vfs_inodes SET parent_id = ?, name = ?, mtime = ? WHERE company_id = ? AND id = ?",
            libsql::params![new_parent.id, new_name, now, cred.company_id.clone(), src_inode.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.write_audit(&cred.company_id, &cred.uid, "rename", Some(&src_inode.id), true, Some(&format!("{} -> {}", old_path, new_path))).await;
        Ok(())
    }

    // ── SYSCALL: chmod ────────────────────────────────────────────────────────
    pub async fn chmod(&self, cred: &Cred, path: &str, mode: u32) -> Result<(), VfsError> {
        let inode = self.resolve_path(cred, path, false).await?;

        // Only owner or admin may chmod
        if cred.uid != inode.owner && !cred.is_admin {
            self.write_audit(&cred.company_id, &cred.uid, "chmod", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if inode.sealed && !cred.break_glass && cred.uid != inode.owner {
            self.write_audit(&cred.company_id, &cred.uid, "chmod", Some(&inode.id), false, Some("Sealed node chmod denied without break-glass")).await;
            return Err(VfsError::EACCES);
        }

        let now = Utc::now().to_rfc3339();
        let effective_mode = mode & 0o777;
        self.turso.execute(
            "UPDATE vfs_inodes SET mode = ?, ctime = ? WHERE company_id = ? AND id = ?",
            libsql::params![effective_mode as i64, now, cred.company_id.clone(), inode.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.write_audit(&cred.company_id, &cred.uid, "chmod", Some(&inode.id), true, Some(&format!("mode: {:o}", effective_mode))).await;
        Ok(())
    }

    // ── SYSCALL: chown ────────────────────────────────────────────────────────
    pub async fn chown(&self, cred: &Cred, path: &str, new_owner: &str) -> Result<(), VfsError> {
        let inode = self.resolve_path(cred, path, false).await?;

        if !cred.is_admin {
            self.write_audit(&cred.company_id, &cred.uid, "chown", Some(&inode.id), false, Some("Only admin can chown")).await;
            return Err(VfsError::EACCES);
        }

        if inode.sealed && !cred.break_glass {
            self.write_audit(&cred.company_id, &cred.uid, "chown", Some(&inode.id), false, Some("Sealed node chown denied")).await;
            return Err(VfsError::EACCES);
        }

        let now = Utc::now().to_rfc3339();
        self.turso.execute(
            "UPDATE vfs_inodes SET owner = ?, ctime = ? WHERE company_id = ? AND id = ?",
            libsql::params![new_owner, now, cred.company_id.clone(), inode.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.write_audit(&cred.company_id, &cred.uid, "chown", Some(&inode.id), true, Some(new_owner)).await;
        Ok(())
    }

    // ── SYSCALL: chgrp ────────────────────────────────────────────────────────
    pub async fn chgrp(&self, cred: &Cred, path: &str, new_gid: &str) -> Result<(), VfsError> {
        let inode = self.resolve_path(cred, path, false).await?;

        if cred.uid != inode.owner && !cred.is_admin {
            self.write_audit(&cred.company_id, &cred.uid, "chgrp", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        let now = Utc::now().to_rfc3339();
        self.turso.execute(
            "UPDATE vfs_inodes SET gid = ?, ctime = ? WHERE company_id = ? AND id = ?",
            libsql::params![new_gid, now, cred.company_id.clone(), inode.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        self.write_audit(&cred.company_id, &cred.uid, "chgrp", Some(&inode.id), true, Some(new_gid)).await;
        Ok(())
    }

    // ── SYSCALL: symlink ──────────────────────────────────────────────────────
    pub async fn symlink(&self, cred: &Cred, target: &str, link_path: &str) -> Result<VfsInode, VfsError> {
        let (parent_path, child_name) = split_parent_child(link_path)?;
        let parent = self.resolve_path(cred, &parent_path, true).await?;

        let acl = self.get_acl(&cred.company_id, &parent.id, &cred.uid).await?;
        if !can_write(cred, &parent, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "symlink", Some(&parent.id), false, Some(link_path)).await;
            return Err(VfsError::EACCES);
        }

        if self.get_child_inode(&cred.company_id, &parent.id, &child_name).await?.is_some() {
            return Err(VfsError::EEXIST);
        }

        let inode_id = format!("sym_{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        let meta = serde_json::json!({ "target": target }).to_string();
        let gid = cred.gids.first().cloned().unwrap_or_else(|| "everyone".to_string());

        self.turso.execute(
            "INSERT INTO vfs_inodes (company_id, id, parent_id, name, kind, owner, gid, mode, sealed, size, mtime, ctime, blob_ref, meta_json)
             VALUES (?, ?, ?, ?, 'symlink', ?, ?, ?, 0, ?, ?, ?, NULL, ?)",
            libsql::params![
                cred.company_id.clone(),
                inode_id.clone(),
                parent.id,
                child_name,
                cred.uid.clone(),
                gid,
                0o777 as i64,
                target.len() as i64,
                now.clone(),
                now,
                meta
            ],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let created = self.get_inode_by_id(&cred.company_id, &inode_id).await?;
        self.write_audit(&cred.company_id, &cred.uid, "symlink", Some(&inode_id), true, Some(&format!("{} -> {}", link_path, target))).await;
        Ok(created)
    }

    // ── SYSCALL: readlink ─────────────────────────────────────────────────────
    pub async fn readlink(&self, cred: &Cred, path: &str) -> Result<String, VfsError> {
        let inode = self.resolve_path(cred, path, false).await?;

        if inode.kind != InodeKind::Symlink {
            return Err(VfsError::EINVAL("Not a symlink".to_string()));
        }

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_read(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "readlink", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if let Some(ref meta) = inode.meta_json {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(meta) {
                if let Some(t) = v.get("target").and_then(|t| t.as_str()) {
                    self.write_audit(&cred.company_id, &cred.uid, "readlink", Some(&inode.id), true, Some(path)).await;
                    return Ok(t.to_string());
                }
            }
        }

        Err(VfsError::EIO("Corrupted symlink target".to_string()))
    }

    // ── SYSCALL: setfacl ──────────────────────────────────────────────────────
    pub async fn setfacl(&self, cred: &Cred, path: &str, target_uid: &str, perms: u32) -> Result<(), VfsError> {
        let inode = self.resolve_path(cred, path, false).await?;

        // Only owner or admin may setfacl
        if cred.uid != inode.owner && !cred.is_admin {
            self.write_audit(&cred.company_id, &cred.uid, "setfacl", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        if inode.sealed && !cred.break_glass && cred.uid != inode.owner {
            self.write_audit(&cred.company_id, &cred.uid, "setfacl", Some(&inode.id), false, Some("Sealed node setfacl denied")).await;
            return Err(VfsError::EACCES);
        }

        if perms == 0 {
            self.turso.execute(
                "DELETE FROM vfs_acl WHERE company_id = ? AND inode_id = ? AND uid = ?",
                libsql::params![cred.company_id.clone(), inode.id.clone(), target_uid],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?;
        } else {
            let effective_perms = perms & 0o7;
            self.turso.execute(
                "INSERT OR REPLACE INTO vfs_acl (company_id, inode_id, uid, perms) VALUES (?, ?, ?, ?)",
                libsql::params![cred.company_id.clone(), inode.id.clone(), target_uid, effective_perms as i64],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?;
        }

        self.write_audit(&cred.company_id, &cred.uid, "setfacl", Some(&inode.id), true, Some(&format!("user:{} perms:{:o}", target_uid, perms))).await;
        Ok(())
    }

    // ── SYSCALL: getfacl ──────────────────────────────────────────────────────
    pub async fn getfacl(&self, cred: &Cred, path: &str) -> Result<Vec<VfsAcl>, VfsError> {
        let inode = self.resolve_path(cred, path, false).await?;

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_read(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "getfacl", Some(&inode.id), false, Some(path)).await;
            return Err(VfsError::EACCES);
        }

        let mut rows = self.turso.query(
            "SELECT company_id, inode_id, uid, perms FROM vfs_acl WHERE company_id = ? AND inode_id = ?",
            libsql::params![cred.company_id.clone(), inode.id.clone()],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        let mut acls = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            let cid: String = row.get(0).map_err(|e| VfsError::EIO(e.to_string()))?;
            let iid: String = row.get(1).map_err(|e| VfsError::EIO(e.to_string()))?;
            let u: String = row.get(2).map_err(|e| VfsError::EIO(e.to_string()))?;
            let p: i64 = row.get(3).map_err(|e| VfsError::EIO(e.to_string()))?;
            acls.push(VfsAcl { company_id: cid, inode_id: iid, uid: u, perms: p as u32 });
        }

        self.write_audit(&cred.company_id, &cred.uid, "getfacl", Some(&inode.id), true, Some(path)).await;
        Ok(acls)
    }

    // ── SYSCALL: append_message ───────────────────────────────────────────────
    pub async fn append_message(&self, cred: &Cred, chat_path: &str, body_text: &str) -> Result<VfsMessage, VfsError> {
        let inode = self.resolve_path(cred, chat_path, true).await?;

        if inode.kind != InodeKind::Chat {
            return Err(VfsError::EINVAL("Target inode is not a chat conversation".to_string()));
        }

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_write(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "append_message", Some(&inode.id), false, Some(chat_path)).await;
            return Err(VfsError::EACCES);
        }

        let enc_body = crypto::encrypt_for_org(&cred.company_id, body_text.as_bytes())
            .map_err(|e| VfsError::EIO(format!("Encryption failed: {}", e)))?;

        let msg_id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();

        self.turso.execute(
            "INSERT INTO vfs_messages (company_id, id, chat_inode_id, sender_uid, ts, body_encrypted)
             VALUES (?, ?, ?, ?, ?, ?)",
            libsql::params![
                cred.company_id.clone(),
                msg_id.clone(),
                inode.id.clone(),
                cred.uid.clone(),
                now.clone(),
                enc_body
            ],
        ).await.map_err(|e| VfsError::EIO(e.to_string()))?;

        // Update chat inode mtime & size
        let _ = self.turso.execute(
            "UPDATE vfs_inodes SET mtime = ?, size = size + 1 WHERE company_id = ? AND id = ?",
            libsql::params![now.clone(), cred.company_id.clone(), inode.id.clone()],
        ).await;

        self.write_audit(&cred.company_id, &cred.uid, "append_message", Some(&inode.id), true, Some(&msg_id)).await;

        Ok(VfsMessage {
            company_id: cred.company_id.clone(),
            id: msg_id,
            chat_inode_id: inode.id,
            sender_uid: cred.uid.clone(),
            ts: now,
            body_encrypted: body_text.to_string(), // Return decrypted for caller
        })
    }

    // ── SYSCALL: read_messages ────────────────────────────────────────────────
    pub async fn read_messages(&self, cred: &Cred, chat_path: &str, limit: usize, before_ts: Option<&str>) -> Result<Vec<VfsMessage>, VfsError> {
        let inode = self.resolve_path(cred, chat_path, true).await?;

        if inode.kind != InodeKind::Chat {
            return Err(VfsError::EINVAL("Target inode is not a chat conversation".to_string()));
        }

        let acl = self.get_acl(&cred.company_id, &inode.id, &cred.uid).await?;
        if !can_read(cred, &inode, acl.as_ref()) {
            self.write_audit(&cred.company_id, &cred.uid, "read_messages", Some(&inode.id), false, Some(chat_path)).await;
            return Err(VfsError::EACCES);
        }

        let eff_limit = limit.clamp(1, 1000);
        let mut rows = if let Some(bts) = before_ts {
            self.turso.query(
                "SELECT company_id, id, chat_inode_id, sender_uid, ts, body_encrypted
                 FROM vfs_messages WHERE company_id = ? AND chat_inode_id = ? AND ts < ?
                 ORDER BY ts ASC LIMIT ?",
                libsql::params![cred.company_id.clone(), inode.id.clone(), bts, eff_limit as i64],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?
        } else {
            self.turso.query(
                "SELECT company_id, id, chat_inode_id, sender_uid, ts, body_encrypted
                 FROM vfs_messages WHERE company_id = ? AND chat_inode_id = ?
                 ORDER BY ts ASC LIMIT ?",
                libsql::params![cred.company_id.clone(), inode.id.clone(), eff_limit as i64],
            ).await.map_err(|e| VfsError::EIO(e.to_string()))?
        };

        let mut messages = Vec::new();
        while let Some(row) = rows.next().await.map_err(|e| VfsError::EIO(e.to_string()))? {
            let cid: String = row.get(0).map_err(|e| VfsError::EIO(e.to_string()))?;
            let id: String = row.get(1).map_err(|e| VfsError::EIO(e.to_string()))?;
            let chi: String = row.get(2).map_err(|e| VfsError::EIO(e.to_string()))?;
            let sender: String = row.get(3).map_err(|e| VfsError::EIO(e.to_string()))?;
            let ts: String = row.get(4).map_err(|e| VfsError::EIO(e.to_string()))?;
            let enc_body: String = row.get(5).map_err(|e| VfsError::EIO(e.to_string()))?;

            let decrypted_body = match crypto::decrypt_for_org(Some(&cred.company_id), &enc_body) {
                Ok((_, bytes)) => String::from_utf8_lossy(&bytes).to_string(),
                Err(_) => enc_body,
            };

            messages.push(VfsMessage {
                company_id: cid,
                id,
                chat_inode_id: chi,
                sender_uid: sender,
                ts,
                body_encrypted: decrypted_body,
            });
        }

        self.write_audit(&cred.company_id, &cred.uid, "read_messages", Some(&inode.id), true, Some(&format!("count: {}", messages.len()))).await;
        Ok(messages)
    }
}
