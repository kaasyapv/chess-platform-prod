import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // hide the bottom-left Next.js dev "N" badge

  // Next 16 blocks cross-origin dev-resource requests by default; a browser
  // hitting the dev server on 127.0.0.1 (not "localhost") then can't load the
  // client JS chunks and client components silently never mount. Allow the
  // loopback aliases so `npm run dev` works from either hostname.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Don't advertise the framework/version on every response (info disclosure -
  // flagged by scripts/security-scan.mjs).
  poweredByHeader: false,

  /* Pin the workspace root to this project.
   *
   * There is a stray package-lock.json in the home directory, and Turbopack's
   * root inference picks the outermost lockfile it can find -- so every `next
   * dev` was rooting the workspace at /Users/<name> and watching the entire
   * home directory. That is the single biggest cause of the dev server
   * crawling on startup and after each edit. */
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // camera/microphone intentionally not denied — the Jitsi iframe needs delegation
          { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
