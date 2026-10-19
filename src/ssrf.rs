use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum SsrfError {
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Unsupported scheme '{0}': only http and https are permitted")]
    UnsupportedScheme(String),
    #[error("Missing host in URL")]
    MissingHost,
    #[error("Host resolves to blocked address: {0}")]
    BlockedAddress(String),
    #[error("DNS resolution failed for host '{0}': {1}")]
    DnsResolutionFailed(String, String),
    #[error("Redirect target blocked by SSRF filter: {0}")]
    RedirectBlocked(String),
    #[error("Too many redirects (max 5)")]
    TooManyRedirects,
    #[error("Response body exceeded maximum allowed size of {0} bytes")]
    ResponseTooLarge(usize),
}

/// Checks whether an IPv4 address belongs to a private, loopback, link-local,
/// multicast, broadcast, cloud-metadata, or reserved network range.
pub fn is_ipv4_blocked(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();

    // 0.0.0.0/8 (Current network / default route)
    if octets[0] == 0 {
        return true;
    }

    // 10.0.0.0/8 (Private-Use RFC 1918)
    if octets[0] == 10 {
        return true;
    }

    // 100.64.0.0/10 (Shared Address Space / CGNAT RFC 6598)
    if octets[0] == 100 && (octets[1] >= 64 && octets[1] <= 127) {
        return true;
    }

    // 127.0.0.0/8 (Loopback)
    if ip.is_loopback() || octets[0] == 127 {
        return true;
    }

    // 169.254.0.0/16 (Link-Local RFC 3927, including AWS/GCP/Azure 169.254.169.254 metadata)
    if ip.is_link_local() || (octets[0] == 169 && octets[1] == 254) {
        return true;
    }

    // 172.16.0.0/12 (Private-Use RFC 1918)
    if octets[0] == 172 && (octets[1] >= 16 && octets[1] <= 31) {
        return true;
    }

    // 192.0.0.0/24 (IETF Protocol Assignments RFC 6890)
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 0 {
        return true;
    }

    // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 2 {
        return true;
    }

    // 192.168.0.0/16 (Private-Use RFC 1918)
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }

    // 198.18.0.0/15 (Benchmarking RFC 2544)
    if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
        return true;
    }

    // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
    if octets[0] == 198 && octets[1] == 51 && octets[2] == 100 {
        return true;
    }

    // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
    if octets[0] == 203 && octets[1] == 0 && octets[2] == 113 {
        return true;
    }

    // 224.0.0.0/4 (Multicast RFC 5771)
    if ip.is_multicast() || octets[0] >= 224 && octets[0] <= 239 {
        return true;
    }

    // 240.0.0.0/4 (Reserved RFC 1112) & 255.255.255.255 (Broadcast)
    if ip.is_broadcast() || octets[0] >= 240 {
        return true;
    }

    false
}

/// Checks whether an IPv6 address belongs to a loopback, unique-local, link-local,
/// multicast, IPv4-mapped, or cloud-metadata address.
pub fn is_ipv6_blocked(ip: Ipv6Addr) -> bool {
    // ::1 (Loopback)
    if ip.is_loopback() {
        return true;
    }

    // :: (Unspecified)
    if ip.is_unspecified() {
        return true;
    }

    // ff00::/8 (Multicast)
    if ip.is_multicast() {
        return true;
    }

    let segments = ip.segments();

    // fc00::/7 (Unique Local Address RFC 4193 - private)
    if (segments[0] & 0xfe00) == 0xfc00 {
        return true;
    }

    // fe80::/10 (Link-Local Unicast RFC 4291)
    if (segments[0] & 0xffc0) == 0xfe80 {
        return true;
    }

    // 2001:db8::/32 (Documentation)
    if segments[0] == 0x2001 && segments[1] == 0x0db8 {
        return true;
    }

    // 100::/64 (Discard-Only RFC 6666)
    if segments[0] == 0x0100 && segments[1] == 0 && segments[2] == 0 && segments[3] == 0 {
        return true;
    }

    // Check IPv4-mapped (::ffff:0:0/96 or ::ffff:a.b.c.d)
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_ipv4_blocked(v4);
    }

    // IPv4-compatible (deprecated ::a.b.c.d)
    if segments[0] == 0 && segments[1] == 0 && segments[2] == 0 && segments[3] == 0 && segments[4] == 0 && segments[5] == 0 {
        let v4 = Ipv4Addr::new(
            (segments[6] >> 8) as u8,
            segments[6] as u8,
            (segments[7] >> 8) as u8,
            segments[7] as u8,
        );
        return is_ipv4_blocked(v4);
    }

    // 6to4 (2002::/16) - embeds IPv4 in segments 1 & 2
    if segments[0] == 0x2002 {
        let v4 = Ipv4Addr::new(
            (segments[1] >> 8) as u8,
            segments[1] as u8,
            (segments[2] >> 8) as u8,
            segments[2] as u8,
        );
        return is_ipv4_blocked(v4);
    }

    false
}

/// Checks whether any IP address (v4 or v6) is blocked for SSRF prevention.
pub fn is_ip_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_ipv4_blocked(v4),
        IpAddr::V6(v6) => is_ipv6_blocked(v6),
    }
}

/// Inspects a hostname string to block internal names directly.
pub fn is_host_blocked_by_name(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") || lower.ends_with(".internal") {
        return true;
    }
    if lower == "metadata.google.internal" || lower == "metadata" || lower == "instance-data" {
        return true;
    }
    false
}

