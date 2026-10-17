import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { SITE } from "@/lib/config";
import { supabaseAdmin } from "@/lib/db/client";

const STATIC_PATHS = [
  { path: "", priority: 1 as const, changeFrequency: "daily" as const },
  { path: "/explore", priority: 0.9 as const, changeFrequency: "hourly" as const },
  { path: "/create", priority: 0.8 as const, changeFrequency: "monthly" as const },
  { path: "/login", priority: 0.5 as const, changeFrequency: "yearly" as const },
  { path: "/register", priority: 0.5 as const, changeFrequency: "yearly" as const },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const base = SITE.url;

  const pages: MetadataRoute.Sitemap = routing.locales.flatMap((locale) =>
    STATIC_PATHS.map(({ path, priority, changeFrequency }) => ({
      url: `${base}/${locale}${path}`,
      lastModified: now,
      changeFrequency,
      priority,
    })),
  );

  let tokens: { mint: string; created_at: string }[] = [];
  try {
    const { data, error } = await supabaseAdmin()
      .from("tokens")
      .select("mint, created_at")
      .eq("status", "live")
      .eq("kind", "mainnet")
      .order("created_at", { ascending: false })
      .limit(4000);
    if (!error) tokens = data ?? [];
  } catch {
    tokens = [];
  }

  const tokenPages: MetadataRoute.Sitemap = routing.locales.flatMap((locale) =>
    tokens.map((token) => ({
      url: `${base}/${locale}/token/${token.mint}`,
      lastModified: new Date(token.created_at),
      changeFrequency: "hourly" as const,
      priority: 0.6,
    })),
  );

  return [...pages, ...tokenPages];
}
