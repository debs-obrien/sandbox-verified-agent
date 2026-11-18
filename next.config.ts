import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dynamic Sandbox + receipt IO — not a static/cacheComponents app.
  serverExternalPackages: ["@vercel/sandbox", "@vercel/oidc", "@vercel/blob"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
