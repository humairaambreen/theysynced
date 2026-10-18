use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce, Key
};
use anyhow::{anyhow, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ring::hmac;

/// Envelope prefix for AES-256-GCM encrypted strings
pub const ENCRYPTION_PREFIX: &str = "enc:v1:";

/// Get the master encryption secret from environment or fallback to default
fn get_master_secret() -> Vec<u8> {
    std::env::var("ORG_ENCRYPTION_SECRET")
        .unwrap_or_else(|_| "theysynced_enterprise_master_aes256_org_secret_2026_super_secure".to_string())
        .into_bytes()
}

/// Deterministically derives a unique 256-bit (32-byte) AES key per organization
/// using HMAC-SHA256 over the master secret and organization ID.
pub fn derive_org_key(company_id: &str) -> [u8; 32] {
    let master = get_master_secret();
    let s_key = hmac::Key::new(hmac::HMAC_SHA256, &master);
    let tag = hmac::sign(&s_key, format!("theysynced:org:key:{}", company_id).as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(tag.as_ref());
    key
}

/// Encrypts plaintext bytes for a given organization using AES-256-GCM.
/// Binds the ciphertext to `company_id` via AAD (Associated Authenticated Data).
/// Returns an envelope string: `enc:v1:<company_id>:<base64(12-byte nonce || ciphertext + tag)>`.
pub fn encrypt_for_org(company_id: &str, plaintext: &[u8]) -> Result<String> {
    let key_bytes = derive_org_key(company_id);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let payload = Payload {
        msg: plaintext,
        aad: company_id.as_bytes(),
    };

    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|e| anyhow!("AES-256-GCM encryption failed: {}", e))?;

    // Combine nonce (12 bytes) + ciphertext (includes 16-byte Poly1305/GHASH tag)
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    let encoded = BASE64.encode(&combined);
    Ok(format!("{}{}:{}", ENCRYPTION_PREFIX, company_id, encoded))
}

/// Decrypts an encrypted envelope string.
/// Extracts `company_id` from the envelope (or verifies against `expected_company_id` if provided).
/// Verifies the AAD matches `company_id`.
/// If the string does not have the `enc:v1:` prefix, it is returned as raw bytes (migration fallback).
pub fn decrypt_for_org(expected_company_id: Option<&str>, envelope: &str) -> Result<(String, Vec<u8>)> {
    if !envelope.starts_with(ENCRYPTION_PREFIX) {
        // Unencrypted legacy fallback
        let cid = expected_company_id.unwrap_or("").to_string();
        return Ok((cid, envelope.as_bytes().to_vec()));
    }

    let remainder = &envelope[ENCRYPTION_PREFIX.len()..];
    let (org_id, b64_payload) = remainder
        .split_once(':')
        .ok_or_else(|| anyhow!("Malformed encryption envelope: missing org_id delimiter"))?;

    if let Some(expected) = expected_company_id {
        if expected != org_id {
            return Err(anyhow!("Organization mismatch: envelope is for org '{}', expected '{}'", org_id, expected));
        }
    }

    let combined = BASE64
        .decode(b64_payload)
        .map_err(|e| anyhow!("Base64 decoding failed for encrypted payload: {}", e))?;

    if combined.len() < 12 + 16 {
        return Err(anyhow!("Encrypted payload is corrupted or truncated"));
    }

    let nonce_bytes = &combined[..12];
    let ciphertext = &combined[12..];

    let key_bytes = derive_org_key(org_id);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(nonce_bytes);

    let payload = Payload {
        msg: ciphertext,
        aad: org_id.as_bytes(),
    };

    let plaintext = cipher
        .decrypt(nonce, payload)
        .map_err(|e| anyhow!("AES-256-GCM authentication/decryption failed for org {}: {}", org_id, e))?;

    Ok((org_id.to_string(), plaintext))
}

/// Helper that directly returns the decrypted bytes
pub fn decrypt_payload(expected_company_id: Option<&str>, envelope: &str) -> Result<Vec<u8>> {
    decrypt_for_org(expected_company_id, envelope).map(|(_, bytes)| bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let org_id = "comp_test_12345";
        let message = "Confidential chat message from TheySynced workspace";

        let encrypted = encrypt_for_org(org_id, message.as_bytes()).expect("Encryption failed");
        assert!(encrypted.starts_with(&format!("{}{}:", ENCRYPTION_PREFIX, org_id)));
        assert!(!encrypted.contains("Confidential"));

        let (decrypted_org, decrypted_bytes) = decrypt_for_org(Some(org_id), &encrypted).expect("Decryption failed");
        assert_eq!(decrypted_org, org_id);
        assert_eq!(String::from_utf8(decrypted_bytes).unwrap(), message);
    }

    #[test]
    fn test_cross_org_tampering_fails() {
        let org_a = "comp_org_a";
        let org_b = "comp_org_b";
        let secret = "Top secret data for Org A";

        let encrypted_a = encrypt_for_org(org_a, secret.as_bytes()).unwrap();

        // Attempting to decrypt Org A data expecting Org B MUST fail
        let decrypt_result = decrypt_for_org(Some(org_b), &encrypted_a);
        assert!(decrypt_result.is_err());
    }

    #[test]
    fn test_unencrypted_legacy_passthrough() {
        let raw_json = r#"{"hello":"world"}"#;
        let (_, result) = decrypt_for_org(Some("any_org"), raw_json).unwrap();
        assert_eq!(String::from_utf8(result).unwrap(), raw_json);
    }
}
