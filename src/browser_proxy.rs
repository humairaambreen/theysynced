use std::sync::Arc;
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    body::Body,
};
use dashmap::DashMap;
use serde::Deserialize;
use url::Url;

use crate::{extract_token, ssrf, AppState};

pub type CookieJar = Arc<DashMap<(String, String), Vec<String>>>;

#[derive(Deserialize)]
pub struct BrowserProxyQuery {
    pub url: Option<String>,
    pub token: Option<String>,
}

/// Strip X-Frame-Options, relax CSP frame-ancestors, strip CORP/COOP, and rewrite Set-Cookie
pub fn sanitize_and_rewrite_headers(
    headers: &reqwest::header::HeaderMap,
    user_id: &str,
    domain: &str,
    cookie_jar: &CookieJar,
) -> HeaderMap {
    let mut out = HeaderMap::new();

    // 1. Always allow cross-origin embedding and access
    out.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    out.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));

    // 2. Iterate through upstream response headers
    for (name, val) in headers.iter() {
        let name_str = name.as_str().to_lowercase();

        // Strip X-Frame-Options, CORP, COOP, COEP
        if name_str == "x-frame-options"
            || name_str == "cross-origin-resource-policy"
            || name_str == "cross-origin-opener-policy"
            || name_str == "cross-origin-embedder-policy"
        {
            continue;
        }

        // Relax Content-Security-Policy to allow framing
        if name_str == "content-security-policy" {
            if let Ok(val_str) = val.to_str() {
                let relaxed_csp = relax_csp_frame_ancestors(val_str);
                if let Ok(header_val) = HeaderValue::from_str(&relaxed_csp) {
                    out.insert(header::CONTENT_SECURITY_POLICY, header_val);
                }
            }
            continue;
        }

        // Handle and rewrite Set-Cookie
        if name_str == "set-cookie" {
            if let Ok(val_str) = val.to_str() {
                // Store cookie in user's cookie jar
                let cookie_pair = val_str.split(';').next().unwrap_or("").trim().to_string();
                if !cookie_pair.is_empty() {
                    let mut entry = cookie_jar.entry((user_id.to_string(), domain.to_string())).or_default();
                    if let Some(cookie_name) = cookie_pair.split('=').next() {
                        entry.retain(|c| !c.starts_with(&format!("{}=", cookie_name)));
                    }
                    entry.push(cookie_pair.clone());
                }

                // Rewrite Set-Cookie for partitioned iframe compatibility
                let rewritten_cookie = rewrite_set_cookie_directive(val_str);
                if let Ok(header_val) = HeaderValue::from_str(&rewritten_cookie) {
                    out.append(header::SET_COOKIE, header_val);
                }
            }
            continue;
        }

        // Forward other standard content headers
        if name_str == "content-type" || name_str == "content-encoding" || name_str == "last-modified" || name_str == "etag" {
            if let Ok(hname) = HeaderName::from_bytes(name.as_str().as_bytes()) {
                out.insert(hname, val.clone());
            }
        }
    }

    out
}

/// Removes `frame-ancestors` from CSP and adds `frame-ancestors *` so the parent page can embed it
pub fn relax_csp_frame_ancestors(csp: &str) -> String {
    let mut parts: Vec<String> = csp
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.to_lowercase().starts_with("frame-ancestors"))
        .collect();

    parts.push("frame-ancestors *".to_string());
    parts.join("; ")
}

/// Rewrites Set-Cookie directives to ensure cross-site iframe compatibility
pub fn rewrite_set_cookie_directive(cookie: &str) -> String {
    let parts: Vec<&str> = cookie.split(';').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return cookie.to_string();
    }

    let cookie_val = parts[0];
    let mut directives = Vec::new();
    directives.push(cookie_val.to_string());

    let mut has_path = false;
    for part in &parts[1..] {
        let lower = part.to_lowercase();
        if lower.starts_with("samesite") || lower == "secure" || lower == "partitioned" {
            continue;
        }
        if lower.starts_with("path") {
            has_path = true;
        }
        directives.push(part.to_string());
    }

    if !has_path {
        directives.push("Path=/".to_string());
    }
    directives.push("SameSite=None".to_string());
    directives.push("Secure".to_string());
    directives.push("Partitioned".to_string());

    directives.join("; ")
}

