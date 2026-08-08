import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native Node addon (a .node binary) - must stay external rather than
  // bundled, same reason sharp/firebase-admin get this treatment.
  serverExternalPackages: ["@contentauth/c2pa-node"],
};

export default nextConfig;
