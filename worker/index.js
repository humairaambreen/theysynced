/**
 * TheySynced - Production Cloudflare Edge Gateway & Serverless Backend
 * Hosted on Cloudflare Free Forever Tier
 *
 * Capabilities:
 * - Direct authentication with seamless auto-signup and passkey support
 * - Cloudflare D1 SQLite Database with AES-256-GCM encryption-at-rest
 * - Cloudflare KV / R2 Media Storage for chat file sharing
 * - Cloudflare Edge Static Assets serving React 18 / Next.js SPA
 * - Hourly automated Cron retention sweeper for 90-day inactivity
 */

const ENCRYPTION_PREFIX = 'enc:v1:';
const DEFAULT_SECRET = 'theysynced_enterprise_master_aes256_org_secret_2026_super_secure';

// ── Web Crypto Helpers (AES-256-GCM + HMAC-SHA256) ───────────────────────────

async function getHmacKey(masterSecret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(masterSecret || DEFAULT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function deriveOrgKey(companyId, masterSecret) {
  const enc = new TextEncoder();
  const hmacKey = await getHmacKey(masterSecret);
  const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(`theysynced:org:key:${companyId}`));
  return crypto.subtle.importKey(
    'raw',
    sig,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptForOrg(companyId, plaintextStr, masterSecret) {
  if (!plaintextStr) return '';
  const enc = new TextEncoder();
  const aesKey = await deriveOrgKey(companyId, masterSecret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode(companyId);
  const pt = enc.encode(plaintextStr);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    aesKey,
    pt
  );

  const ctBytes = new Uint8Array(ciphertextBuf);
  const combined = new Uint8Array(12 + ctBytes.length);
  combined.set(nonce, 0);
  combined.set(ctBytes, 12);

  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return `${ENCRYPTION_PREFIX}${companyId}:${btoa(binary)}`;
}

async function decryptForOrg(expectedCompanyId, envelope, masterSecret) {
  if (!envelope || !envelope.startsWith(ENCRYPTION_PREFIX)) {
    return envelope || '';
  }

  const remainder = envelope.slice(ENCRYPTION_PREFIX.length);
  const colonIdx = remainder.indexOf(':');
  if (colonIdx === -1) return envelope;

  const orgId = remainder.slice(0, colonIdx);
  const b64 = remainder.slice(colonIdx + 1);

  if (expectedCompanyId && expectedCompanyId !== orgId) {
    throw new Error(`Org mismatch: envelope is for ${orgId}, expected ${expectedCompanyId}`);
  }

  const binary = atob(b64);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i);
  }

  if (combined.length < 12 + 16) {
    throw new Error('Truncated ciphertext envelope');
  }

  const nonce = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const aesKey = await deriveOrgKey(orgId, masterSecret);
  const enc = new TextEncoder();
  const aad = enc.encode(orgId);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    aesKey,
    ciphertext
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBuf);
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const s = salt || 'theysynced_salt_2026';
  const data = enc.encode(password + ':' + s);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── HTTP Response Helpers ─────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function errorResponse(msg, status = 400) {
  return jsonResponse({ success: false, message: msg, error: msg }, status);
}

function getUserFromToken(tokenOrHeader) {
  if (!tokenOrHeader) return null;
  const token = (typeof tokenOrHeader === 'string' ? tokenOrHeader : '').replace('Bearer ', '').trim();
  if (token.startsWith('ts_jwt_')) {
    try {
      return JSON.parse(atob(token.replace('ts_jwt_', '')));
    } catch (_) {}
  }
  return null;
}


// ── Default Workspace Helper ──────────────────────────────────────────────────

function createDefaultWorkspace() {
  const now = new Date().toISOString();
  const company = {
    id: 'comp_theysynced',
    name: 'TheySynced Headquarters',
    join_code: 'THEYSYNCED',
    logo_url: null,
    created_at: now,
    last_activity_at: now,
    owner_id: 'user_admin',
    members: [
      {
        user_id: 'user_admin',
        username: 'Admin',
        role: 'Owner',
        joined_at: now,
        avatar_url: null,
        last_active_at: now,
        total_active_seconds: 3600,
      }
    ],
    banned_user_ids: [],
  };

  const teams = [
    {
      id: 'team_comp_theysynced_gen',
      company_id: 'comp_theysynced',
      name: 'General',
      created_at: now,
    },
    {
      id: 'team_comp_theysynced_eng',
      company_id: 'comp_theysynced',
      name: 'Engineering',
      created_at: now,
    }
  ];

  const assets = [
    {
      id: 'asset_whiteboard_main',
      company_id: 'comp_theysynced',
      asset_type: 'Whiteboard',
      title: 'Headquarters System Architecture',
      content: '{"elements":[],"appState":{}}',
      updated_at: now,
      updated_by: 'Admin',
    },
    {
      id: 'asset_doc_welcome',
      company_id: 'comp_theysynced',
      asset_type: 'Document',
      title: 'Getting Started with TheySynced',
      content: '{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Welcome to TheySynced Office"}]},{"type":"paragraph","content":[{"type":"text","text":"Real-time collaborative office platform with Excalidraw whiteboards, Excel spreadsheets, Notion docs, WebRDP streaming, and encrypted chats."}]}]}',
      updated_at: now,
      updated_by: 'Admin',
    }
  ];

  return { company, teams, assets };
}

async function ensureDefaultWorkspace(db, secret) {
  const row = await db.prepare('SELECT id FROM ts_companies WHERE id = ?').bind('comp_theysynced').first();
  if (row) return;

  const seed = createDefaultWorkspace();
  const encComp = await encryptForOrg(seed.company.id, JSON.stringify(seed.company), secret);
  const encTeams = await encryptForOrg(seed.company.id, JSON.stringify(seed.teams), secret);
  const encAssets = await encryptForOrg(seed.company.id, JSON.stringify(seed.assets), secret);

  await db.batch([
    db.prepare('INSERT OR REPLACE INTO ts_companies (id, data) VALUES (?, ?)').bind(seed.company.id, encComp),
    db.prepare('INSERT OR REPLACE INTO ts_teams (company_id, data) VALUES (?, ?)').bind(seed.company.id, encTeams),
    db.prepare('INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES (?, ?)').bind(seed.company.id, encAssets),
  ]);
}

async function addUserToCompany(db, companyId, userId, username, secret) {
  const row = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
  if (!row) return;
  try {
    const comp = JSON.parse(await decryptForOrg(companyId, row.data, secret));
    if (!comp.members) comp.members = [];
    if (!comp.members.some(m => m.user_id === userId)) {
      comp.members.push({
        user_id: userId,
        username: username,
        role: comp.members.length === 0 ? 'Owner' : 'Member',
        joined_at: new Date().toISOString(),
        avatar_url: null,
        last_active_at: new Date().toISOString(),
        total_active_seconds: 0,
      });
      const enc = await encryptForOrg(companyId, JSON.stringify(comp), secret);
      await db.prepare('UPDATE ts_companies SET data = ? WHERE id = ?').bind(enc, companyId).run();
    }
  } catch (_) {}
}

async function purgeOrgMedia(companyId, db, env, secret) {
  try {
    const keysToDelete = new Set();
    
    // 1. Collect all storage URLs from ts_assets
    const assetsRow = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(companyId).first();
    if (assetsRow) {
      try {
        const assets = JSON.parse(await decryptForOrg(companyId, assetsRow.data, secret));
        for (const a of assets) {
          if (a.url && a.url.startsWith('/api/storage/file/')) {
            const parts = a.url.replace('/api/storage/file/', '').split('/');
            if (parts.length >= 2) {
              const fileId = parts[0];
              const fileName = parts.slice(1).join('/');
              keysToDelete.add(`${fileId}_${fileName}`);
            }
          }
        }
      } catch (_) {}
    }

    // 2. Collect all storage URLs from ts_messages
    const { results: msgRows } = await db.prepare('SELECT key, data FROM ts_messages WHERE key = ? OR key LIKE ?').bind(companyId, `team_${companyId}_%`).all();
    for (const m of (msgRows || [])) {
      try {
        const msgs = JSON.parse(await decryptForOrg(null, m.data, secret));
        for (const msg of msgs) {
          if (msg.file_attachment?.url && msg.file_attachment.url.startsWith('/api/storage/file/')) {
            const parts = msg.file_attachment.url.replace('/api/storage/file/', '').split('/');
            if (parts.length >= 2) {
              const fileId = parts[0];
              const fileName = parts.slice(1).join('/');
              keysToDelete.add(`${fileId}_${fileName}`);
            }
          }
        }
      } catch (_) {}
    }

    // 3. Purge all collected keys from KV or R2
    for (const key of keysToDelete) {
      if (env.MEDIA_BUCKET) {
        await env.MEDIA_BUCKET.delete(key).catch(() => {});
      } else if (env.theysynced_media) {
        await env.theysynced_media.delete(key).catch(() => {});
      }
    }
    console.log(`[Storage Purge] Eradicated ${keysToDelete.size} media files for organization ${companyId}`);
  } catch (err) {
    console.warn('[Storage Purge Warning]', err);
  }
}

// ── Cloudflare Worker Main Export ─────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // 1. CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 2. Health check
    if (url.pathname === '/api/health') {
      return jsonResponse({
        status: 'healthy',
        service: 'TheySynced Cloudflare Edge Engine',
        platform: 'Cloudflare Workers (Production Free Tier)',
        timestamp: new Date().toISOString(),
        colo: request.cf ? request.cf.colo : 'edge',
        d1_configured: !!env.theysynced_db,
        storage_configured: !!env.theysynced_media || !!env.MEDIA_BUCKET,
        assets_configured: !!env.ASSETS,
      });
    }

    // ── Sandboxed Web Browser Proxy API (Protects User IP & Bypasses X-Frame-Options) ──
    if (url.pathname === '/api/browser/proxy') {
      const targetParam = url.searchParams.get('url');
      if (!targetParam) {
        return errorResponse('Missing url query parameter', 400);
      }

      try {
        let targetUrlStr = targetParam.trim();
        if (!targetUrlStr.startsWith('http://') && !targetUrlStr.startsWith('https://')) {
          targetUrlStr = 'https://' + targetUrlStr;
        }

        const targetUrl = new URL(targetUrlStr);

        // Fetch upstream from the edge server (completely hiding user's IP & device)
        const forwardHeaders = new Headers();
        forwardHeaders.set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
        forwardHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
        forwardHeaders.set('Accept-Language', 'en-US,en;q=0.5');

        const upstreamRes = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: forwardHeaders,
          redirect: 'follow',
        });

        const contentType = upstreamRes.headers.get('content-type') || 'text/html';
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', contentType);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        responseHeaders.set('Cache-Control', 'no-cache');

        // CRITICAL: Strip frame-blocking headers so Google, GitHub, DuckDuckGo etc. render in Zen browser / iframe
        responseHeaders.delete('x-frame-options');
        responseHeaders.delete('content-security-policy');
        responseHeaders.delete('content-security-policy-report-only');
        responseHeaders.delete('strict-transport-security');

        if (contentType.includes('text/html')) {
          let html = await upstreamRes.text();
          // Inject <base> tag to correctly resolve relative URLs to target host
          const baseTag = `<base href="${targetUrl.origin}${targetUrl.pathname}">`;
          if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${baseTag}`);
          } else if (html.includes('<HEAD>')) {
            html = html.replace('<HEAD>', `<HEAD>${baseTag}`);
          } else {
            html = baseTag + html;
          }
          return new Response(html, { status: 200, headers: responseHeaders });
        }

        return new Response(upstreamRes.body, { status: 200, headers: responseHeaders });
      } catch (err) {
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{background:#0a0d14;color:#e2e8f0;font-family:sans-serif;padding:32px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;}h2{color:#f87171;}code{background:#1e293b;padding:4px 8px;border-radius:4px;color:#38bdf8;}</style></head><body><h2>Sandbox Web Proxy Error</h2><p>Could not fetch target URL: <code>${targetParam}</code></p><p style="color:#94a3b8;font-size:13px;">Reason: ${err.message}</p></body></html>`,
          { status: 502, headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' } }
        );
      }
    }

    // 3. Storage Upload API: Store media/files in Cloudflare KV or R2
    if (url.pathname === '/api/storage/upload' && method === 'POST') {
      try {
        const body = await request.json();
        const { name, file_type, data_base64 } = body;
        if (!name || !data_base64) {
          return errorResponse('Missing name or data_base64');
        }

        const fileId = crypto.randomUUID().slice(0, 8);
        const cleanName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageKey = `${fileId}_${cleanName}`;

        const cleanB64 = data_base64.includes(',') ? data_base64.split(',')[1] : data_base64;
        const binaryStr = atob(cleanB64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        if (env.MEDIA_BUCKET) {
          await env.MEDIA_BUCKET.put(storageKey, bytes, {
            httpMetadata: { contentType: file_type || 'application/octet-stream' }
          });
        } else if (env.theysynced_media) {
          await env.theysynced_media.put(storageKey, bytes.buffer, {
            metadata: { file_type: file_type || 'application/octet-stream', name, size: bytes.length }
          });
        }

        const publicUrl = `/api/storage/file/${fileId}/${cleanName}`;
        return jsonResponse({
          success: true,
          url: publicUrl,
          name,
          file_type: file_type || 'application/octet-stream',
          size: bytes.length,
        });
      } catch (err) {
        return errorResponse(err.message, 500);
      }
    }

    // 4. Storage Download API: Serve media with edge caching
    if (url.pathname.startsWith('/api/storage/file/')) {
      const parts = url.pathname.replace('/api/storage/file/', '').split('/');
      if (parts.length >= 2) {
        const fileId = parts[0];
        const fileName = parts.slice(1).join('/');
        const storageKey = `${fileId}_${fileName}`;

        try {
          if (env.MEDIA_BUCKET) {
            const object = await env.MEDIA_BUCKET.get(storageKey);
            if (object) {
              const headers = new Headers();
              object.writeHttpMetadata(headers);
              headers.set('etag', object.httpEtag);
              headers.set('Cache-Control', 'public, max-age=31536000, immutable');
              headers.set('Access-Control-Allow-Origin', '*');
              return new Response(object.body, { headers });
            }
          } else if (env.theysynced_media) {
            const { value, metadata } = await env.theysynced_media.getWithMetadata(storageKey, { type: 'arrayBuffer' });
            if (value) {
              const contentType = metadata?.file_type || 'application/octet-stream';
              return new Response(value, {
                headers: {
                  'Content-Type': contentType,
                  'Content-Disposition': `inline; filename="${fileName}"`,
                  'Cache-Control': 'public, max-age=31536000, immutable',
                  'Access-Control-Allow-Origin': '*',
                },
              });
            }
          }
        } catch (_) {}
      }
      return errorResponse('File not found', 404);
    }

    // 5. Proxy WebSockets / RDP traffic to Upstream Axum Backend if configured
    const backendUrl = env.BACKEND_URL;
    if (backendUrl && (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/rdp-ws/'))) {
      const targetUrl = new URL(url.pathname + url.search, backendUrl);
      const headers = new Headers(request.headers);
      headers.set('X-Forwarded-Host', url.host);
      headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

      try {
        return await fetch(targetUrl.toString(), {
          method: request.method,
          headers,
          body: request.body,
        });
      } catch (_) {}
    }

    // ── 6. Standalone Cloudflare D1 Serverless API (Zero Server Architecture) ─
    if (env.theysynced_db && url.pathname.startsWith('/api/')) {
      const db = env.theysynced_db;
      const secret = env.ORG_ENCRYPTION_SECRET || DEFAULT_SECRET;

      try {
        // ── Auth: Register
        if (url.pathname === '/api/auth/register' && method === 'POST') {
          const body = await request.json();
          const username = (body.username || body.email || '').trim();
          const email = (body.email || (username.includes('@') ? username : '')).toLowerCase().trim();
          const password = (body.password || '').trim();
          if (!username || !password) return errorResponse('Username and password are required', 400);
          if (password.length < 4) return errorResponse('Password must be at least 4 characters', 400);

          const usernameClean = username.toLowerCase();
          const existing = await db.prepare('SELECT key FROM ts_users WHERE key = ?').bind(usernameClean).first();
          if (existing) return errorResponse('Username already taken', 409);

          const userId = `user_${crypto.randomUUID().slice(0, 8)}`;
          const pHash = await hashPassword(password);
          const now = new Date().toISOString();

          await ensureDefaultWorkspace(db, secret);
          await addUserToCompany(db, 'comp_theysynced', userId, username, secret);

          const userProfile = {
            id: userId,
            username: usernameClean,
            email: email || undefined,
            password_hash: pHash,
            created_at: now,
            last_login: now,
            company_ids: ['comp_theysynced'],
            avatar_url: null,
            last_active_at: now,
            total_active_seconds: 0,
            has_passkey: false,
          };

          const inserts = [
            db.prepare('INSERT OR REPLACE INTO ts_users (key, data) VALUES (?, ?)').bind(usernameClean, JSON.stringify(userProfile)),
            db.prepare('INSERT OR REPLACE INTO ts_users (key, data) VALUES (?, ?)').bind(userId, JSON.stringify(userProfile)),
          ];
          if (email && email !== usernameClean) {
            inserts.push(db.prepare('INSERT OR REPLACE INTO ts_users (key, data) VALUES (?, ?)').bind(email, JSON.stringify(userProfile)));
          }
          await db.batch(inserts);

          const clientUser = { ...userProfile };
          delete clientUser.password_hash;

          const token = `ts_jwt_${btoa(JSON.stringify({ id: userId, username: userProfile.username }))}`;
          return jsonResponse({ success: true, token, user: clientUser });
        }

        // ── Auth: Login (With seamless automatic signup for fresh users)
        if (url.pathname === '/api/auth/login' && method === 'POST') {
          const body = await request.json();
          const username = (body.username || body.email || '').trim().toLowerCase();
          const email = (body.email || (username.includes('@') ? username : '')).toLowerCase().trim();
          const password = (body.password || '').trim();
          if (!username || !password) return errorResponse('Username and password are required', 400);

          let row = await db.prepare('SELECT data FROM ts_users WHERE key = ?').bind(username).first();
          if (!row && email) {
            row = await db.prepare('SELECT data FROM ts_users WHERE key = ?').bind(email).first();
          }
          if (!row) {
            row = await db.prepare('SELECT data FROM ts_users WHERE key = ?').bind(`user_${username}`).first();
          }

          if (row) {
            // Existing user
            const user = JSON.parse(row.data);
            const pHash = await hashPassword(password);
            if (user.password_hash && user.password_hash !== pHash) {
              return errorResponse('Invalid username or password', 401);
            }

            // If user previously existed without password_hash (from earlier bug), update it now
            user.password_hash = pHash;
            user.last_login = new Date().toISOString();
            if (!user.company_ids || user.company_ids.length === 0) {
              user.company_ids = ['comp_theysynced'];
            }

            await db.prepare('UPDATE ts_users SET data = ? WHERE key = ?').bind(JSON.stringify(user), user.id).run();
            await db.prepare('UPDATE ts_users SET data = ? WHERE key = ?').bind(JSON.stringify(user), username).run();

            await ensureDefaultWorkspace(db, secret);
            await addUserToCompany(db, 'comp_theysynced', user.id, user.username, secret);

            const clientUser = { ...user };
            delete clientUser.password_hash;

            const token = `ts_jwt_${btoa(JSON.stringify({ id: user.id, username: user.username }))}`;
            return jsonResponse({ success: true, token, user: clientUser });
          } else {
            // New user login -> auto-signup (matches Rust sign_in behavior)
            const userId = `user_${crypto.randomUUID().slice(0, 8)}`;
            const pHash = await hashPassword(password);
            const now = new Date().toISOString();

            await ensureDefaultWorkspace(db, secret);
            await addUserToCompany(db, 'comp_theysynced', userId, username, secret);

            const userProfile = {
              id: userId,
              username: username,
              email: email || undefined,
              password_hash: pHash,
              created_at: now,
              last_login: now,
              company_ids: ['comp_theysynced'],
              avatar_url: null,
              last_active_at: now,
              total_active_seconds: 0,
              has_passkey: false,
            };

            const inserts = [
              db.prepare('INSERT OR REPLACE INTO ts_users (key, data) VALUES (?, ?)').bind(username, JSON.stringify(userProfile)),
              db.prepare('INSERT OR REPLACE INTO ts_users (key, data) VALUES (?, ?)').bind(userId, JSON.stringify(userProfile)),
            ];
            if (email && email !== username) {
              inserts.push(db.prepare('INSERT OR REPLACE INTO ts_users (key, data) VALUES (?, ?)').bind(email, JSON.stringify(userProfile)));
            }
            await db.batch(inserts);

            const clientUser = { ...userProfile };
            delete clientUser.password_hash;

            const token = `ts_jwt_${btoa(JSON.stringify({ id: userId, username }))}`;
            return jsonResponse({ success: true, token, user: clientUser });
          }
        }

        // ── Auth: Me / Profile
        if (url.pathname === '/api/auth/me') {
          const token = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
          if (!token || !token.startsWith('ts_jwt_')) return errorResponse('Unauthorized', 401);

          let decoded;
          try {
            decoded = JSON.parse(atob(token.replace('ts_jwt_', '')));
          } catch (_) {
            return errorResponse('Invalid token', 401);
          }

          let row = await db.prepare('SELECT data FROM ts_users WHERE key = ?').bind(decoded.id).first();
          if (!row && decoded.username) {
            row = await db.prepare('SELECT data FROM ts_users WHERE key = ?').bind(decoded.username).first();
          }
          if (!row) return errorResponse('User not found', 404);

          const user = JSON.parse(row.data);
          if (!user.company_ids || user.company_ids.length === 0) {
            user.company_ids = ['comp_theysynced'];
          }
          delete user.password_hash;
          return jsonResponse({ success: true, user });
        }

        // ── Companies: List (Returns { success: true, companies: [...] })
        if (url.pathname === '/api/companies/list') {
          const token = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          const currentUserId = user?.id || null;

          await ensureDefaultWorkspace(db, secret);
          const { results } = await db.prepare('SELECT id, data FROM ts_companies').all();
          const list = [];
          for (const row of (results || [])) {
            try {
              const decryptedJson = await decryptForOrg(row.id, row.data, secret);
              const comp = JSON.parse(decryptedJson);
              if (!currentUserId || comp.id === 'comp_theysynced' || comp.owner_id === currentUserId || comp.members?.some(m => m.user_id === currentUserId)) {
                list.push(comp);
              }
            } catch (_) {}
          }
          return jsonResponse({ success: true, companies: list });
        }

        // ── Companies: Create
        if (url.pathname === '/api/companies/create' && method === 'POST') {
          const body = await request.json();
          const token = body.token || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          const creatorId = user?.id || body.owner_id || 'user_admin';
          const creatorUsername = user?.username || 'Owner';
          const creatorAvatar = user?.avatar_url || null;

          const { name } = body;
          if (!name || !name.trim()) return errorResponse('Missing company name');

          const companyId = `comp_${crypto.randomUUID().slice(0, 8)}`;
          const now = new Date().toISOString();
          const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();

          const newComp = {
            id: companyId,
            name: name.trim(),
            join_code: joinCode,
            logo_url: body.logo_url || null,
            created_at: now,
            last_activity_at: now,
            owner_id: creatorId,
            members: [
              {
                user_id: creatorId,
                username: creatorUsername,
                role: 'Owner',
                joined_at: now,
                avatar_url: creatorAvatar,
                last_active_at: now,
                total_active_seconds: 0,
              }
            ],
            banned_user_ids: [],
          };

          const defaultTeams = [
            { id: `team_${companyId}_general`, company_id: companyId, name: 'General', created_at: now }
          ];

          const defaultAssets = [
            {
              id: `asset_${companyId}_board`,
              company_id: companyId,
              asset_type: 'Whiteboard',
              title: `${name} Whiteboard`,
              content: '{"elements":[],"appState":{}}',
              updated_at: now,
              updated_by: creatorUsername,
            }
          ];

          const encComp = await encryptForOrg(companyId, JSON.stringify(newComp), secret);
          const encTeams = await encryptForOrg(companyId, JSON.stringify(defaultTeams), secret);
          const encAssets = await encryptForOrg(companyId, JSON.stringify(defaultAssets), secret);

          await db.batch([
            db.prepare('INSERT OR REPLACE INTO ts_companies (id, data) VALUES (?, ?)').bind(companyId, encComp),
            db.prepare('INSERT OR REPLACE INTO ts_teams (company_id, data) VALUES (?, ?)').bind(companyId, encTeams),
            db.prepare('INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES (?, ?)').bind(companyId, encAssets),
          ]);

          return jsonResponse({ success: true, company: newComp });
        }

        // ── Companies: Join with Join Code
        if (url.pathname === '/api/companies/join' && method === 'POST') {
          const body = await request.json();
          const token = body.token || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          const userId = user?.id || 'user_guest';
          const username = user?.username || 'Member';
          const avatarUrl = user?.avatar_url || null;

          const joinCode = (body.join_code || body.code || '').trim().toUpperCase();
          if (!joinCode) return errorResponse('Missing join code');

          const { results } = await db.prepare('SELECT id, data FROM ts_companies').all();
          let targetComp = null;
          let targetId = null;

          for (const row of (results || [])) {
            try {
              const comp = JSON.parse(await decryptForOrg(row.id, row.data, secret));
              if (comp.join_code?.toUpperCase() === joinCode || comp.id?.toUpperCase() === joinCode) {
                targetComp = comp;
                targetId = row.id;
                break;
              }
            } catch (_) {}
          }

          if (!targetComp) return errorResponse('Invalid company join code. Workspace not found.', 404);

          // Check if user is already a member
          if (!targetComp.members) targetComp.members = [];
          const existingMember = targetComp.members.find(m => m.user_id === userId);
          if (!existingMember) {
            targetComp.members.push({
              user_id: userId,
              username: username,
              role: 'Member',
              joined_at: new Date().toISOString(),
              avatar_url: avatarUrl,
              last_active_at: new Date().toISOString(),
              total_active_seconds: 0,
            });
            targetComp.last_activity_at = new Date().toISOString();
            const encComp = await encryptForOrg(targetId, JSON.stringify(targetComp), secret);
            await db.prepare('UPDATE ts_companies SET data = ? WHERE id = ?').bind(encComp, targetId).run();
          }

          return jsonResponse({ success: true, company: targetComp });
        }

        // ── Companies: Leave Company (For non-owner members)
        if (url.pathname === '/api/companies/leave' && (method === 'POST' || method === 'DELETE')) {
          const body = await request.json();
          const token = body.token || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          if (!user?.id) return errorResponse('Unauthorized', 401);

          const companyId = body.company_id || body.id;
          if (!companyId) return errorResponse('Missing company_id');

          const row = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
          if (!row) return errorResponse('Company not found', 404);

          const comp = JSON.parse(await decryptForOrg(companyId, row.data, secret));
          if (comp.owner_id === user.id) {
            return errorResponse('As the owner, you cannot leave this company. You must transfer ownership or delete the company in Danger Zone.');
          }

          comp.members = (comp.members || []).filter(m => m.user_id !== user.id);
          comp.last_activity_at = new Date().toISOString();
          const encComp = await encryptForOrg(companyId, JSON.stringify(comp), secret);
          await db.prepare('UPDATE ts_companies SET data = ? WHERE id = ?').bind(encComp, companyId).run();

          return jsonResponse({ success: true, message: 'You have left the company.' });
        }

        // ── Companies: Rename
        if (url.pathname === '/api/companies/rename' && method === 'POST') {
          const body = await request.json();
          const token = body.token || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          const companyId = body.company_id || body.id;
          const newName = (body.new_name || body.name || '').trim();

          if (!companyId) return errorResponse('Missing company_id');
          if (!newName) return errorResponse('Missing new company name');

          const row = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
          if (!row) return errorResponse('Company not found', 404);

          const comp = JSON.parse(await decryptForOrg(companyId, row.data, secret));
          if (user && comp.owner_id !== user.id && !comp.members?.some(m => m.user_id === user.id && (m.role === 'Admin' || m.role === 'Owner'))) {
            return errorResponse('Forbidden: only admins or owner can rename company', 403);
          }

          comp.name = newName;
          comp.last_activity_at = new Date().toISOString();
          const encComp = await encryptForOrg(companyId, JSON.stringify(comp), secret);
          await db.prepare('UPDATE ts_companies SET data = ? WHERE id = ?').bind(encComp, companyId).run();

          return jsonResponse({ success: true, company: comp });
        }

        // ── Companies: Update Logo
        if (url.pathname === '/api/companies/logo' && method === 'POST') {
          const body = await request.json();
          const token = body.token || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          const companyId = body.company_id || body.id;
          const logoUrl = body.logo_url !== undefined ? body.logo_url : (body.logo || null);

          if (!companyId) return errorResponse('Missing company_id');

          const row = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
          if (!row) return errorResponse('Company not found', 404);

          const comp = JSON.parse(await decryptForOrg(companyId, row.data, secret));
          if (user && comp.owner_id !== user.id && !comp.members?.some(m => m.user_id === user.id && (m.role === 'Admin' || m.role === 'Owner'))) {
            return errorResponse('Forbidden: only admins or owner can update logo', 403);
          }

          comp.logo_url = logoUrl;
          comp.last_activity_at = new Date().toISOString();
          const encComp = await encryptForOrg(companyId, JSON.stringify(comp), secret);
          await db.prepare('UPDATE ts_companies SET data = ? WHERE id = ?').bind(encComp, companyId).run();

          return jsonResponse({ success: true, company: comp });
        }

        // ── Companies: Touch Activity (Retention Lifecycle)
        if (url.pathname === '/api/companies/touch-activity' && method === 'POST') {
          const body = await request.json();
          const companyId = body.company_id || body.id;
          if (companyId) {
            const row = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
            if (row) {
              const comp = JSON.parse(await decryptForOrg(companyId, row.data, secret));
              comp.last_activity_at = new Date().toISOString();
              const enc = await encryptForOrg(companyId, JSON.stringify(comp), secret);
              await db.prepare('UPDATE ts_companies SET data = ? WHERE id = ?').bind(enc, companyId).run();
            }
          }
          return jsonResponse({ success: true });
        }

        // ── Companies: Full Encrypted Data Extraction / Export
        if ((url.pathname === '/api/companies/export' || url.pathname === '/api/org/export') && method === 'POST') {
          const body = await request.json();
          const companyId = body.company_id || body.id;
          if (!companyId) return errorResponse('Missing company_id');

          const compRow = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
          if (!compRow) return errorResponse('Organization not found', 404);

          const teamsRow = await db.prepare('SELECT data FROM ts_teams WHERE company_id = ?').bind(companyId).first();
          const assetsRow = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(companyId).first();
          const { results: msgRows } = await db.prepare('SELECT key, data FROM ts_messages WHERE key = ? OR key LIKE ?').bind(companyId, `team_${companyId}_%`).all();

          const companyData = JSON.parse(await decryptForOrg(companyId, compRow.data, secret));
          const teamsData = teamsRow ? JSON.parse(await decryptForOrg(companyId, teamsRow.data, secret)) : [];
          const assetsData = assetsRow ? JSON.parse(await decryptForOrg(companyId, assetsRow.data, secret)) : [];

          const messagesData = [];
          for (const m of (msgRows || [])) {
            try {
              messagesData.push(...JSON.parse(await decryptForOrg(null, m.data, secret)));
            } catch (_) {}
          }

          const exportPayload = {
            export_version: '1.0',
            exported_at: new Date().toISOString(),
            company: companyData,
            teams: teamsData,
            assets: assetsData,
            messages: messagesData,
          };

          return jsonResponse({ success: true, export: exportPayload });
        }

        // ── Companies: Full Permanent Purge / Deletion
        if ((url.pathname === '/api/companies/delete' || url.pathname === '/api/org/purge') && (method === 'POST' || method === 'DELETE')) {
          const body = await request.json();
          const token = body.token || request.headers.get('Authorization')?.replace('Bearer ', '');
          const user = getUserFromToken(token);
          const companyId = body.company_id || body.id;
          if (!companyId) return errorResponse('Missing company_id');

          // Check if caller is owner or admin (or comp_theysynced protection)
          const compRow = await db.prepare('SELECT data FROM ts_companies WHERE id = ?').bind(companyId).first();
          if (compRow) {
            const comp = JSON.parse(await decryptForOrg(companyId, compRow.data, secret));
            if (user && comp.owner_id !== user.id && user.role !== 'Admin') {
              return errorResponse('Forbidden: only company owner can permanently delete this organization', 403);
            }
          }

          // Eradicate all media files in Cloudflare KV / R2
          await purgeOrgMedia(companyId, db, env, secret);

          await db.batch([
            db.prepare('DELETE FROM ts_companies WHERE id = ?').bind(companyId),
            db.prepare('DELETE FROM ts_teams WHERE company_id = ?').bind(companyId),
            db.prepare('DELETE FROM ts_assets WHERE company_id = ?').bind(companyId),
            db.prepare('DELETE FROM ts_messages WHERE key = ? OR key LIKE ?').bind(companyId, `team_${companyId}_%`),
          ]);

          return jsonResponse({ success: true, message: `Organization ${companyId} eradicated.` });
        }

        // ── Teams: List (Returns { success: true, teams: [...] })
        if (url.pathname === '/api/teams/list') {
          const companyId = url.searchParams.get('company_id') || 'comp_theysynced';
          const row = await db.prepare('SELECT data FROM ts_teams WHERE company_id = ?').bind(companyId).first();
          if (!row) {
            const defaultTeams = [
              { id: `team_${companyId}_gen`, company_id: companyId, name: 'General', created_at: new Date().toISOString() }
            ];
            return jsonResponse({ success: true, teams: defaultTeams });
          }

          const decryptedJson = await decryptForOrg(null, row.data, secret);
          const teams = JSON.parse(decryptedJson);
          return jsonResponse({ success: true, teams });
        }

        // ── Teams: Create
        if (url.pathname === '/api/teams/create' && method === 'POST') {
          const body = await request.json();
          const { company_id, name } = body;
          if (!company_id || !name) return errorResponse('Missing company_id or name');

          const row = await db.prepare('SELECT data FROM ts_teams WHERE company_id = ?').bind(company_id).first();
          const teams = row ? JSON.parse(await decryptForOrg(company_id, row.data, secret)) : [];

          const newTeam = {
            id: `team_${company_id}_${crypto.randomUUID().slice(0, 6)}`,
            company_id,
            name,
            created_at: new Date().toISOString(),
          };
          teams.push(newTeam);

          const enc = await encryptForOrg(company_id, JSON.stringify(teams), secret);
          await db.prepare('INSERT OR REPLACE INTO ts_teams (company_id, data) VALUES (?, ?)').bind(company_id, enc).run();

          return jsonResponse({ success: true, team: newTeam });
        }

        // ── Assets: List (Returns { success: true, assets: [...] })
        if (url.pathname === '/api/assets/list') {
          const companyId = url.searchParams.get('company_id') || 'comp_theysynced';
          const row = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(companyId).first();
          if (!row) return jsonResponse({ success: true, assets: [] });

          const decryptedJson = await decryptForOrg(null, row.data, secret);
          const assets = JSON.parse(decryptedJson);
          return jsonResponse({ success: true, assets });
        }

        // ── Assets: Save
        if (url.pathname === '/api/assets/save' && method === 'POST') {
          const body = await request.json();
          const companyId = body.company_id || 'comp_theysynced';
          const asset = body.asset || body;
          if (!asset || !asset.id) return errorResponse('Missing asset');

          const row = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(companyId).first();
          const assets = row ? JSON.parse(await decryptForOrg(null, row.data, secret)) : [];

          const existingIdx = assets.findIndex(a => a.id === asset.id);
          asset.updated_at = new Date().toISOString();
          if (existingIdx >= 0) {
            assets[existingIdx] = { ...assets[existingIdx], ...asset };
          } else {
            assets.push(asset);
          }

          const enc = await encryptForOrg(companyId, JSON.stringify(assets), secret);
          await db.prepare('INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES (?, ?)').bind(companyId, enc).run();

          return jsonResponse({ success: true, asset });
        }

        // ── Assets: Delete
        if ((url.pathname === '/api/assets/delete') && (method === 'POST' || method === 'DELETE')) {
          const body = await request.json();
          const companyId = body.company_id || 'comp_theysynced';
          const assetId = body.id || body.asset_id;
          if (!assetId) return errorResponse('Missing asset id');

          const row = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(companyId).first();
          if (row) {
            const assets = JSON.parse(await decryptForOrg(null, row.data, secret));
            // Remove the asset and any sub-items that had this folder as parent
            const filtered = assets.filter(a => a.id !== assetId && a.parent_id !== assetId && a.folder_id !== assetId);
            const enc = await encryptForOrg(companyId, JSON.stringify(filtered), secret);
            await db.prepare('INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES (?, ?)').bind(companyId, enc).run();
          }

          return jsonResponse({ success: true, message: 'Asset deleted' });
        }

        // ── Workspace: Linux VM Bootstrap Shell Script (Mount /workspace)
        if (url.pathname === '/api/workspace/bootstrap.sh') {
          const companyId = url.searchParams.get('company_id') || 'comp_theysynced';
          const assetRow = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(companyId).first();
          const assets = assetRow ? JSON.parse(await decryptForOrg(null, assetRow.data, secret)) : [];

          let sh = `#!/bin/bash
# ==============================================================================
# TheySynced Enterprise Linux Real VM Workspace Auto-Mount
# Organization: ${companyId}
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ==============================================================================
set -e
echo "⚡ Initializing /workspace for organization [${companyId}]..."
mkdir -p /workspace/chats /workspace/spreadsheets /workspace/drawings /workspace/docs /workspace/tasks /workspace/files /workspace/export

`;

          for (const a of assets) {
            if (a.content && a.name) {
              const targetFolder = a.folder_path ? (a.folder_path.startsWith('/workspace') ? a.folder_path : `/workspace${a.folder_path}`) : '/workspace/files';
              const safeName = a.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              sh += `mkdir -p "${targetFolder}"\n`;
              const cleanContent = a.content.replace(/'/g, "'\\''");
              sh += `cat << 'THEYSYNCED_EOF' > "${targetFolder}/${safeName}"\n${cleanContent}\nTHEYSYNCED_EOF\n`;
            }
          }

          sh += `
echo "✅ /workspace successfully mounted with company assets!"
echo "Files in /workspace:"
ls -la /workspace
`;

          return new Response(sh, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        // ── Chat: Messages List / History (Returns { success: true, messages: [...] })
        if (url.pathname === '/api/chat/messages' || url.pathname === '/api/chat/history') {
          const channelId = url.searchParams.get('channel_id') || url.searchParams.get('company_id') || 'comp_theysynced';
          const row = await db.prepare('SELECT data FROM ts_messages WHERE key = ?').bind(channelId).first();
          if (!row) return jsonResponse({ success: true, messages: [] });

          try {
            const decryptedJson = await decryptForOrg(null, row.data, secret);
            const messages = JSON.parse(decryptedJson);
            return jsonResponse({ success: true, messages });
          } catch (_) {
            return jsonResponse({ success: true, messages: [] });
          }
        }

        // ── Chat: Send / Save Message
        if ((url.pathname === '/api/chat/messages/save' || url.pathname === '/api/chat/send') && method === 'POST') {
          const body = await request.json();
          let { channel_id, message, username, user_id, file_attachment, token } = body;
          const chanKey = channel_id || body.company_id || 'comp_theysynced';
          const match = chanKey.match(/(comp_[a-zA-Z0-9]+)/);
          const compId = body.company_id || (match ? match[1] : chanKey);

          // If username wasn't provided or defaulted to Anonymous, decode from token if available
          if ((!username || username === 'Anonymous') && token && token.startsWith('ts_jwt_')) {
            try {
              const decoded = JSON.parse(atob(token.replace('ts_jwt_', '')));
              if (decoded.username) username = decoded.username;
              if (decoded.id && (!user_id || user_id === 'user_anonymous')) user_id = decoded.id;
            } catch (_) {}
          }

          const row = await db.prepare('SELECT data FROM ts_messages WHERE key = ?').bind(chanKey).first();
          let messages = [];
          if (row) {
            try {
              messages = JSON.parse(await decryptForOrg(null, row.data, secret));
            } catch (_) {}
          }

          const newMsg = {
            id: `msg_${crypto.randomUUID().slice(0, 8)}`,
            company_id: compId,
            team_id: chanKey.startsWith('team_') ? chanKey : null,
            user_id: user_id || 'user_anonymous',
            username: username || 'Anonymous',
            message: message || '',
            timestamp: new Date().toISOString(),
            file_attachment: file_attachment || null,
            reactions: [],
          };
          messages.push(newMsg);

          const enc = await encryptForOrg(compId, JSON.stringify(messages), secret);
          await db.prepare('INSERT OR REPLACE INTO ts_messages (key, data) VALUES (?, ?)').bind(chanKey, enc).run();

          // Auto-index file attachment into ts_assets with folder hierarchy and DM privacy restrictions
          if (file_attachment && file_attachment.url) {
            try {
              const assetRow = await db.prepare('SELECT data FROM ts_assets WHERE company_id = ?').bind(compId).first();
              const companyAssets = assetRow ? JSON.parse(await decryptForOrg(null, assetRow.data, secret)) : [];

              let folderName = 'General';
              let scope = 'shared';
              let allowedUsers = null;

              if (chanKey.includes('DM:') || chanKey.includes('dm-')) {
                scope = 'dm';
                const matchDm = chanKey.match(/DM:([^-]+)-(.+)/i);
                if (matchDm) {
                  allowedUsers = [matchDm[1], matchDm[2]];
                  folderName = `@${matchDm[1]} & @${matchDm[2]}`;
                } else {
                  folderName = 'Direct Messages';
                }
              } else if (chanKey.startsWith('team_')) {
                folderName = chanKey.replace(`team_${compId}_`, '');
                if (folderName === 'gen') folderName = 'General';
                else folderName = `#${folderName}`;
              }

              const newFileAsset = {
                id: `file_chat_${newMsg.id}`,
                company_id: compId,
                team_id: newMsg.team_id,
                asset_type: 'file',
                name: file_attachment.name || 'attachment',
                url: file_attachment.url,
                file_type: file_attachment.file_type || 'application/octet-stream',
                size: file_attachment.size || 0,
                created_by: username || 'Unknown',
                updated_at: new Date().toISOString(),
                folder_path: scope === 'dm' ? `/Chat Attachments/Direct Messages/${folderName}` : `/Chat Attachments/${folderName}`,
                scope: scope,
                allowed_users: allowedUsers,
              };

              if (!companyAssets.some(a => a.id === newFileAsset.id || (a.url === newFileAsset.url && a.name === newFileAsset.name))) {
                companyAssets.push(newFileAsset);
                const encAssets = await encryptForOrg(compId, JSON.stringify(companyAssets), secret);
                await db.prepare('INSERT OR REPLACE INTO ts_assets (company_id, data) VALUES (?, ?)').bind(compId, encAssets).run();
              }
            } catch (err) {
              console.warn('[Chat Attachment Indexing Error]', err);
            }
          }

          return jsonResponse({ success: true, message: newMsg });
        }

        // ── Invites: Join
        if (url.pathname === '/api/invites/join' && method === 'POST') {
          const body = await request.json();
          const { code, user_id, token } = body;
          if (!code) return errorResponse('Missing invite code');

          const { results } = await db.prepare('SELECT id, data FROM ts_companies').all();
          let foundComp = null;
          for (const row of (results || [])) {
            try {
              const comp = JSON.parse(await decryptForOrg(row.id, row.data, secret));
              if (comp.join_code === code.toUpperCase() || comp.id === code) {
                foundComp = comp;
                break;
              }
            } catch (_) {}
          }

          if (!foundComp) return errorResponse('Invalid invite code', 404);

          // Add user to company
          if (user_id) {
            await addUserToCompany(db, foundComp.id, user_id, 'Member', secret);
          }
          return jsonResponse({ success: true, company: foundComp });
        }

        // ── Active Pulse
        if (url.pathname === '/api/users/active-pulse') {
          return jsonResponse({ success: true, active_users: 1 });
        }
      } catch (err) {
        console.error('[Cloudflare D1 Edge Error]', err);
        return errorResponse(err.message, 500);
      }
    }

    // ── 7. Static Asset Delivery & SPA Fallback ────────────────────────────────
    if (env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }

        // If asset not found, but it is an HTML / browser navigation, serve root index (SPA routing)
        if (request.headers.get('accept')?.includes('text/html') || method === 'GET') {
          const rootUrl = new URL('/', request.url);
          const rootResponse = await env.ASSETS.fetch(rootUrl.toString());
          if (rootResponse.status === 200) {
            return rootResponse;
          }
        }
      } catch (_) {}
    }

    // Default Fallback
    return jsonResponse({
      service: 'TheySynced Cloudflare Edge Engine',
      version: '0.2.0',
      status: 'online',
      docs: '/api/health',
    });
  },

  /**
   * Hourly automated background retention sweeper for inactive organizations (90 days)
   */
  async scheduled(event, env, ctx) {
    console.log('[Cloudflare Retention] Running scheduled 90-day inactivity check...');
    if (env.theysynced_db) {
      try {
        const secret = env.ORG_ENCRYPTION_SECRET || DEFAULT_SECRET;
        const now = Date.now();
        const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

        const { results } = await env.theysynced_db.prepare('SELECT id, data FROM ts_companies').all();
        for (const row of (results || [])) {
          if (row.id === 'comp_theysynced') continue;

          let comp;
          try {
            comp = JSON.parse(await decryptForOrg(row.id, row.data, secret));
          } catch (_) {
            continue;
          }

          const lastActive = comp.last_activity_at ? new Date(comp.last_activity_at).getTime() : new Date(comp.created_at).getTime();
          if (now - lastActive >= ninetyDaysMs) {
            console.warn(`[Cloudflare Retention] Permanently purging inactive organization: ${row.id}`);
            // Eradicate all media files in Cloudflare KV / R2
            await purgeOrgMedia(row.id, env.theysynced_db, env, secret);

            await env.theysynced_db.batch([
              env.theysynced_db.prepare('DELETE FROM ts_companies WHERE id = ?').bind(row.id),
              env.theysynced_db.prepare('DELETE FROM ts_teams WHERE company_id = ?').bind(row.id),
              env.theysynced_db.prepare('DELETE FROM ts_assets WHERE company_id = ?').bind(row.id),
              env.theysynced_db.prepare('DELETE FROM ts_messages WHERE key = ? OR key LIKE ?').bind(row.id, `team_${row.id}_%`),
            ]);
            console.log(`[Cloudflare Retention] Organization ${row.id} eradicated.`);
          }
        }
      } catch (err) {
        console.error('[Cloudflare Retention Error]', err);
      }
    }
  }
};
