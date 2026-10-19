use super::schema::{Cred, VfsAcl, VfsInode};

pub const MAY_READ: u32 = 0o4;
pub const MAY_WRITE: u32 = 0o2;
pub const MAY_EXEC: u32 = 0o1;

/// Pure function determining whether a credential has the requested permissions on an inode.
///
/// Rules:
/// 1. Cross-Company Isolation: `cred.company_id != inode.company_id` is unconditionally denied.
/// 2. Sealed Inodes (e.g. private DMs):
///    - Admin privileges DO NOT bypass sealed nodes.
///    - Only an explicit, audited break-glass action (`cred.break_glass && cred.is_admin`) allows bypass.
///    - Otherwise, caller must be owner, member of the inode's group, or explicitly permitted by ACL.
/// 3. Non-Sealed Inodes:
///    - Company admins (`cred.is_admin`) may bypass permission checks.
/// 4. ACL Override:
///    - An explicit per-user ACL for `cred.uid` overrides group and other permission bits.
/// 5. Standard POSIX Discretionary Access Control:
///    - Owner bits (`mode >> 6 & 0o7`) apply if caller is inode owner.
///    - Group bits (`mode >> 3 & 0o7`) apply if caller belongs to inode gid.
///    - Other bits (`mode & 0o7`) apply otherwise.
pub fn can(cred: &Cred, inode: &VfsInode, want: u32, acl: Option<&VfsAcl>) -> bool {
    // 1. Cross-Company isolation barrier
    if cred.company_id != inode.company_id {
        return false;
    }

    // 2. Sealed Inodes (DMs)
    if inode.sealed {
        if cred.break_glass && cred.is_admin {
            return true;
        }

        // Without break-glass, admin privileges are neutralized for sealed nodes.
        // Check per-user ACL first if present
        if let Some(a) = acl {
            if a.uid == cred.uid && a.company_id == cred.company_id {
                return (a.perms & want) == want;
            }
        }

        // Check owner
        if cred.uid == inode.owner {
            let owner_bits = (inode.mode >> 6) & 0o7;
            return (owner_bits & want) == want;
        }

        // Check group
        if cred.gids.iter().any(|g| g == &inode.gid) {
            let group_bits = (inode.mode >> 3) & 0o7;
            return (group_bits & want) == want;
        }

        // Check other
        let other_bits = inode.mode & 0o7;
        return (other_bits & want) == want;
    }

    // 3. Admin / Root bypass on non-sealed nodes
    if cred.is_admin {
        return true;
    }

    // 4. Per-user ACL override
    if let Some(a) = acl {
        if a.uid == cred.uid && a.company_id == cred.company_id {
            return (a.perms & want) == want;
        }
    }

    // 5. Classic POSIX rwx bits
    if cred.uid == inode.owner {
        let owner_bits = (inode.mode >> 6) & 0o7;
        return (owner_bits & want) == want;
    }

    if cred.gids.iter().any(|g| g == &inode.gid) {
        let group_bits = (inode.mode >> 3) & 0o7;
        return (group_bits & want) == want;
    }

    let other_bits = inode.mode & 0o7;
    (other_bits & want) == want
}

pub fn can_read(cred: &Cred, inode: &VfsInode, acl: Option<&VfsAcl>) -> bool {
    can(cred, inode, MAY_READ, acl)
}

pub fn can_write(cred: &Cred, inode: &VfsInode, acl: Option<&VfsAcl>) -> bool {
    can(cred, inode, MAY_WRITE, acl)
}

