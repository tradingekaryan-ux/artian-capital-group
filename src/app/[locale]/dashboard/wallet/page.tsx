import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { usdcMintFor, explorerClusterParam, type WalletKind } from "@/lib/config";
import { getActiveWallet, readOnChainBalances } from "@/lib/solana/wallet";
import { getPrice } from "@/lib/payment/pricing";
import { CopyButton } from "@/components/copy-button";
import { WithdrawCard } from "@/components/wallet/withdraw-card";
import { SwapCard } from "@/components/wallet/swap-card";
import { formatNumber, formatDate } from "@/lib/format";

export default async function WalletPage({ params }: PageProps<"/[locale]/dashboard/wallet">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("wallet");
  const user = await requireUser();
  if (!user) return null;

  const wallet = await getActiveWallet(user.id);
  const kind: WalletKind = wallet.kind;
  const isDemo = kind === "demo";
  const balances = await readOnChainBalances(wallet.public_key, kind).catch(() => ({
    usdcRaw: 0n,
    solLamports: 0n,
  }));
  const withdrawFee = await getPrice("withdraw");
  const swapFee = await getPrice("swap");
  const events = await loadEvents(user.id, wallet.id);
  const usdcMint = usdcMintFor(kind);
  const explorerCluster = explorerClusterParam(kind);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        {isDemo && (
          <section className="card overflow-hidden border-[#7c3aed] bg-[#f5f3ff]">
            <div className="chrome">
              <span className="chrome-dots"><span /><span /></span>
              <span className="text-muted-ink">{t("demo.title")}</span>
            </div>
            <div className="flex flex-col gap-3 p-5 text-sm">
              <p className="font-bold">{t("demo.banner")}</p>
              <div className="rounded-xl border-2 border-black bg-white p-3">
                <p className="label">{t("demo.faucetTitle")}</p>
                <p className="mt-2 text-xs text-muted-ink">{t("demo.faucetHint")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href="https://faucet.solana.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border-2 border-black bg-[#d8ff3e] px-3 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_0_#000] hover:-translate-y-0.5"
                  >
                    {t("demo.faucetSol")}
                  </a>
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_0_#000] hover:-translate-y-0.5"
                  >
                    {t("demo.faucetUsdc")}
                  </a>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="chrome">
            <span className="chrome-dots"><span /><span /><span /></span>
            <span className="text-muted-ink">
              {t("title")}
              {isDemo && (
                <span className="ml-2 rounded-full border-2 border-black bg-[#d8ff3e] px-2 py-0.5 text-[10px] font-bold uppercase">
                  {t("switcher.demoBadge")}
                </span>
              )}
            </span>
          </div>
          <div className="p-5">
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div className="rounded-xl border-2 border-black bg-[#f5f3ff] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                {t("usdcBalance")}
                {isDemo ? " (devnet)" : ""}
              </p>
              <p className="display mt-1 text-3xl">
                {formatNumber(Number(balances.usdcRaw) / 1e6, 4)}
              </p>
            </div>
            <div className="rounded-xl border-2 border-black bg-[#f5f3ff] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                {t("solBalance")}
                {isDemo ? " (devnet)" : ""}
              </p>
              <p className="display mt-1 text-3xl">
                {formatNumber(Number(balances.solLamports) / 1e9, 4)}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <p className="label">{t("address")}</p>
            <div className="flex items-center gap-2 rounded-xl border-2 border-black bg-[#f5f3ff] p-2">
              <span className="mono min-w-0 flex-1 truncate text-sm font-bold">{wallet.public_key}</span>
              <CopyButton value={wallet.public_key} />
            </div>
            <p className="mt-2 text-xs text-muted-ink">
              {isDemo ? t("demo.faucetHint") : t("depositHint")}
            </p>
            {isDemo && (
              <a
                href={`https://explorer.solana.com/address/${wallet.public_key}?cluster=${explorerCluster}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs font-bold underline"
              >
                Solana Explorer (devnet)
              </a>
            )}
          </div>
          </div>
        </section>

        {isDemo ? (
          <>
            <p className="text-sm font-bold text-muted-ink">{t("demo.noWithdraw")}</p>
            <p className="text-sm font-bold text-muted-ink">{t("demo.noSwap")}</p>
          </>
        ) : (
          <>
            <section className="card overflow-hidden">
              <div className="chrome">
                <span className="chrome-dots"><span /><span /></span>
                <span className="text-muted-ink">{t("withdraw")}</span>
              </div>
              <div className="p-5">
                <WithdrawCard feeUsdc={withdrawFee.flat_usdc ?? withdrawFee.amount_usdc ?? 0.5} />
              </div>
            </section>

            <section className="card overflow-hidden">
              <div className="chrome">
                <span className="chrome-dots"><span /><span /></span>
                <span className="text-muted-ink">{t("swap")}</span>
              </div>
              <div className="p-5">
                <SwapCard feePercent={swapFee.percent ?? 0.3} />
              </div>
            </section>
          </>
        )}
      </div>

      <section className="card h-fit overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("recentEvents")}</span>
        </div>
        <div className="p-5">
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-ink">{t("noEvents")}</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-black/10 text-sm">
            {events.map((ev) => {
              const raw = Number(ev.amount_raw);
              const isUsdc = !ev.mint || ev.mint === usdcMint;
              const amount = isUsdc ? Math.abs(raw) / 1e6 : Math.abs(raw);
              const negative = raw < 0;
              return (
                <li key={ev.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-bold capitalize">{ev.type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-ink">{formatDate(ev.confirmed_at)}</p>
                  </div>
                  <span className={`font-bold ${negative ? "text-[#b91c1c]" : "text-[#15803d]"}`}>
                    {negative ? "−" : "+"}
                    {formatNumber(amount, 4)} {isUsdc ? "USDC" : "SPL"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </section>
    </div>
  );
}

async function loadEvents(userId: string, walletId: string) {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("wallet_events")
      .select("id, type, mint, amount_raw, confirmed_at")
      .eq("user_id", userId)
      .eq("wallet_id", walletId)
      .order("confirmed_at", { ascending: false })
      .limit(20);
    return data ?? [];
  } catch {
    return [];
  }
}
