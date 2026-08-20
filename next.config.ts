import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // When the dev server is reached through a tunnel, every request arrives with
  // that Host. Without it Next blocks the dev-only resources and the client never
  // hydrates — pages render as permanent loading skeletons.
  allowedDevOrigins: process.env.DEV_TUNNEL_HOST
    ? [process.env.DEV_TUNNEL_HOST]
    : [],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
