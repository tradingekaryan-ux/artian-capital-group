import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { getActiveWallet, readOnChainBalances, getCachedBalance } from "@/lib/solana/wallet";
import { CopyButton } from "@/components/copy-button";
import { formatNumber, shortAddress } from "@/lib/format";

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const user = await requireUser();
  if (!user) return null;

  const { wallet, kind, balances, tokens } = await load(user.id);
  const username =
    (user.user_metadata?.username as string | undefined) ?? user.email?.split("@")[0] ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl">
            {t("welcome")}, {username}
          </h1>
          <p className="mt-1 text-sm font-semibold text-white/80">{user.email}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/create" className="btn btn-primary">
            {t("quickCreate")}
          </Link>
          <Link href="/dashboard/wallet" className="btn btn-secondary">
            {t("quickWallet")}
          </Link>
        </div>
      </div>

      <section className="grid gap-5 sm:grid-cols-3">
        <div className="card overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              USDC Balance{kind === "demo" ? " (devnet)" : ""}
            </p>
            <p className="display mt-1 text-3xl">{formatNumber(Number(balances.usdcRaw) / 1e6, 4)}</p>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              SOL{kind === "demo" ? " (devnet)" : ""}
            </p>
            <p className="display mt-1 text-3xl">{formatNumber(Number(balances.solLamports) / 1e9, 4)}</p>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              Wallet
              {kind === "demo" && (
                <span className="ml-2 rounded-full border-2 border-black bg-[#d8ff3e] px-2 py-0.5 text-[10px] font-bold uppercase">
                  Demo
                </span>
              )}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="mono text-sm font-bold">{shortAddress(wallet)}</span>
              <CopyButton value={wallet} />
            </div>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("recentTokens")}</span>
        </div>
        <div className="p-5">
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-ink">{t("noTokens")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/10">
              {tokens.map((tok) => (
                <li key={tok.mint} className="flex items-center justify-between py-2.5 text-sm">
                  <Link href={`/token/${tok.mint}`} className="font-bold hover:underline decoration-2 underline-offset-2">
                    {tok.name} <span className="font-medium text-muted-ink">({tok.symbol})</span>
                  </Link>
                  <span className="mono text-xs text-muted-ink">{shortAddress(tok.mint, 6)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

async function load(userId: string) {
  try {
    const wallet = await getActiveWallet(userId);
    const [balances, cached] = await Promise.all([
      readOnChainBalances(wallet.public_key, wallet.kind).catch(() => null),
      getCachedBalance(wallet.id).catch(() => null),
    ]);
    const db = supabaseAdmin();
    const { data: tokens } = await db
      .from("tokens")
      .select("mint, name, symbol")
      .eq("user_id", userId)
      .eq("kind", wallet.kind)
      .order("created_at", { ascending: false })
      .limit(5);
    return {
      wallet: wallet.public_key,
      kind: wallet.kind,
      balances: {
        usdcRaw: balances?.usdcRaw.toString() ?? cached?.usdc_raw ?? "0",
        solLamports: balances?.solLamports.toString() ?? cached?.sol_lamports ?? "0",
      },
      tokens: tokens ?? [],
    };
  } catch {
    return {
      wallet: "—",
      kind: "mainnet" as const,
      balances: { usdcRaw: "0", solLamports: "0" },
      tokens: [] as { mint: string; name: string; symbol: string }[],
    };
  }
}
