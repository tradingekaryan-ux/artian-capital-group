import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { USDC_MINT as USDC_MINT_LOCAL } from "@/lib/config";
import { ensureWallet, readOnChainBalances } from "@/lib/solana/wallet";
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

  const wallet = await ensureWallet(user.id);
  const balances = await readOnChainBalances(wallet.public_key).catch(() => ({
    usdcRaw: 0n,
    solLamports: 0n,
  }));
  const withdrawFee = await getPrice("withdraw");
  const swapFee = await getPrice("swap");
  const events = await loadEvents(user.id);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <section className="card p-5">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted">{t("usdcBalance")}</p>
              <p className="mt-1 text-2xl font-bold">
                {formatNumber(Number(balances.usdcRaw) / 1e6, 4)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">{t("solBalance")}</p>
              <p className="mt-1 text-2xl font-bold">
                {formatNumber(Number(balances.solLamports) / 1e9, 4)}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <p className="label">{t("address")}</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-2">
              <span className="mono min-w-0 flex-1 truncate text-sm">{wallet.public_key}</span>
              <CopyButton value={wallet.public_key} />
            </div>
            <p className="mt-2 text-xs text-muted">{t("depositHint")}</p>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">{t("withdraw")}</h2>
          <WithdrawCard feeUsdc={withdrawFee.flat_usdc ?? withdrawFee.amount_usdc ?? 0.5} />
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">{t("swap")}</h2>
          <SwapCard feePercent={swapFee.percent ?? 0.3} />
        </section>
      </div>

      <section className="card h-fit p-5">
        <h2 className="font-semibold">{t("recentEvents")}</h2>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noEvents")}</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-border text-sm">
            {events.map((ev) => {
              const raw = Number(ev.amount_raw);
              const isUsdc = !ev.mint || ev.mint === USDC_MINT_LOCAL;
              const amount = isUsdc ? Math.abs(raw) / 1e6 : Math.abs(raw);
              const negative = raw < 0;
              return (
                <li key={ev.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-medium capitalize">{ev.type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted">{formatDate(ev.confirmed_at)}</p>
                  </div>
                  <span className={negative ? "text-danger" : "text-accent"}>
                    {negative ? "−" : "+"}
                    {formatNumber(amount, 4)} {isUsdc ? "USDC" : "SPL"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

async function loadEvents(userId: string) {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("wallet_events")
      .select("id, type, mint, amount_raw, confirmed_at")
      .eq("user_id", userId)
      .order("confirmed_at", { ascending: false })
      .limit(20);
    return data ?? [];
  } catch {
    return [];
  }
}
