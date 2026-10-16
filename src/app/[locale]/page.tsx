import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { supabaseServer } from "@/lib/db/client";
import { formatCompact } from "@/lib/format";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");

  const stats = await fetchStats();

  return (
    <div className="flex flex-col gap-20">
      <section className="pt-10 text-center sm:pt-16">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Solana · USDC · zero infra fees
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-muted sm:text-lg">{t("heroSubtitle")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/create" className="btn btn-primary !px-6 !py-3 text-base">
            {t("ctaCreate")}
          </Link>
          <Link href="/explore" className="btn btn-secondary !px-6 !py-3 text-base">
            {t("ctaExplore")}
          </Link>
        </div>

        <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-4">
          <Stat label={t("statTokens")} value={formatCompact(stats.tokens)} />
          <Stat label={t("statUsers")} value={formatCompact(stats.users)} />
          <Stat label={t("statTvl")} value={`$${formatCompact(stats.tvlUsd)}`} />
        </dl>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Feature title={t("featureTokenTitle")} body={t("featureTokenBody")} />
        <Feature title={t("featurePoolTitle")} body={t("featurePoolBody")} />
        <Feature title={t("featureMarketTitle")} body={t("featureMarketBody")} />
        <Feature title={t("featureWalletTitle")} body={t("featureWalletBody")} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-5">
      <dd className="text-2xl font-bold sm:text-3xl">{value}</dd>
      <dt className="mt-1 text-xs text-muted">{label}</dt>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

async function fetchStats() {
  try {
    const supabase = await supabaseServer();
    const [tokens, users] = await Promise.all([
      supabase.from("tokens").select("mint", { count: "exact", head: true }),
      supabase.from("wallets").select("user_id", { count: "exact", head: true }),
    ]);
    const { data: pools } = await supabase
      .from("pools")
      .select("liquidity_usd")
      .limit(500);
    const tvlUsd = (pools ?? []).reduce(
      (sum, p) => sum + (Number(p.liquidity_usd) || 0),
      0,
    );
    return {
      tokens: tokens.count ?? 0,
      users: users.count ?? 0,
      tvlUsd,
    };
  } catch {
    return { tokens: 0, users: 0, tvlUsd: 0 };
  }
}