/// Rewrites HTML content to keep links, forms, and assets routed through the proxy
pub fn rewrite_html_content(html: &str, target_url: &Url, token: &str) -> String {
    let scheme = target_url.scheme();
    let host = target_url.host_str().unwrap_or("");
    let base_origin = format!("{}://{}", scheme, host);
    let path = target_url.path();
    let base_href = format!("{}{}", base_origin, path);

    let script_injection = format!(
        r#"<script>
(function() {{
  var t = "{}";
  var proxyBase = "/api/browser/proxy";
  document.addEventListener('click', function(e) {{
    var a = e.target.closest('a');
    if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {{
      e.preventDefault();
      var proxied = proxyBase + '?url=' + encodeURIComponent(a.href) + (t ? '&token=' + encodeURIComponent(t) : '');
      window.location.href = proxied;
    }}
  }}, true);
  document.addEventListener('submit', function(e) {{
    var form = e.target;
    if (form && form.action) {{
      var actionUrl = new URL(form.action, document.baseURI).href;
      form.action = proxyBase;
      var u = form.querySelector('input[name="url"]');
      if (!u) {{
        u = document.createElement('input');
        u.type = 'hidden';
        u.name = 'url';
        form.appendChild(u);
      }}
      u.value = actionUrl;
      if (t) {{
        var tk = form.querySelector('input[name="token"]');
        if (!tk) {{
          tk = document.createElement('input');
          tk.type = 'hidden';
          tk.name = 'token';
          form.appendChild(tk);
        }}
        tk.value = t;
      }}
    }}
  }}, true);
}})();
</script>"#,
        token
    );

    let base_tag = format!("<base href=\"{}\">\n{}", base_href, script_injection);

    let mut result = if let Some(pos) = html.find("<head>") {
        let mut s = html.to_string();
        s.insert_str(pos + 6, &format!("\n{}", base_tag));
        s
    } else if let Some(pos) = html.find("<HEAD>") {
        let mut s = html.to_string();
        s.insert_str(pos + 6, &format!("\n{}", base_tag));
        s
    } else {
        format!("{}\n{}", base_tag, html)
    };

    // Rewrite root-relative links in href="..." and action="..." to stay within proxy
    let proxy_prefix = format!("/api/browser/proxy?token={}&url={}", urlencoding::encode(token), urlencoding::encode(&base_origin));
    result = result.replace("href=\"/", &format!("href=\"{}/", proxy_prefix));
    result = result.replace("action=\"/", &format!("action=\"{}/", proxy_prefix));

    result
}

/// Rewrites CSS content to resolve relative URLs
pub fn rewrite_css_content(css: &str, target_url: &Url) -> String {
    let scheme = target_url.scheme();
    let host = target_url.host_str().unwrap_or("");
    let base_origin = format!("{}://{}", scheme, host);

    // Rewrite root-relative url(/...) in CSS to full origin URLs
    css.replace("url(/", &format!("url({}/", base_origin))
       .replace("url(\"/", &format!("url(\"{}/", base_origin))
       .replace("url('/", &format!("url('{}/", base_origin))
}

