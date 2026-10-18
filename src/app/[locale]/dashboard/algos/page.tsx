import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import type { AlgoRow } from "@/lib/algos";
import { AlgoManager, type ManagedAlgo } from "@/components/algos/algo-manager";

export default async function DashboardAlgosPage({ params }: PageProps<"/[locale]/dashboard/algos">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("algos.manage");
  const user = await requireUser();
  if (!user) return null;

  const db = supabaseAdmin();
  const { data } = await db
    .from("algos")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const algos = (data ?? []) as AlgoRow[];
  const ids = algos.map((a) => a.id);

  const [subsRes, msgsRes] = await Promise.all([
    ids.length
      ? db.from("algo_subscriptions").select("algo_id").eq("status", "active").in("algo_id", ids)
      : Promise.resolve({ data: [] as { algo_id: string }[] }),
    ids.length
      ? db.from("algo_messages").select("algo_id, created_at").in("algo_id", ids).order("created_at", { ascending: false }).limit(ids.length * 5)
      : Promise.resolve({ data: [] as { algo_id: string; created_at: string }[] }),
  ]);
  const subCount = new Map<string, number>();
  for (const s of subsRes.data ?? []) subCount.set(s.algo_id, (subCount.get(s.algo_id) ?? 0) + 1);
  const msgCount = new Map<string, number>();
  for (const m of msgsRes.data ?? []) msgCount.set(m.algo_id, (msgCount.get(m.algo_id) ?? 0) + 1);

  const items: ManagedAlgo[] = algos.map((algo) => ({
    algo,
    subCount: subCount.get(algo.id) ?? 0,
    msgCount: msgCount.get(algo.id) ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl sm:text-4xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("subtitle")}</p>
      </div>
      <AlgoManager initialItems={items} />
    </div>
  );
}
