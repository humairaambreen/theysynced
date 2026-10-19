# SECURITY NOTES & CREDENTIAL ROTATION AUDIT

This document details the security vulnerabilities, hardcoded fallback secrets, and potentially exposed tokens identified during the codebase audit of **TheySynced**, along with exact remediation and key rotation procedures.

---

## 1. Summary of Identified Vulnerabilities and Potentially Exposed Secrets

### 1.1 In-Process PTY Remote Code Execution (`/ws/terminal`)
- **Severity**: Critical (CVSS 10.0)
- **Exposure**: The `/ws/terminal` WebSocket handler accepted a raw query parameter `username`, verified no authentication tokens, and spawned an unconstrained interactive shell (`/bin/bash` or `sh`) directly on the host server process.
- **Impact**: Any remote attacker could execute arbitrary shell commands with the full privileges and environment variables of the running server process, exposing `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`, and `ORG_ENCRYPTION_SECRET`.
- **Status**: **Permanently disabled** in Phase 0 (returns HTTP 503). Replaced in Phase 4 with isolated execution.

### 1.2 Open SSRF & Header Manipulation Proxy (`/api/browser/proxy`)
- **Severity**: High (CVSS 8.6)
- **Exposure**: Both `src/lib.rs` and `worker/index.js` exposed `/api/browser/proxy` without session authentication or IP blocklists.
- **Impact**: Attackers could pivot through the server to access internal networks, AWS/GCP/Azure cloud metadata services (`http://169.254.169.254`), container interfaces, and loopback services (`127.0.0.1`).
- **Status**: **Hardened** in Phase 0 with strict JWT session verification, pre-connect and post-connect IP validation blocking private/link-local/loopback/cloud-metadata addresses, DNS-rebinding protection, redirect limits, and 10MB response limits. Worker duplicate proxy removed.

### 1.3 Hardcoded Master Encryption Secret Fallback (`ORG_ENCRYPTION_SECRET`)
- **Severity**: Critical (CVSS 9.8)
- **Location**: `src/crypto.rs` (line 16) and `worker/index.js` (line 14)
- **Value**: `"theysynced_enterprise_master_aes256_org_secret_2026_super_secure"`
- **Impact**: Any deployment running without an explicitly provided `ORG_ENCRYPTION_SECRET` derived organization AES-256 keys from this publicly visible static string. Anyone with DB access could decrypt all organization data, documents, chats, and sheets.

### 1.4 Hardcoded JWT Signing Secret Fallback (`JWT_SECRET`)
- **Severity**: Critical (CVSS 9.8)
- **Location**: `src/database.rs`
- **Value**: `"theysynced_secret_key_change_in_production"`
- **Impact**: Allowed attackers to forge valid HS256 JWT tokens with arbitrary `user_id` and `company_id` claims, bypassing all access controls.

### 1.5 Cloudflare Tunnel URL Committed in Source
- **Severity**: Medium
- **Location**: `wrangler.toml` (line 39) and `src_frontend/components/SharedTerminalView.tsx` (line 19)
- **Value**: `https://entire-fleece-spelling-reseller.trycloudflare.com`
- **Impact**: Exposed ephemeral Cloudflare Tunnel endpoints and routed unauthenticated traffic to private development/staging instances.
- **Status**: Removed. Extracted to `BACKEND_URL` and `NEXT_PUBLIC_TUNNEL_URL`.

### 1.6 Cloudflare Account and Resource Identifiers in `wrangler.toml`
- **Severity**: Low / Info
- **Location**: `wrangler.toml`
- **Values**:
  - `account_id`
  - `database_id` (D1: `theysynced-db`)
  - `id` (KV Namespace: `theysynced_media`)
- **Impact**: Resource IDs allow targeted reconnaissance if Cloudflare API tokens or credentials are leaked.

### 1.7 Static Password Hashing Salt in Edge Worker
- **Severity**: Medium
- **Location**: `worker/index.js` (line 113)
- **Value**: `'theysynced_salt_2026'`
- **Status**: Replaced by central Rust backend using Argon2id/salted hashes. Worker duplicate auth logic eradicated.

