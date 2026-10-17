import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { supabaseAdmin } from "@/lib/db/client";
import { formatCompact, formatUsd, shortAddress, sanitizeSearchQuery } from "@/lib/format";

export default async function ExplorePage({
  params,
  searchParams,
}: PageProps<"/[locale]/explore">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("explore");
  const sp = await searchParams;
  const q = (sp?.q ?? "").toString().trim();
  const sort = (sp?.sort ?? "new").toString() === "top" ? "top" : "new";

  const items = await loadTokens(q, sort);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl sm:text-4xl">{t("title")}</h1>
        <Link href="/create" className="btn btn-primary">
          + Create
        </Link>
      </div>

      <form className="flex flex-wrap gap-3" action="/explore" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          className="input max-w-md flex-1"
        />
        <select name="sort" defaultValue={sort} className="input w-auto">
          <option value="new">{t("sortNew")}</option>
          <option value="top">{t("sortTop")}</option>
        </select>
        <button className="btn btn-dark">→</button>
      </form>

      {items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm font-semibold text-muted-ink">{t("empty")}</p>
          <Link href="/create" className="btn btn-primary mt-4 inline-flex">
            {t("emptyAction")}
          </Link>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.mint}>
              <Link
                href={`/token/${item.mint}`}
                className="card flex h-full flex-col gap-3 p-4 transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3">
                  {item.logo_uri ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.logo_uri} alt="" className="h-12 w-12 rounded-xl border-2 border-black object-cover" />
                  ) : (
                    <div className="display flex h-12 w-12 items-center justify-center rounded-xl border-2 border-black bg-[#ede9fe] text-sm">
                      {item.symbol.slice(0, 3)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-bold">{item.name}</p>
                    <p className="text-xs font-bold uppercase text-muted-ink">${item.symbol}</p>
                  </div>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border-2 border-black bg-[#f5f3ff] px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">Price</p>
                    <p className="font-bold">
                      {item.price_usd ? formatUsd(item.price_usd) : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border-2 border-black bg-[#f5f3ff] px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">Liquidity</p>
                    <p className="font-bold">
                      {item.liquidity_usd ? `$${formatCompact(item.liquidity_usd)}` : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-ink">
                  <span className="mono">{shortAddress(item.mint, 4)}</span>
                  <span
                    className={
                      item.change24h === null
                        ? ""
                        : item.change24h >= 0
                          ? "font-bold text-[#15803d]"
                          : "font-bold text-[#b91c1c]"
                    }
                  >
                    {item.change24h === null
                      ? ""
                      : `${item.change24h >= 0 ? "+" : ""}${item.change24h.toFixed(1)}%`}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TokenItem {
  mint: string;
  name: string;
  symbol: string;
  logo_uri: string | null;
  price_usd: number | null;
  liquidity_usd: number | null;
  change24h: number | null;
}

async function loadTokens(rawQ: string, sort: "new" | "top"): Promise<TokenItem[]> {
  try {
    const q = sanitizeSearchQuery(rawQ);
    const db = supabaseAdmin();
    let query = db
      .from("tokens")
      .select("mint, name, symbol, logo_uri, created_at")
      .eq("status", "live")
      .eq("kind", "mainnet")
      .order("created_at", { ascending: false })
      .limit(90);
    if (q) {
      query = query.or(`name.ilike.%${q}%,symbol.ilike.%${q}%,mint.eq.${q}`);
    }
    const { data: tokens } = await query;
    if (!tokens?.length) return [];

    const mints = tokens.map((t) => t.mint);
    const { data: snaps } = await db
      .from("price_snapshots")
      .select("mint, ts, price_usd, liquidity_usd")
      .in("mint", mints)
      .order("ts", { ascending: false })
      .limit(600);

    const latest = new Map<string, { price: number | null; liq: number | null; ts: string }>();
    const dayAgo = new Map<string, number>();
    const cutoff = Date.now() - 23.5 * 3600_000;
    for (const s of snaps ?? []) {
      if (!latest.has(s.mint)) {
        latest.set(s.mint, { price: s.price_usd, liq: s.liquidity_usd, ts: s.ts });
      }
      if (new Date(s.ts).getTime() <= cutoff && !dayAgo.has(s.mint)) {
        dayAgo.set(s.mint, s.price_usd ?? 0);
      }
    }

    const items: TokenItem[] = tokens.map((t) => {
      const l = latest.get(t.mint);
      const prev = dayAgo.get(t.mint);
      const change =
        l?.price && prev ? ((l.price - prev) / prev) * 100 : null;
      return {
        mint: t.mint,
        name: t.name,
        symbol: t.symbol,
        logo_uri: t.logo_uri,
        price_usd: l?.price ?? null,
        liquidity_usd: l?.liq ?? null,
        change24h: change,
      };
    });

    if (sort === "top") {
      items.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity));
    }
    return items;
  } catch {
    return [];
  }
}