pub fn can_exec(cred: &Cred, inode: &VfsInode, acl: Option<&VfsAcl>) -> bool {
    can(cred, inode, MAY_EXEC, acl)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vfs::schema::InodeKind;

    fn make_test_inode(company_id: &str, owner: &str, gid: &str, mode: u32, sealed: bool) -> VfsInode {
        VfsInode {
            company_id: company_id.to_string(),
            id: "ino_test_1".to_string(),
            parent_id: Some("root".to_string()),
            name: "test_node".to_string(),
            kind: InodeKind::File,
            owner: owner.to_string(),
            gid: gid.to_string(),
            mode,
            sealed,
            size: 100,
            mtime: "2026-10-19T00:00:00Z".to_string(),
            ctime: "2026-10-19T00:00:00Z".to_string(),
            blob_ref: None,
            meta_json: None,
        }
    }

    #[test]
    fn test_cross_company_access_strictly_denied() {
        let inode = make_test_inode("comp_alpha", "user_alice", "grp_dev", 0o777, false);
        // Even admin of another company cannot access
        let attacker = Cred::new("comp_beta", "user_bob", vec!["grp_dev".to_string()], true);
        assert!(!can(&attacker, &inode, MAY_READ, None));
        assert!(!can(&attacker, &inode, MAY_WRITE, None));
        assert!(!can(&attacker, &inode, MAY_EXEC, None));
    }

    #[test]
    fn test_owner_permissions() {
        let inode = make_test_inode("comp_alpha", "user_alice", "grp_dev", 0o600, false);
        let alice = Cred::new("comp_alpha", "user_alice", vec![], false);
        let bob = Cred::new("comp_alpha", "user_bob", vec![], false);

        assert!(can(&alice, &inode, MAY_READ, None));
        assert!(can(&alice, &inode, MAY_WRITE, None));
        assert!(!can(&alice, &inode, MAY_EXEC, None));

        assert!(!can(&bob, &inode, MAY_READ, None));
        assert!(!can(&bob, &inode, MAY_WRITE, None));
    }

    #[test]
    fn test_group_permissions() {
        let inode = make_test_inode("comp_alpha", "user_alice", "grp_dev", 0o750, false);
        let bob = Cred::new("comp_alpha", "user_bob", vec!["grp_dev".to_string()], false);
        let charlie = Cred::new("comp_alpha", "user_charlie", vec!["grp_sales".to_string()], false);

        // Bob is in grp_dev (mode 5 = r-x)
        assert!(can(&bob, &inode, MAY_READ, None));
        assert!(!can(&bob, &inode, MAY_WRITE, None));
        assert!(can(&bob, &inode, MAY_EXEC, None));

        // Charlie is in grp_sales (other = 0)
        assert!(!can(&charlie, &inode, MAY_READ, None));
        assert!(!can(&charlie, &inode, MAY_WRITE, None));
        assert!(!can(&charlie, &inode, MAY_EXEC, None));
    }

    #[test]
    fn test_other_permissions() {
        let inode = make_test_inode("comp_alpha", "user_alice", "grp_dev", 0o644, false);
        let external = Cred::new("comp_alpha", "user_stranger", vec![], false);

        assert!(can(&external, &inode, MAY_READ, None));
        assert!(!can(&external, &inode, MAY_WRITE, None));
        assert!(!can(&external, &inode, MAY_EXEC, None));
    }

    #[test]
    fn test_admin_bypasses_non_sealed_nodes() {
        let inode = make_test_inode("comp_alpha", "user_alice", "grp_secret", 0o000, false);
        let admin = Cred::new("comp_alpha", "user_admin", vec![], true);

        assert!(can(&admin, &inode, MAY_READ, None));
        assert!(can(&admin, &inode, MAY_WRITE, None));
        assert!(can(&admin, &inode, MAY_EXEC, None));
    }

    #[test]
    fn test_sealed_dm_admin_denied_without_break_glass() {
        // DM between Alice and Bob with mode 0660, gid = dm_alice_bob, sealed = true
        let dm_inode = make_test_inode("comp_alpha", "user_alice", "dm_alice_bob", 0o660, true);

        let admin = Cred::new("comp_alpha", "user_admin", vec!["admin".to_string()], true);
        let alice = Cred::new("comp_alpha", "user_alice", vec!["dm_alice_bob".to_string()], false);
        let bob = Cred::new("comp_alpha", "user_bob", vec!["dm_alice_bob".to_string()], false);
        let outsider = Cred::new("comp_alpha", "user_charlie", vec!["engineering".to_string()], false);

        // Participants can read/write
        assert!(can(&alice, &dm_inode, MAY_READ, None));
        assert!(can(&alice, &dm_inode, MAY_WRITE, None));
        assert!(can(&bob, &dm_inode, MAY_READ, None));
        assert!(can(&bob, &dm_inode, MAY_WRITE, None));

        // Company admin CANNOT read or write sealed DM
        assert!(!can(&admin, &dm_inode, MAY_READ, None));
        assert!(!can(&admin, &dm_inode, MAY_WRITE, None));

        // Outsider cannot read
        assert!(!can(&outsider, &dm_inode, MAY_READ, None));

        // Admin with explicit break_glass action CAN read
        let break_glass_admin = admin.with_break_glass(true);
        assert!(can(&break_glass_admin, &dm_inode, MAY_READ, None));
        assert!(can(&break_glass_admin, &dm_inode, MAY_WRITE, None));
    }

    #[test]
    fn test_acl_override() {
        let inode = make_test_inode("comp_alpha", "user_alice", "grp_dev", 0o600, false);
        let bob = Cred::new("comp_alpha", "user_bob", vec![], false);

        // Bob normally cannot read 0600
        assert!(!can(&bob, &inode, MAY_READ, None));

        // Specific ACL granted to Bob for read + write (0o6)
        let acl = VfsAcl {
            company_id: "comp_alpha".to_string(),
            inode_id: inode.id.clone(),
            uid: "user_bob".to_string(),
            perms: MAY_READ | MAY_WRITE,
        };

        assert!(can(&bob, &inode, MAY_READ, Some(&acl)));
        assert!(can(&bob, &inode, MAY_WRITE, Some(&acl)));
        assert!(!can(&bob, &inode, MAY_EXEC, Some(&acl)));
    }
}
