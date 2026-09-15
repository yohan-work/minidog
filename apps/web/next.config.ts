import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The theme switch sits at the bottom left of the sidebar; keep the dev badge clear of it.
  devIndicators: { position: 'bottom-right' },
  transpilePackages: ['@minidog/types'],
  // The browser talks to the Query API through the web origin; no CORS needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
