use super::schema::VfsError;

/// Normalizes a virtual Unix-style path.
///
/// Rules:
/// - Always starts with `/`.
/// - Resolves `.` and `..` segments.
/// - Does not allow traversing above `/`.
/// - Eliminates redundant slashes.
/// - Strips trailing slash unless the path is root `/`.
pub fn normalize_path(path: &str) -> String {
    let raw = path.trim();
    if raw.is_empty() || raw == "/" {
        return "/".to_string();
    }

    let mut parts: Vec<&str> = Vec::new();
    for seg in raw.split('/') {
        match seg {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }

    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

/// Splits a normalized path into individual path components.
/// E.g. `"/chats/dm/user1_user2"` -> `["chats", "dm", "user1_user2"]`
/// Root `"/"` -> `[]`
pub fn split_path(path: &str) -> Vec<String> {
    let norm = normalize_path(path);
    if norm == "/" {
        Vec::new()
    } else {
        norm[1..].split('/').map(|s| s.to_string()).collect()
    }
}

/// Splits a path into its parent directory path and child basename.
///
/// Examples:
/// - `"/a/b/c"` -> `("/a/b", "c")`
/// - `"/a"` -> `("/", "a")`
/// - `"/"` -> `Err(VfsError::EINVAL)`
pub fn split_parent_child(path: &str) -> Result<(String, String), VfsError> {
    let norm = normalize_path(path);
    if norm == "/" {
        return Err(VfsError::EINVAL("Root directory has no parent".to_string()));
    }

    let mut parts = split_path(&norm);
    let child = parts.pop().unwrap();
    let parent = if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    };

    Ok((parent, child))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        assert_eq!(normalize_path(""), "/");
        assert_eq!(normalize_path("/"), "/");
        assert_eq!(normalize_path("///"), "/");
        assert_eq!(normalize_path("/a/b/c"), "/a/b/c");
        assert_eq!(normalize_path("/a/b/c/"), "/a/b/c");
        assert_eq!(normalize_path("/a/./b/../c"), "/a/c");
        assert_eq!(normalize_path("/../../a/b"), "/a/b");
        assert_eq!(normalize_path("a/b/c"), "/a/b/c");
    }

    #[test]
    fn test_split_path() {
        assert_eq!(split_path("/"), Vec::<String>::new());
        assert_eq!(split_path("/etc/passwd"), vec!["etc", "passwd"]);
        assert_eq!(split_path("/chats/public/general"), vec!["chats", "public", "general"]);
    }

    #[test]
    fn test_split_parent_child() {
        assert_eq!(split_parent_child("/chats/public/general").unwrap(), ("/chats/public".to_string(), "general".to_string()));
        assert_eq!(split_parent_child("/chats").unwrap(), ("/".to_string(), "chats".to_string()));
        assert!(split_parent_child("/").is_err());
    }
}
