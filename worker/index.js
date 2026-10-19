/**
 * TheySynced - Cloudflare Edge Gateway
 *
 * Thin edge layer responsible for:
 * 1. Serving static assets (Next.js frontend SPA build) via env.ASSETS
 * 2. Routing and forwarding all API (/api/*) and WebSocket (/ws/*, /rdp-ws/*) traffic
 *    to the authoritative Rust Axum backend (env.BACKEND_URL)
 * 3. Triggering the scheduled hourly inactivity sweeper on the Rust backend
 *
 * NOTE: All business logic, authentication, encryption, and storage authorization
 * reside strictly in the Rust backend (src/). No business logic is duplicated here.
 */

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // 1. CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 2. Health check endpoint for edge gateway status
    if (url.pathname === '/api/edge/health') {
      return jsonResponse({
        status: 'healthy',
        service: 'TheySynced Cloudflare Edge Gateway',
        backend_configured: !!env.BACKEND_URL,
        assets_configured: !!env.ASSETS,
        timestamp: new Date().toISOString(),
        colo: request.cf ? request.cf.colo : 'edge',
      });
    }

    const isApiOrWs = url.pathname.startsWith('/api/') ||
                      url.pathname.startsWith('/ws/') ||
                      url.pathname.startsWith('/rdp-ws/') ||
                      request.headers.get('upgrade')?.toLowerCase() === 'websocket';

    // 3. Static Asset Delivery (Next.js export via env.ASSETS)
    // Only attempt static assets for non-API / non-WebSocket requests
    if (!isApiOrWs && env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }

        // SPA Navigation Fallback: serve root index.html for GET requests accepting HTML
        if (method === 'GET' && (request.headers.get('accept')?.includes('text/html') || !url.pathname.includes('.'))) {
          const rootUrl = new URL('/', request.url);
          const rootResponse = await env.ASSETS.fetch(rootUrl.toString());
          if (rootResponse.status === 200) {
            return rootResponse;
          }
        }
      } catch (err) {
        console.error('[Edge Gateway Static Asset Error]', err);
      }
    }

    // 4. Forwarding to Upstream Rust Axum Backend
    const backendUrl = env.BACKEND_URL;
    if (!backendUrl) {
      return jsonResponse(
        {
          success: false,
          error: 'BACKEND_URL not configured on edge gateway',
          message: 'The authoritative Rust backend is not set. Please set the BACKEND_URL secret or environment variable.',
        },
        503
      );
    }

    try {
      // Construct target URL pointing to the Rust backend
      const targetUrl = new URL(url.pathname + url.search, backendUrl);

      // Forward request to Rust Axum backend (headers, body, method, and WS upgrade preserved)
      const forwardRequest = new Request(targetUrl.toString(), request);
      return await fetch(forwardRequest);
    } catch (err) {
      console.error('[Edge Gateway Upstream Forwarding Error]', err);
      return jsonResponse(
        {
          success: false,
          error: 'Bad Gateway: Upstream Rust backend unreachable',
          detail: err.message,
        },
        502
      );
    }
  },

  /**
   * Hourly automated background retention sweeper trigger
   * Delegates the actual 90-day inactivity purge to the Rust backend
   */
  async scheduled(event, env, ctx) {
    console.log('[Edge Retention Trigger] Firing hourly 90-day inactivity check...');
    const backendUrl = env.BACKEND_URL;
    if (!backendUrl) {
      console.warn('[Edge Retention Trigger] BACKEND_URL not configured. Skipping retention tick.');
      return;
    }

    try {
      const targetUrl = new URL('/api/cron/purge-inactive', backendUrl);
      const headers = { 'Content-Type': 'application/json' };
      if (env.CRON_SECRET) {
        headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;
      }

      const res = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers,
      });

      const bodyText = await res.text();
      console.log(`[Edge Retention Trigger] Rust backend purge response status ${res.status}: ${bodyText}`);
    } catch (err) {
      console.error('[Edge Retention Trigger Error]', err);
    }
  },
};
