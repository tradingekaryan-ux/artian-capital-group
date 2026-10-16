import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
};

export default withNextIntl(nextConfig);

// Catatan: initOpenNextCloudflareForDev() sengaja TIDAK dipanggil — app tidak
// memakai binding Cloudflare lokal, dan workerd tidak bisa jalan di macOS 12.6.
// Tambahkan kembali bila dev machine ≥ macOS 13.5 / Linux dan butuh binding.
