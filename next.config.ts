import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Header keamanan global (PRD §8 checklist produksi). */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://*.posthog.com https://*.helius-rpc.com https://api.mainnet-beta.solana.com https://api.devnet.solana.com",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // cacheComponents dimatikan agar model ISR klasik (export const revalidate)
  // dan halaman dinamis DB tetap didukung tanpa syarat Suspense (lihat docs Next 16).
  serverExternalPackages: [
    "@raydium-io/raydium-sdk-v2",
    "@metaplex-foundation/mpl-token-metadata",
    "@metaplex-foundation/umi-bundle-defaults",
    "@solana/web3.js",
    "@solana/spl-token",
    "@supabase/supabase-js",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);

// Catatan: initOpenNextCloudflareForDev() sengaja TIDAK dipanggil — app tidak
// memakai binding Cloudflare lokal, dan workerd tidak bisa jalan di macOS 12.6.
// Tambahkan kembali bila dev machine ≥ macOS 13.5 / Linux dan butuh binding.
