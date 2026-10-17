import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicKey } from "@solana/web3.js";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { getActiveWallet } from "@/lib/solana/wallet";
import { listTokenHoldings } from "@/lib/chain/holdings";
import { getPrice } from "@/lib/payment/pricing";
import { BurnCard, type Holding } from "@/components/wallet/burn-card";
import { formatNumber, formatDate, shortAddress } from "@/lib/format";

export default async function BurnPage({ params, searchParams }: PageProps<"/[locale]/dashboard/burn">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const mode = sp?.mode === "earn" ? "burn_earn" : "burn";
  const t = await getTranslations("burn");
  const user = await requireUser();
  if (!user) return null;

  const wallet = await getActiveWallet(user.id).catch(() => null);
  const isDemo = wallet?.kind === "demo";

  const [priceBurn, priceEarn] = await Promise.all([getPrice("burn"), getPrice("burn_earn")]);
  const feeBurnUsdc = priceBurn.flat_usdc ?? priceBurn.amount_usdc ?? 0;
  const feeEarnUsdc = priceEarn.flat_usdc ?? priceEarn.amount_usdc ?? 0;

  const holdings: Holding[] = [];
  const meta: Record<string, { name: string; symbol: string }> = {};
  const events: {
    mode: string;
    amount_ui: number;
    points: number;
    mint: string;
    tx: string | null;
    created_at: string;
  }[] = [];
  let totalPoints = 0;

  if (wallet && !isDemo) {
    try {
      const [held, owned] = await Promise.all([
        listTokenHoldings(new PublicKey(wallet.public_key), "mainnet"),
        supabaseAdmin()
          .from("tokens")
          .select("mint, name, symbol")
          .eq("user_id", user.id)
          .limit(200),
      ]);
      for (const h of held) {
        holdings.push({ mint: h.mint, amount: h.amountRaw.toString(), decimals: h.decimals });
      }
      for (const row of owned.data ?? []) {
        meta[row.mint] = { name: row.name, symbol: row.symbol };
      }
    } catch (e) {
      console.error("[burn] load holdings failed:", e);
    }
    try {
      const db = supabaseAdmin();
      const { data: rows } = await db
        .from("burn_events")
        .select("mode, amount_ui, points, mint, tx, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const r of rows ?? []) {
        events.push(r);
        totalPoints += Number(r.points ?? 0);
      }
    } catch (e) {
      console.error("[burn] load rewards failed:", e);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("title")}</span>
        </div>
        <div className="p-5">
          {isDemo ? (
            <p className="text-sm font-bold">{t("demoNotice")}</p>
          ) : (
            <BurnCard
              key={mode}
              holdings={holdings}
              meta={meta}
              feeBurnUsdc={feeBurnUsdc}
              feeEarnUsdc={feeEarnUsdc}
              initialMode={mode}
            />
          )}
        </div>
      </section>

      {!isDemo && (
        <section className="card overflow-hidden">
          <div className="chrome">
            <span className="chrome-dots"><span /><span /><span /></span>
            <span className="text-muted-ink">{t("rewardsTitle")}</span>
          </div>
          <div className="p-5">
            <div className="rounded-xl border-2 border-black bg-[#f5f3ff] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                {t("rewardsTotal")}
              </p>
              <p className="display mt-1 text-3xl">{formatNumber(totalPoints, 0)}</p>
            </div>
            <p className="label mt-5">{t("historyTitle")}</p>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-muted-ink">{t("noHistory")}</p>
            ) : (
              <ul className="mt-2 flex flex-col divide-y divide-black/10 text-sm">
                {events.slice(0, 20).map((ev, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {Number(ev.amount_ui).toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
                        <span className="mono text-xs text-muted-ink">{shortAddress(ev.mint, 4)}</span>
                      </p>
                      <p className="text-xs text-muted-ink">{formatDate(ev.created_at)}</p>
                    </div>
                    <div className="text-right">
                      {Number(ev.points) > 0 && (
                        <p className="font-bold text-[#15803d]">+{formatNumber(Number(ev.points), 0)} pt</p>
                      )}
                      {ev.tx && (
                        <a
                          href={`https://explorer.solana.com/tx/${ev.tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-bold underline"
                        >
                          {t("viewTx")}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