/// Resolves a URL's host, verifies that the scheme is http or https,
/// and verifies that every resolved IP address is public and non-blocked.
/// Returns the parsed Url and a safe SocketAddr for DNS-pinning.
pub async fn resolve_and_verify_url(url_str: &str) -> Result<(reqwest::Url, SocketAddr), SsrfError> {
    let url = reqwest::Url::parse(url_str).map_err(|e| SsrfError::InvalidUrl(e.to_string()))?;

    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(SsrfError::UnsupportedScheme(scheme.to_string()));
    }

    let host = url.host_str().ok_or(SsrfError::MissingHost)?;
    let port = url.port_or_known_default().unwrap_or(80);

    if is_host_blocked_by_name(host) {
        return Err(SsrfError::BlockedAddress(format!("Blocked hostname: {}", host)));
    }

    // If host is an IP literal
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_ip_blocked(ip) {
            return Err(SsrfError::BlockedAddress(format!("IP literal is blocked: {}", ip)));
        }
        return Ok((url, SocketAddr::new(ip, port)));
    }

    // Resolve domain using tokio lookup_host
    let addr_str = format!("{}:{}", host, port);
    let resolved_addrs: Vec<SocketAddr> = tokio::net::lookup_host(&addr_str)
        .await
        .map_err(|e| SsrfError::DnsResolutionFailed(host.to_string(), e.to_string()))?
        .collect();

    if resolved_addrs.is_empty() {
        return Err(SsrfError::DnsResolutionFailed(host.to_string(), "No DNS records found".to_string()));
    }

    // Check EVERY resolved IP: if any is blocked, fail closed
    for addr in &resolved_addrs {
        if is_ip_blocked(addr.ip()) {
            return Err(SsrfError::BlockedAddress(format!("{}: resolves to blocked IP {}", host, addr.ip())));
        }
    }

    let safe_addr = resolved_addrs[0];
    Ok((url, safe_addr))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_ipv4_blocklist() {
        // Loopback
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("127.0.0.1").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("127.100.200.1").unwrap()));
        // Private
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("10.0.0.1").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("172.16.0.1").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("172.31.255.255").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("192.168.1.1").unwrap()));
        // Link-local & Cloud metadata
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("169.254.169.254").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("169.254.1.1").unwrap()));
        // Default / Broadcast / CGNAT
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("0.0.0.0").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("255.255.255.255").unwrap()));
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("100.64.0.1").unwrap()));
        // Multicast
        assert!(is_ipv4_blocked(Ipv4Addr::from_str("224.0.0.1").unwrap()));

        // Public IPs - MUST NOT be blocked
        assert!(!is_ipv4_blocked(Ipv4Addr::from_str("8.8.8.8").unwrap()));
        assert!(!is_ipv4_blocked(Ipv4Addr::from_str("1.1.1.1").unwrap()));
        assert!(!is_ipv4_blocked(Ipv4Addr::from_str("93.184.216.34").unwrap()));
    }

    #[test]
    fn test_ipv6_blocklist() {
        // Loopback
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("::1").unwrap()));
        // Unspecified
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("::").unwrap()));
        // Unique Local
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("fc00::1").unwrap()));
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("fd12:3456:789a::1").unwrap()));
        // Link Local
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("fe80::1").unwrap()));
        // Multicast
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("ff02::1").unwrap()));
        // IPv4-mapped IPv6
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("::ffff:127.0.0.1").unwrap()));
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("::ffff:169.254.169.254").unwrap()));
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("::ffff:10.0.0.1").unwrap()));
        assert!(is_ipv6_blocked(Ipv6Addr::from_str("::ffff:192.168.1.1").unwrap()));

        // IPv4-mapped public IP - MUST NOT be blocked
        assert!(!is_ipv6_blocked(Ipv6Addr::from_str("::ffff:8.8.8.8").unwrap()));
        // Public IPv6 - MUST NOT be blocked
        assert!(!is_ipv6_blocked(Ipv6Addr::from_str("2607:f8b0:4005:805::200e").unwrap()));
    }

    #[test]
    fn test_host_blocked_by_name() {
        assert!(is_host_blocked_by_name("localhost"));
        assert!(is_host_blocked_by_name("app.localhost"));
        assert!(is_host_blocked_by_name("router.local"));
        assert!(is_host_blocked_by_name("db.internal"));
        assert!(is_host_blocked_by_name("metadata.google.internal"));
        assert!(is_host_blocked_by_name("instance-data"));

        assert!(!is_host_blocked_by_name("google.com"));
        assert!(!is_host_blocked_by_name("github.com"));
    }

    #[tokio::test]
    async fn test_url_validation_schemes() {
        assert!(resolve_and_verify_url("file:///etc/passwd").await.is_err());
        assert!(resolve_and_verify_url("ftp://1.1.1.1/file").await.is_err());
        assert!(resolve_and_verify_url("gopher://1.1.1.1").await.is_err());
    }

    #[tokio::test]
    async fn test_url_validation_ip_literals() {
        assert!(resolve_and_verify_url("http://127.0.0.1:8080").await.is_err());
        assert!(resolve_and_verify_url("http://169.254.169.254/latest/meta-data/").await.is_err());
        assert!(resolve_and_verify_url("http://[::1]:80").await.is_err());
        assert!(resolve_and_verify_url("http://[::ffff:127.0.0.1]:80").await.is_err());

        let res = resolve_and_verify_url("https://1.1.1.1/").await;
        assert!(res.is_ok());
    }
}
