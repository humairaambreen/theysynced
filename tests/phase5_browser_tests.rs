use std::sync::Arc;
use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use dashmap::DashMap;
use tower::ServiceExt;
use url::Url;

use theysynced::{
    create_app,
    database::Database,
    vfs::VfsHub,
    browser_proxy::{relax_csp_frame_ancestors, rewrite_html_content, rewrite_set_cookie_directive, sanitize_and_rewrite_headers},
    AppState,
};

async fn setup_phase5_test_app() -> (axum::Router, Arc<Database>, AppState) {
    std::env::set_var("TURSO_DATABASE_URL", ":memory:");
    std::env::set_var("JWT_SECRET", "test_jwt_secret_phase5_browser_suite_2026");
    std::env::set_var("ORG_ENCRYPTION_SECRET", "test_org_encryption_secret_phase5_2026");

    let db = Arc::new(Database::new().await.unwrap());
    let vfs_hub = Arc::new(VfsHub::new());
    let state = AppState {
        db: db.clone(),
        sessions: Arc::new(DashMap::new()),
        vfs_hub,
        cookie_jar: Arc::new(DashMap::new()),
    };
    let app = create_app(state.clone());
    (app, db, state)
}

#[tokio::test]
async fn test_browser_proxy_unauthenticated_rejected() {
    let (app, _db, _state) = setup_phase5_test_app().await;

    // Missing token
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/proxy?url=https://example.com")
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // Invalid token
    let req = Request::builder()
        .method("GET")
        .uri("/api/browser/proxy?url=https://example.com&token=invalid_token_123")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_browser_proxy_ssrf_blocked() {
    let (app, db, _state) = setup_phase5_test_app().await;

    let (_tok, user, _) = db.sign_in("proxy_tester", "pass123").await.unwrap();
    let token = db.generate_token(&user.id, &user.username).unwrap();

    // 1. Loopback blocked
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/browser/proxy?token={}&url=http://127.0.0.1:8080/secret", token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 2. Cloud metadata service blocked
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/browser/proxy?token={}&url=http://169.254.169.254/latest/meta-data", token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 3. Localhost hostname blocked
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/browser/proxy?token={}&url=http://localhost:3000", token))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[test]
fn test_csp_and_frame_options_rewriting() {
    // 1. Test CSP relaxation (frame-ancestors 'none' replaced by frame-ancestors *)
    let strict_csp = "default-src 'self'; frame-ancestors 'none'; object-src 'none'";
    let relaxed = relax_csp_frame_ancestors(strict_csp);
    assert!(!relaxed.contains("frame-ancestors 'none'"));
    assert!(relaxed.contains("frame-ancestors *"));

    let sameorigin_csp = "default-src 'self'; frame-ancestors 'self' https://trusted.com";
    let relaxed_sameorigin = relax_csp_frame_ancestors(sameorigin_csp);
    assert!(!relaxed_sameorigin.contains("frame-ancestors 'self'"));
    assert!(relaxed_sameorigin.contains("frame-ancestors *"));

    // 2. Test Set-Cookie rewriting for cross-origin partitioned iframe
    let strict_cookie = "id=sess_999; Path=/app; HttpOnly; SameSite=Strict";
    let rewritten_cookie = rewrite_set_cookie_directive(strict_cookie);
    assert!(rewritten_cookie.contains("id=sess_999"));
    assert!(!rewritten_cookie.contains("SameSite=Strict"));
    assert!(rewritten_cookie.contains("SameSite=None"));
    assert!(rewritten_cookie.contains("Secure"));
    assert!(rewritten_cookie.contains("Partitioned"));

    // 3. Test sanitize_and_rewrite_headers strips X-Frame-Options, CORP, COOP
    let mut upstream_headers = reqwest::header::HeaderMap::new();
    upstream_headers.insert("x-frame-options", reqwest::header::HeaderValue::from_static("DENY"));
    upstream_headers.insert("cross-origin-resource-policy", reqwest::header::HeaderValue::from_static("same-origin"));
    upstream_headers.insert("cross-origin-opener-policy", reqwest::header::HeaderValue::from_static("same-origin"));
    upstream_headers.insert("content-security-policy", reqwest::header::HeaderValue::from_static("frame-ancestors 'none'"));
    upstream_headers.insert("set-cookie", reqwest::header::HeaderValue::from_static("auth=secret; SameSite=Lax"));
    upstream_headers.insert("content-type", reqwest::header::HeaderValue::from_static("text/html; charset=utf-8"));

    let cookie_jar = Arc::new(DashMap::new());
    let out = sanitize_and_rewrite_headers(&upstream_headers, "u1", "example.com", &cookie_jar);

    assert!(!out.contains_key("x-frame-options"), "X-Frame-Options must be stripped");
    assert!(!out.contains_key("cross-origin-resource-policy"), "CORP must be stripped");
    assert!(!out.contains_key("cross-origin-opener-policy"), "COOP must be stripped");
    assert_eq!(out.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), "*");

    let csp_out = out.get(header::CONTENT_SECURITY_POLICY).unwrap().to_str().unwrap();
    assert!(csp_out.contains("frame-ancestors *"));

    // Check cookie jar stored the cookie for the user
    let stored = cookie_jar.get(&("u1".to_string(), "example.com".to_string())).unwrap();
    assert!(stored.contains(&"auth=secret".to_string()));
}

#[test]
fn test_html_and_link_rewriting() {
    let html = r#"<!DOCTYPE html>
<html>
<head>
  <title>Sample Portal</title>
</head>
<body>
  <a href="/login">Log In</a>
  <a href="https://external.org">External</a>
  <form action="/search" method="GET">
    <input type="text" name="q">
  </form>
</body>
</html>"#;

    let target_url = Url::parse("https://news.ycombinator.com/news").unwrap();
    let token = "user_tok_777";
    let rewritten = rewrite_html_content(html, &target_url, token);

    // 1. Base href injected into <head>
    assert!(rewritten.contains(r#"<base href="https://news.ycombinator.com/news">"#));

    // 2. Navigation proxy script injected
    assert!(rewritten.contains(r#"var proxyBase = "/api/browser/proxy";"#));
    assert!(rewritten.contains(r#"var t = "user_tok_777";"#));

    // 3. Root-relative links and forms rewritten to pass through proxy
    assert!(rewritten.contains("/api/browser/proxy?token=user_tok_777&url=https%3A%2F%2Fnews.ycombinator.com/login"));
    assert!(rewritten.contains("/api/browser/proxy?token=user_tok_777&url=https%3A%2F%2Fnews.ycombinator.com/search"));
}
