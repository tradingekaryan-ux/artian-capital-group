import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { ensureWallet, readOnChainBalances, getCachedBalance } from "@/lib/solana/wallet";
import { CopyButton } from "@/components/copy-button";
import { formatNumber, shortAddress } from "@/lib/format";

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const user = await requireUser();
  if (!user) return null;

  const { wallet, balances, tokens } = await load(user.id);
  const username =
    (user.user_metadata?.username as string | undefined) ?? user.email?.split("@")[0] ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {t("welcome")}, {username}
          </h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/create" className="btn btn-primary">
            {t("quickCreate")}
          </Link>
          <Link href="/dashboard/wallet" className="btn btn-secondary">
            {t("quickWallet")}
          </Link>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs text-muted">USDC Balance</p>
          <p className="mt-1 text-2xl font-bold">{formatNumber(Number(balances.usdcRaw) / 1e6, 4)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-muted">SOL</p>
          <p className="mt-1 text-2xl font-bold">{formatNumber(Number(balances.solLamports) / 1e9, 4)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-muted">Wallet</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="mono text-sm">{shortAddress(wallet)}</span>
            <CopyButton value={wallet} />
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("recentTokens")}</h2>
          <Link href="/dashboard/tokens" className="text-sm text-accent hover:underline">
            →
          </Link>
        </div>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted">{t("noTokens")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {tokens.map((tok) => (
              <li key={tok.mint} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/token/${tok.mint}`} className="hover:text-accent">
                  {tok.name} <span className="text-muted">({tok.symbol})</span>
                </Link>
                <span className="mono text-xs text-muted">{shortAddress(tok.mint, 6)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function load(userId: string) {
  try {
    const wallet = await ensureWallet(userId);
    const [balances, cached] = await Promise.all([
      readOnChainBalances(wallet.public_key).catch(() => null),
      getCachedBalance(userId).catch(() => null),
    ]);
    const db = supabaseAdmin();
    const { data: tokens } = await db
      .from("tokens")
      .select("mint, name, symbol")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);
    return {
      wallet: wallet.public_key,
      balances: {
        usdcRaw: balances?.usdcRaw.toString() ?? cached?.usdc_raw ?? "0",
        solLamports: balances?.solLamports.toString() ?? cached?.sol_lamports ?? "0",
      },
      tokens: tokens ?? [],
    };
  } catch {
    return {
      wallet: "—",
      balances: { usdcRaw: "0", solLamports: "0" },
      tokens: [] as { mint: string; name: string; symbol: string }[],
    };
  }
}
