import { setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { evaluateAchievements, type AchievementTally } from "@/lib/achievements";
import { CertificatesView } from "@/components/certificates/certificates-view";

/**
 * Sertifikat pencapaian — dihitung langsung dari dataExisting (tanpa tabel baru):
 * token LIVE per kind (`tokens.kind='mainnet'|'demo'`), jumlah `algos`, dan
 * waktu registrasi dari `profiles`. Semua sertifikat tampil (locked bila belum).
 */
export default async function DashboardCertificatesPage({
  params,
}: PageProps<"/[locale]/dashboard/certificates">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  if (!user) return null;

  const db = supabaseAdmin();
  const [devnet, mainnet, algos, profile] = await Promise.all([
    db
      .from("tokens")
      .select("created_at", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("kind", "demo")
      .eq("status", "live"),
    db
      .from("tokens")
      .select("created_at", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("kind", "mainnet")
      .eq("status", "live"),
    db.from("algos").select("created_at", { count: "exact", head: true }).eq("user_id", user.id),
    db.from("profiles").select("created_at").eq("user_id", user.id).maybeSingle(),
  ]);

  /** Waktu capaian pertama kategori (token/algo paling awal) — utk tanggal sertifikat. */
  const firstAt = async (table: "tokens" | "algos", kind: "mainnet" | "demo" | null) => {
    let q = db
      .from(table)
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    if (table === "tokens") q = q.eq("kind", kind ?? "mainnet").eq("status", "live");
    const { data } = await q.maybeSingle();
    return (data as { created_at?: string } | null)?.created_at ?? null;
  };

  const tally: AchievementTally = {
    tokenDevnet: devnet.count ?? 0,
    tokenMainnet: mainnet.count ?? 0,
    algo: algos.count ?? 0,
    memberSince:
      ((profile as { created_at?: string } | null)?.created_at) ?? new Date(0).toISOString(),
    tokenDevnetAt: (devnet.count ?? 0) > 0 ? await firstAt("tokens", "demo") : null,
    tokenMainnetAt: (mainnet.count ?? 0) > 0 ? await firstAt("tokens", "mainnet") : null,
    algoAt: (algos.count ?? 0) > 0 ? await firstAt("algos", null) : null,
  };

  return <CertificatesView items={evaluateAchievements(tally)} />;
}
