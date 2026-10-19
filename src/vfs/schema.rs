use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InodeKind {
    Dir,
    File,
    Chat,
    Sheet,
    Doc,
    Board,
    Task,
    Symlink,
}

impl InodeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            InodeKind::Dir => "dir",
            InodeKind::File => "file",
            InodeKind::Chat => "chat",
            InodeKind::Sheet => "sheet",
            InodeKind::Doc => "doc",
            InodeKind::Board => "board",
            InodeKind::Task => "task",
            InodeKind::Symlink => "symlink",
        }
    }

    pub fn from_str_name(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "dir" => Some(InodeKind::Dir),
            "file" => Some(InodeKind::File),
            "chat" => Some(InodeKind::Chat),
            "sheet" => Some(InodeKind::Sheet),
            "doc" => Some(InodeKind::Doc),
            "board" => Some(InodeKind::Board),
            "task" => Some(InodeKind::Task),
            "symlink" => Some(InodeKind::Symlink),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsUser {
    pub company_id: String,
    pub uid: String,
    pub name: String,
    pub kind: String, // "human" | "agent"
    pub caps: String,
    pub home_inode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsGroup {
    pub company_id: String,
    pub gid: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsGroupMember {
    pub company_id: String,
    pub gid: String,
    pub uid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsInode {
    pub company_id: String,
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub kind: InodeKind,
    pub owner: String,
    pub gid: String,
    pub mode: u32,
    pub sealed: bool,
    pub size: u64,
    pub mtime: String,
    pub ctime: String,
    pub blob_ref: Option<String>,
    pub meta_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsAcl {
    pub company_id: String,
    pub inode_id: String,
    pub uid: String,
    pub perms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsMessage {
    pub company_id: String,
    pub id: String,
    pub chat_inode_id: String,
    pub sender_uid: String,
    pub ts: String,
    pub body_encrypted: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsAudit {
    pub company_id: String,
    pub ts: String,
    pub uid: String,
    pub op: String,
    pub inode_id: Option<String>,
    pub allowed: bool,
    pub detail: Option<String>,
}

/// Verified caller identity for permission checking and syscall execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cred {
    pub company_id: String,
    pub uid: String,
    pub gids: Vec<String>,
    pub is_admin: bool,
    pub break_glass: bool,
}

impl Cred {
    pub fn new(company_id: impl Into<String>, uid: impl Into<String>, gids: Vec<String>, is_admin: bool) -> Self {
        Self {
            company_id: company_id.into(),
            uid: uid.into(),
            gids,
            is_admin,
            break_glass: false,
        }
    }

    pub fn with_break_glass(mut self, enabled: bool) -> Self {
        self.break_glass = enabled;
        self
    }
}

#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VfsError {
    #[error("Permission denied (EACCES)")]
    EACCES,
    #[error("No such file or directory (ENOENT)")]
    ENOENT,
    #[error("File exists (EEXIST)")]
    EEXIST,
    #[error("Not a directory (ENOTDIR)")]
    ENOTDIR,
    #[error("Is a directory (EISDIR)")]
    EISDIR,
    #[error("Directory not empty (ENOTEMPTY)")]
    ENOTEMPTY,
    #[error("Invalid argument (EINVAL): {0}")]
    EINVAL(String),
    #[error("I/O error (EIO): {0}")]
    EIO(String),
}

impl VfsError {
    pub fn errno_str(&self) -> &'static str {
        match self {
            VfsError::EACCES => "EACCES",
            VfsError::ENOENT => "ENOENT",
            VfsError::EEXIST => "EEXIST",
            VfsError::ENOTDIR => "ENOTDIR",
            VfsError::EISDIR => "EISDIR",
            VfsError::ENOTEMPTY => "ENOTEMPTY",
            VfsError::EINVAL(_) => "EINVAL",
            VfsError::EIO(_) => "EIO",
        }
    }

    pub fn status_code(&self) -> axum::http::StatusCode {
        match self {
            VfsError::EACCES => axum::http::StatusCode::FORBIDDEN,
            VfsError::ENOENT => axum::http::StatusCode::NOT_FOUND,
            VfsError::EEXIST => axum::http::StatusCode::CONFLICT,
            VfsError::ENOTDIR => axum::http::StatusCode::BAD_REQUEST,
            VfsError::EISDIR => axum::http::StatusCode::BAD_REQUEST,
            VfsError::ENOTEMPTY => axum::http::StatusCode::CONFLICT,
            VfsError::EINVAL(_) => axum::http::StatusCode::BAD_REQUEST,
            VfsError::EIO(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VfsExportFile {
    pub path: String,
    pub kind: String,
    pub mode: u32,
    pub content: String,
}

