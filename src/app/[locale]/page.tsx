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
    <div className="flex flex-col gap-16">
      <section className="pt-6 text-center sm:pt-12">
        <p className="badge mx-auto mb-6">
          <span className="h-2 w-2 rounded-full bg-[#5b21b6]" />
          Solana · USDC · zero infra fees
        </p>
        <h1 className="mx-auto max-w-4xl text-4xl leading-[0.95] sm:text-6xl lg:text-7xl">
          <span className="hl">Launch your</span>
          <br />
          <span className="hl hl-lime">Solana token</span>
          <br />
          <span className="hl">in one place</span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-base font-medium text-white/90 sm:text-lg">
          {t("heroSubtitle")}
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-4">
          <Link href="/create" className="btn btn-primary !px-8 !py-3.5 !text-sm">
            {t("ctaCreate")} →
          </Link>
          <Link href="/explore" className="btn btn-dark !px-8 !py-3.5 !text-sm">
            {t("ctaExplore")}
          </Link>
        </div>

        <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-3 gap-4">
          <Stat label={t("statTokens")} value={formatCompact(stats.tokens)} />
          <Stat label={t("statUsers")} value={formatCompact(stats.users)} />
          <Stat label={t("statTvl")} value={`$${formatCompact(stats.tvlUsd)}`} />
        </dl>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <Feature
          index="01"
          title={t("featureTokenTitle")}
          body={t("featureTokenBody")}
        />
        <Feature
          index="02"
          title={t("featurePoolTitle")}
          body={t("featurePoolBody")}
        />
        <Feature
          index="03"
          title={t("featureMarketTitle")}
          body={t("featureMarketBody")}
        />
        <Feature
          index="04"
          title={t("featureWalletTitle")}
          body={t("featureWalletBody")}
        />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card overflow-hidden text-left">
      <div className="chrome">
        <span className="chrome-dots">
          <span />
          <span />
        </span>
      </div>
      <div className="px-4 py-4">
        <dd className="display text-2xl sm:text-3xl">{value}</dd>
        <dt className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-ink">
          {label}
        </dt>
      </div>
    </div>
  );
}

function Feature({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="text-muted-ink">{index}</span>
      </div>
      <div className="p-6">
        <h3 className="display text-xl">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-ink">{body}</p>
      </div>
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
