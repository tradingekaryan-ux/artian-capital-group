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
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // URL bersih tanpa prefix locale (satu bahasa: English).
  // Redirect legacy /en/* & /id/* → versi tanpa prefix; rewrite halaman app
  // → segmen [locale] internal. Urutan Next: redirects dulu, lalu rewrites.
  async redirects() {
    return [
      { source: "/en", destination: "/", permanent: true },
      { source: "/en/:path*", destination: "/:path*", permanent: true },
      { source: "/id", destination: "/", permanent: true },
      { source: "/id/:path*", destination: "/:path*", permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/en" }],
      afterFiles: [
        { source: "/login", destination: "/en/login" },
        { source: "/register", destination: "/en/register" },
        { source: "/create", destination: "/en/create" },
        { source: "/create/:path*", destination: "/en/create/:path*" },
        { source: "/explore", destination: "/en/explore" },
        { source: "/explore/:path*", destination: "/en/explore/:path*" },
        { source: "/algos", destination: "/en/algos" },
        { source: "/algos/:path*", destination: "/en/algos/:path*" },
        { source: "/events", destination: "/en/events" },
        { source: "/events/:path*", destination: "/en/events/:path*" },
        { source: "/faq", destination: "/en/faq" },
        { source: "/dashboard", destination: "/en/dashboard" },
        { source: "/dashboard/:path*", destination: "/en/dashboard/:path*" },
        { source: "/token/:path*", destination: "/en/token/:path*" },
        { source: "/admin", destination: "/en/admin" },
        { source: "/admin/:path*", destination: "/en/admin/:path*" },
        { source: "/verify", destination: "/en/verify" },
        { source: "/verify/:path*", destination: "/en/verify/:path*" },
      ],
      fallback: [],
    };
  },
};

export default withNextIntl(nextConfig);

// Catatan: initOpenNextCloudflareForDev() sengaja TIDAK dipanggil — app tidak
// memakai binding Cloudflare lokal, dan workerd tidak bisa jalan di macOS 12.6.
// Tambahkan kembali bila dev machine ≥ macOS 13.5 / Linux dan butuh binding.