---

## 2. Step-by-Step Credential Rotation Playbook

Execute the following steps immediately across all staging and production environments. **Do NOT reuse any existing secrets.**

### Step 1: Rotate Turso / libSQL Database Tokens
Because host environment variables were exposed via the former `/ws/terminal` PTY vulnerability, assume the Turso database token is compromised.

1. Generate a new database token via the Turso CLI:
   ```bash
   turso db tokens create theysynced
   ```
2. Invalidate all previous database tokens:
   ```bash
   turso db tokens invalidate theysynced
   ```
3. Update your server environment / deployment configuration:
   ```bash
   TURSO_DATABASE_URL=libsql://theysynced-<your-org>.turso.io
   TURSO_AUTH_TOKEN=<newly-generated-turso-token>
   ```
4. Verify connectivity:
   ```bash
   cargo test --test auth_tests
   ```

### Step 2: Rotate Master Organization Encryption Key (`ORG_ENCRYPTION_SECRET`)
All AES-256-GCM data at rest encrypted with the default fallback key must be re-keyed.

1. Generate a cryptographically secure 256-bit key:
   ```bash
   openssl rand -base64 32
   ```
2. Store the key in your secure secret manager (e.g. AWS Secrets Manager, Doppler, Cloudflare Secrets, or `.env` file with `chmod 600`):
   ```bash
   ORG_ENCRYPTION_SECRET="<new-base64-key>"
   ```
3. For existing databases encrypted with the old secret:
   - Run a migration script that reads envelopes with the old secret, decrypts the plaintext, and re-encrypts using the new master secret.
   - Once all company envelopes are re-encrypted, permanently remove the old secret from all configurations.

### Step 3: Rotate JWT Signing Secret (`JWT_SECRET`)
Rotating the JWT secret immediately invalidates all active user sessions and revokes forged tokens.

1. Generate a 256-bit or 512-bit random string:
   ```bash
   openssl rand -base64 48
   ```
2. Update the environment variable:
   ```bash
   JWT_SECRET="<new-jwt-secret>"
   ```
3. Restart the Axum backend. All users will be prompted to log in again, receiving freshly signed tokens.

### Step 4: Rotate Cloudflare API Tokens and Cloudflare Tunnel
1. Go to **Cloudflare Dashboard** -> **My Profile** -> **API Tokens**.
2. Roll any API tokens that were used with Wrangler or CI/CD pipelines for this repository.
3. If using Cloudflare Tunnels (cloudflared):
   - In Cloudflare Zero Trust -> Networks -> Tunnels, revoke the existing tunnel credentials and delete the old tunnel:
     ```bash
     cloudflared tunnel delete <old-tunnel-name-or-id>
     cloudflared tunnel create theysynced-prod
     ```
   - Update `NEXT_PUBLIC_TUNNEL_URL` and `BACKEND_URL` in your deployment environment.

### Step 5: Clean Client LocalStorage
Because previous client code stored unverified `ts_jwt_` tokens from the worker:
1. In the browser console, users or test clients should clear stale tokens:
   ```javascript
   localStorage.removeItem('theysynced_token');
   ```
2. The login flow will acquire a legitimate, server-verified HS256 JWT from the Rust backend.

---

## 3. Storage Security & Encryption Model Clarification

- **Encryption at Rest**:
  TheySynced uses per-organization key derivation (`HMAC-SHA256(ORG_ENCRYPTION_SECRET, "theysynced:org:key:<company_id>")`) with AES-256-GCM authenticated encryption. This provides strong encryption at rest against cold storage/database dump compromises.
- **Not End-to-End Encrypted (E2EE)**:
  Encryption is performed on the server side (Rust backend). The server holds the master secret and decrypts content when serving authorized API requests.
- **Access Control & Sealed Nodes**:
  The guarantee that "company administrators cannot read private user DMs" is enforced by the **Rust VFS kernel permission layer** and the `sealed` inode flag, not by client-side zero-knowledge cryptography. Break-glass operations are explicitly audited to `vfs_audit`.
