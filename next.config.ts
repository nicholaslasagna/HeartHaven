import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * Security headers applied to every response. Defense in depth — even if a
 * future bug allows untrusted content into the page, these headers stop
 * most of the resulting impact.
 *
 *   • CSP — strict default with explicit allowlists for Supabase, our own
 *     assets, and inline styles (Tailwind injects them in dev).
 *   • Strict-Transport-Security — pin HTTPS; protects against SSL stripping.
 *   • X-Content-Type-Options — block MIME sniffing.
 *   • X-Frame-Options + frame-ancestors — refuse iframes (clickjack defense).
 *   • Referrer-Policy — never leak full URLs (some contain ?visit=<code>)
 *     to third-party origins.
 *   • Permissions-Policy — opt out of features we don't use so a future
 *     compromised script can't, either.
 *   • COOP / CORP — isolate the browsing context group so a popup can't
 *     reach back via window.opener, and resources stay same-origin only.
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-eval' is needed by Phaser's webgl shader compilation in
      // dev/preview builds. Production bundles still load fine without it
      // for most environments, but keeping it scoped to script-src keeps
      // the rest of the policy tight.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind v4 injects styles at runtime via <style> elements —
      // 'unsafe-inline' for STYLE only (not script) is acceptable.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.supabase.co https://realfiction.store",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "media-src 'self' data: blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ].join(", "),
  },
  // Modern browsers ignore the legacy heuristic when this is "0"; we keep
  // it explicit to defeat IE-style auditors that occasionally bring back
  // broken XSS auditing on enterprise edges.
  { key: "X-XSS-Protection", value: "0" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

initOpenNextCloudflareForDev();

export default nextConfig;
