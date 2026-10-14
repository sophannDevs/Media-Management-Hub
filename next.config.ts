import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
/** Set HTTPS_ONLY=true when the app is served over HTTPS (adds HSTS and upgrades insecure requests). */
const httpsOnly = process.env.HTTPS_ONLY === "true";

// Content Security Policy. Scripts allow 'unsafe-inline' because the App
// Router streams page data in inline <script> tags whose content changes per
// request; a nonce would remove that need, but nonces force every page to
// render per request and switch off the static shell of Cache Components
// (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
// Everything else is locked down: no third-party scripts, plugins, framing,
// <base> hijacking, or form posts / connections to other origins.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Linked media (https only, see lib/security/url.ts) can live on any https host
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(httpsOnly ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(httpsOnly ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
