import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

// Gives `next dev` access to the local D1 and R2 bindings from wrangler.jsonc.
initOpenNextCloudflareForDev();
