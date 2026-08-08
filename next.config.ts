import type { NextConfig } from "next";

// No external origins are ever needed: fonts are self-hosted at build time
// via next/font, there's no analytics/third-party script, and all data
// fetching is same-origin. That makes a strict CSP straightforward rather
// than a compromise. 'unsafe-inline' on script-src is the one gap - Next's
// hydration payload is an inline script - closing it needs per-request
// nonces threaded through a proxy.ts, not done here; everything else
// (no external script/style/image/connect origins, no framing, no plugins)
// meaningfully narrows what an XSS could actually reach even without it.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Native Node addon (a .node binary) - must stay external rather than
  // bundled, same reason sharp/firebase-admin get this treatment.
  serverExternalPackages: ["@contentauth/c2pa-node"],
  // Slim runtime image for Docker - only traced files get copied in.
  output: "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Cloud Run terminates TLS for every request this app ever
          // serves - safe to unconditionally require HTTPS on repeat
          // visits.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