pub async fn browser_proxy_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BrowserProxyQuery>,
) -> impl IntoResponse {
    let token = match extract_token(&headers, query.token.as_deref()) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::CONTENT_TYPE, "text/plain".to_string())],
                "Unauthorized: valid session token required".to_string(),
            ).into_response();
        }
    };

    let claims = match state.db.verify_token(&token).await {
        Ok(c) => c,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                [(header::CONTENT_TYPE, "text/plain".to_string())],
                "Unauthorized: invalid session token".to_string(),
            ).into_response();
        }
    };

    let target_url_str = match query.url {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "text/plain".to_string())],
                "Missing url parameter".to_string(),
            ).into_response();
        }
    };

    let full_url = if !target_url_str.starts_with("http://") && !target_url_str.starts_with("https://") {
        format!("https://{}", target_url_str)
    } else {
        target_url_str
    };

    // SSRF verification and DNS resolution pinning
    let (parsed_url, safe_addr) = match ssrf::resolve_and_verify_url(&full_url).await {
        Ok(res) => res,
        Err(e) => {
            return (
                StatusCode::FORBIDDEN,
                [(header::CONTENT_TYPE, "text/plain".to_string())],
                format!("SSRF Blocked: {}", e),
            ).into_response();
        }
    };

    let host_str = match parsed_url.host_str() {
        Some(h) => h.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "text/plain".to_string())],
                "Missing host in URL".to_string(),
            ).into_response();
        }
    };

    // Custom redirect policy validating every hop against SSRF rules
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error(ssrf::SsrfError::TooManyRedirects);
        }
        let scheme = attempt.url().scheme().to_string();
        if scheme != "http" && scheme != "https" {
            return attempt.error(ssrf::SsrfError::UnsupportedScheme(scheme));
        }
        if let Some(h) = attempt.url().host_str().map(|s| s.to_string()) {
            if ssrf::is_host_blocked_by_name(&h) {
                return attempt.error(ssrf::SsrfError::BlockedAddress(format!("Blocked redirect host: {}", h)));
            }
            if let Ok(ip) = h.parse::<std::net::IpAddr>() {
                if ssrf::is_ip_blocked(ip) {
                    return attempt.error(ssrf::SsrfError::BlockedAddress(format!("Blocked redirect IP: {}", ip)));
                }
            }
        }
        attempt.follow()
    });

    let client_builder = reqwest::Client::builder()
        .resolve(&host_str, safe_addr)
        .redirect(redirect_policy)
        .timeout(std::time::Duration::from_secs(10));

    let client = match client_builder.build() {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/plain".to_string())],
                format!("Client init error: {}", e),
            ).into_response();
        }
    };

    let mut req = client.get(parsed_url.clone());

    // Forward client headers or use modern defaults
    if let Some(ua) = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()) {
        req = req.header(reqwest::header::USER_AGENT, ua);
    } else {
        req = req.header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        );
    }

    if let Some(accept) = headers.get(header::ACCEPT).and_then(|v| v.to_str().ok()) {
        req = req.header(reqwest::header::ACCEPT, accept);
    }

    if let Some(accept_lang) = headers.get(header::ACCEPT_LANGUAGE).and_then(|v| v.to_str().ok()) {
        req = req.header(reqwest::header::ACCEPT_LANGUAGE, accept_lang);
    }

    // Attach stored cookies from per-user session cookie jar
    if let Some(cookies) = state.cookie_jar.get(&(claims.user_id.clone(), host_str.clone())) {
        if !cookies.is_empty() {
            let cookie_str = cookies.join("; ");
            req = req.header(reqwest::header::COOKIE, cookie_str);
        }
    }

    match req.send().await {
        Ok(mut resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("text/html")
                .to_string();

            // Cap response size: 10MB
            const MAX_RESPONSE_SIZE: usize = 10 * 1024 * 1024;
            if let Some(content_len) = resp.content_length() {
                if content_len as usize > MAX_RESPONSE_SIZE {
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        [(header::CONTENT_TYPE, "text/plain".to_string())],
                        "Response body too large (exceeds 10MB limit)".to_string(),
                    ).into_response();
                }
            }

            let mut body_bytes = Vec::new();
            loop {
                match resp.chunk().await {
                    Ok(Some(chunk)) => {
                        if body_bytes.len() + chunk.len() > MAX_RESPONSE_SIZE {
                            return (
                                StatusCode::PAYLOAD_TOO_LARGE,
                                [(header::CONTENT_TYPE, "text/plain".to_string())],
                                "Response body too large (exceeds 10MB limit)".to_string(),
                            ).into_response();
                        }
                        body_bytes.extend_from_slice(&chunk);
                    }
                    Ok(None) => break,
                    Err(e) => {
                        return (
                            StatusCode::BAD_GATEWAY,
                            [(header::CONTENT_TYPE, "text/plain".to_string())],
                            format!("Stream read error: {}", e),
                        ).into_response();
                    }
                }
            }

            // Rewrite headers (strip X-Frame-Options, relax CSP, rewrite cookies)
            let out_headers = sanitize_and_rewrite_headers(resp.headers(), &claims.user_id, &host_str, &state.cookie_jar);

            let body_data = if content_type.contains("text/html") {
                let html_str = String::from_utf8_lossy(&body_bytes);
                let rewritten = rewrite_html_content(&html_str, &parsed_url, &token);
                rewritten.into_bytes()
            } else if content_type.contains("text/css") {
                let css_str = String::from_utf8_lossy(&body_bytes);
                let rewritten = rewrite_css_content(&css_str, &parsed_url);
                rewritten.into_bytes()
            } else {
                body_bytes
            };

            let mut response = Response::new(Body::from(body_data));
            *response.status_mut() = status;
            *response.headers_mut() = out_headers;
            response.into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            [(header::CONTENT_TYPE, "text/plain".to_string())],
            format!("Proxy upstream error: {}", e),
        ).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relax_csp_frame_ancestors() {
        let original_csp = "default-src 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'";
        let relaxed = relax_csp_frame_ancestors(original_csp);
        assert!(!relaxed.contains("frame-ancestors 'none'"));
        assert!(relaxed.contains("frame-ancestors *"));
    }

    #[test]
    fn test_rewrite_set_cookie_directive() {
        let original_cookie = "session_id=abc123; Path=/; HttpOnly; SameSite=Strict";
        let rewritten = rewrite_set_cookie_directive(original_cookie);
        assert!(rewritten.contains("session_id=abc123"));
        assert!(!rewritten.contains("SameSite=Strict"));
        assert!(rewritten.contains("SameSite=None"));
        assert!(rewritten.contains("Secure"));
        assert!(rewritten.contains("Partitioned"));
    }

    #[test]
    fn test_rewrite_html_content() {
        let original_html = "<html><head><title>Test</title></head><body><a href=\"/docs\">Docs</a></body></html>";
        let url = Url::parse("https://example.com/page").unwrap();
        let token = "test_token_123";
        let rewritten = rewrite_html_content(original_html, &url, token);

        assert!(rewritten.contains("<base href=\"https://example.com/page\">"));
        assert!(rewritten.contains("proxyBase = \"/api/browser/proxy\""));
        assert!(rewritten.contains("test_token_123"));
        assert!(rewritten.contains("/api/browser/proxy?token=test_token_123&url=https%3A%2F%2Fexample.com/docs"));
    }
}
