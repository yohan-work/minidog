import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The theme switch sits at the bottom left of the sidebar; keep the dev badge clear of it.
  devIndicators: { position: 'bottom-right' },
  transpilePackages: ['@minidog/types'],
  // A self-contained server for the Docker image (only the files it needs, see infra/docker/Dockerfile).
  output: 'standalone',
  // Builds run in apps/web; tracing starts at the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  // /api/* is forwarded to the Query API by app/api/[...path]/route.ts, which reads API_URL at runtime.
};

export default nextConfig;
