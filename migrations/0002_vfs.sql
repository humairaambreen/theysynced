-- 0002_vfs.sql: Per-Company Virtual Filesystem (VFS) Tables
-- Every table is scoped by company_id for strict isolation.

CREATE TABLE IF NOT EXISTS vfs_users (
    company_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'human', -- 'human' | 'agent'
    caps TEXT NOT NULL DEFAULT '[]',     -- capabilities (JSON array)
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
    parent_id TEXT, -- NULL for root '/'
    name TEXT NOT NULL,
    kind TEXT NOT NULL, -- 'dir' | 'file' | 'chat' | 'sheet' | 'doc' | 'board' | 'task' | 'symlink'
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
