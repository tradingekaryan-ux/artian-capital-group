import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { formatNumber, shortAddress } from "@/lib/format";
import { getPrice } from "@/lib/payment/pricing";
import { getActiveWallet } from "@/lib/solana/wallet";
import { explorerClusterParam } from "@/lib/config";
import { PoolPanel } from "@/components/pools/pool-panel";

interface PoolRow {
  id: string;
  pool_id: string | null;
  status: string;
  quote_amount: string | null;
  initial_price: string | null;
}

export default async function MyTokensPage({ params }: PageProps<"/[locale]/dashboard/tokens">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const user = await requireUser();
  if (!user) return null;

  const active = await getActiveWallet(user.id).catch(() => null);
  const kind = active?.kind ?? ("mainnet" as const);
  const explorerCluster = explorerClusterParam(kind);

  const db = supabaseAdmin();
  const [{ data: tokens }, poolPrice, addLiqPrice] = await Promise.all([
    db
      .from("tokens")
      .select(
        "id, mint, name, symbol, supply, decimals, created_at, logo_uri, status, pools(id, pool_id, status, quote_amount, initial_price)",
      )
      .eq("user_id", user.id)
      .eq("kind", kind)
      .order("created_at", { ascending: false }),
    getPrice("create_pool").catch(() => ({ amount_usdc: 10 })),
    getPrice("add_liquidity").catch(() => ({ amount_usdc: 1 })),
  ]);

  const list = (tokens ?? []) as Array<{
    id: string;
    mint: string;
    name: string;
    symbol: string;
    supply: string | number;
    decimals: number;
    created_at: string;
    logo_uri: string | null;
    status: string;
    pools: PoolRow[] | null;
  }>;

  return (
    <section className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /><span /></span>
        <span className="text-muted-ink">{t("recentTokens")}</span>
      </div>
      <div className="p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">{t("recentTokens")}</h1>
        <Link href="/create" className="btn btn-primary !px-4 !py-1.5 !text-xs">
          + {t("quickCreate")}
        </Link>
      </div>
      {!list.length ? (
        <p className="mt-4 text-sm text-muted-ink">{t("noTokens")}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-black/10">
          {list.map((tok) => {
            const pool = tok.pools?.[0] ?? null;
            const hasPool = pool?.status === "active" && !!pool.pool_id;
            return (
              <li key={tok.mint} className="py-3">
                <div className="flex items-center gap-3">
                  {tok.logo_uri ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tok.logo_uri} alt="" className="h-10 w-10 rounded-xl border-2 border-black object-cover" />
                  ) : (
                    <div className="display flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-[#ede9fe] text-xs">
                      {tok.symbol.slice(0, 3)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/token/${tok.mint}`} className="font-bold hover:underline decoration-2 underline-offset-2">
                      {tok.name} <span className="font-medium text-muted-ink">({tok.symbol})</span>
                    </Link>
                    <p className="mono text-xs text-muted-ink">{shortAddress(tok.mint, 6)}</p>
                  </div>
                  {kind === "demo" && (
                    <span className="rounded-full border-2 border-black bg-[#d8ff3e] px-2 py-0.5 text-[10px] font-bold uppercase">
                      Demo
                    </span>
                  )}
                  <span
                    className={`badge !shadow-none ${
                      hasPool ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#f4f4f5] text-muted-ink"
                    }`}
                  >
                    {hasPool ? t("poolActive") : t("noPoolYet")}
                  </span>
                  <div className="w-28 text-right text-sm">
                    <p className="font-bold">{formatNumber(Number(tok.supply), 0)}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">supply</p>
                  </div>
                  <details className="group relative">
                    <summary className="btn btn-secondary !px-3 !py-1.5 !text-xs cursor-pointer list-none">
                      {t("managePool")} ▾
                    </summary>
                    <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-2xl border-2 border-black bg-white p-4 shadow-[4px_4px_0_#000]">
                      {hasPool && pool?.pool_id ? (
                        <p className="mono mb-3 text-xs text-muted-ink">
                          Pool: {shortAddress(pool.pool_id, 8)}
                          {" · "}
                          <a
                            href={`https://explorer.solana.com/address/${pool.pool_id}?cluster=${explorerCluster}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold underline decoration-2 underline-offset-2"
                          >
                            explorer ↗
                          </a>
                        </p>
                      ) : null}
                      <PoolPanel
                        tokenId={tok.id}
                        mint={tok.mint}
                        symbol={tok.symbol}
                        decimals={tok.decimals}
                        supply={String(tok.supply)}
                        isOwner
                        poolId={pool?.id ?? null}
                        poolAddress={pool?.pool_id ?? null}
                        hasPool={!!hasPool}
                        poolFeeUsdc={poolPrice.amount_usdc ?? 10}
                        addLiquidityFeeUsdc={addLiqPrice.amount_usdc ?? 1}
                        kind={kind}
                      />
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </section>
  );
}
