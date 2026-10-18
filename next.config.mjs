import path from 'path';

const isExport = process.env.OUTPUT_EXPORT === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.resolve('.'),
  },
  ...(isExport
    ? {
        output: 'export',
        images: { unoptimized: true },
      }
    : {
        async rewrites() {
          const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
          const rdpProxyUrl = process.env.RDP_PROXY_URL || 'http://localhost:8080';
          return [
            {
              source: '/api/:path*',
              destination: `${backendUrl}/api/:path*`,
            },
            {
              source: '/ws/:path*',
              destination: `${backendUrl}/ws/:path*`,
            },
            {
              source: '/rdp-ws/:path*',
              destination: `${rdpProxyUrl}/rdp-ws/:path*`,
            },
            {
              source: '/rdp-proxy/:path*',
              destination: `${rdpProxyUrl}/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
