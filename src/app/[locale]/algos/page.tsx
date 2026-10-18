import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { supabaseAdmin } from "@/lib/db/client";
import type { AlgoRow } from "@/lib/algos";

const PAGE_SIZE = 24;

export default async function AlgosPage({
  params,
  searchParams,
}: PageProps<"/[locale]/algos">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("algos");
  const sp = await searchParams;
  const q = (sp?.q ?? "").toString().trim();
  const page = Math.max(1, Number(sp?.page ?? "1") || 1);

  const db = supabaseAdmin();
  let query = db.from("algos").select("*").eq("is_active", true).order("created_at", { ascending: false });
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const from = (page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);
  const { data } = await query;
  const algos = (data ?? []) as AlgoRow[];

  const ids = algos.map((a) => a.id);
  const userIds = [...new Set(algos.map((a) => a.user_id))];
  const [creatorsRes, subsRes, msgsRes] = await Promise.all([
    userIds.length
      ? db.from("profiles").select("user_id, username, display_name").in("user_id", userIds)
      : Promise.resolve({ data: [] as { user_id: string; username: string | null; display_name: string | null }[] }),
    ids.length
      ? db.from("algo_subscriptions").select("algo_id").eq("status", "active").in("algo_id", ids)
      : Promise.resolve({ data: [] as { algo_id: string }[] }),
    ids.length
      ? db.from("algo_messages").select("algo_id, text, created_at").in("algo_id", ids).order("created_at", { ascending: false }).limit(ids.length * 3)
      : Promise.resolve({ data: [] as { algo_id: string; text: string; created_at: string }[] }),
  ]);
  const creators = new Map((creatorsRes.data ?? []).map((c) => [c.user_id, c]));
  const subCount = new Map<string, number>();
  for (const s of subsRes.data ?? []) subCount.set(s.algo_id, (subCount.get(s.algo_id) ?? 0) + 1);
  const lastMsg = new Map<string, { text: string; created_at: string }>();
  for (const m of msgsRes.data ?? []) if (!lastMsg.has(m.algo_id)) lastMsg.set(m.algo_id, m);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-ink">{t("subtitle")}</p>
        </div>
        <Link href="/dashboard/algos" className="btn btn-primary">
          {t("createCta")}
        </Link>
      </div>

      <form className="flex flex-wrap gap-3" action="/algos" method="get">
        <input name="q" defaultValue={q} placeholder={t("search")} className="input max-w-md flex-1" />
        <button className="btn btn-dark">→</button>
      </form>

      {algos.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-semibold text-muted-ink">{t("empty")}</p>
          <Link href="/dashboard/algos" className="btn btn-primary mt-4 inline-flex">
            {t("emptyAction")}
          </Link>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {algos.map((algo) => {
            const creator = creators.get(algo.user_id);
            const price = Number(algo.price_usdc);
            const last = lastMsg.get(algo.id);
            return (
              <li key={algo.id}>
                <Link
                  href={`/algos/${algo.id}`}
                  className="card flex h-full flex-col gap-3 p-4 transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-bold leading-tight">{algo.name}</h2>
                    <span
                      className={`badge whitespace-nowrap ${price === 0 ? "bg-[#d8ff3e]" : ""}`}
                    >
                      {price === 0
                        ? t("priceFree")
                        : algo.billing === "monthly"
                          ? t("priceMonthly", { price: String(price) })
                          : t("priceOnce", { price: String(price) })}
                    </span>
                  </div>
                  {algo.description ? (
                    <p className="line-clamp-3 text-sm text-muted-ink">{algo.description}</p>
                  ) : null}
                  {last ? (
                    <p className="line-clamp-2 rounded-xl border-2 border-black bg-white px-3 py-2 text-xs font-semibold">
                      {last.text}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-ink">
                    <span>
                      {t("by")} @{creator?.username ?? "—"}
                    </span>
                    <span>
                      {subCount.get(algo.id) ?? 0} {t("subs")}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {page > 1 || algos.length === PAGE_SIZE ? (
        <div className="flex justify-center gap-3">
          {page > 1 ? (
            <Link href={`/algos?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn btn-secondary">
              ←
            </Link>
          ) : null}
          {algos.length === PAGE_SIZE ? (
            <Link href={`/algos?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn btn-secondary">
              →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
