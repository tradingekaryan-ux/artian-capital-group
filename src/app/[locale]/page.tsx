import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { supabaseServer } from "@/lib/db/client";
import { formatCompact } from "@/lib/format";

export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");

  const stats = await fetchStats();
  const createBullets = t.raw("createBullets") as string[];
  const algoBullets = t.raw("algoBullets") as string[];

  return (
    <div className="flex flex-col gap-16">
      <section className="pt-6 text-center sm:pt-12">
        <p className="badge mx-auto mb-6">
          <span className="h-2 w-2 rounded-full bg-[#5b21b6]" />
          Solana · USDC · zero infra fees
        </p>
        <h1 className="mx-auto max-w-4xl text-4xl leading-[0.95] sm:text-6xl lg:text-7xl">
          <span className="hl">One platform for</span>
          <br />
          <span className="hl hl-lime">modern finance</span>
          <br />
          <span className="hl">tokens, algos &amp; futures</span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-base font-medium text-white/90 sm:text-lg">
          {t("heroSubtitle")}
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-4">
          <Link href="/create" className="btn btn-primary !px-8 !py-3.5 !text-sm">
            {t("ctaCreate")} →
          </Link>
          <Link href="/algos" className="btn btn-dark !px-8 !py-3.5 !text-sm">
            {t("ctaAlgos")} →
          </Link>
        </div>

        <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-3 gap-4">
          <Stat label={t("statTokens")} value={formatCompact(stats.tokens)} />
          <Stat label={t("statUsers")} value={formatCompact(stats.users)} />
          <Stat label={t("statTvl")} value={`$${formatCompact(stats.tvlUsd)}`} />
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <FeatureBlock
          index="01"
          title={t("createTitle")}
          body={t("createBody")}
          bullets={createBullets}
          actions={
            <>
              <Link href="/create" className="btn btn-primary">
                {t("ctaCreate")} →
              </Link>
              <Link href="/explore" className="btn btn-dark">
                {t("ctaExplore")}
              </Link>
            </>
          }
        />
        <FeatureBlock
          index="02"
          title={t("algoTitle")}
          body={t("algoBody")}
          bullets={algoBullets}
          actions={
            <>
              <Link href="/algos" className="btn btn-primary">
                {t("ctaBrowseAlgos")} →
              </Link>
              <Link href="/dashboard/algos" className="btn btn-dark">
                {t("ctaPublishAlgo")}
              </Link>
            </>
          }
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

function FeatureBlock({
  index,
  title,
  body,
  bullets,
  actions,
}: {
  index: string;
  title: string;
  body: string;
  bullets: string[];
  actions: React.ReactNode;
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
      <div className="flex h-full flex-col gap-4 p-6">
        <div>
          <h3 className="display text-2xl">{title}</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-ink">{body}</p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-sm font-semibold">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-black bg-[#d8ff3e] text-[10px] font-black">
                ✓
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap gap-3 pt-2">{actions}</div>
      </div>
    </div>
  );
}

async function fetchStats() {
  try {
    const supabase = await supabaseServer();
    const [tokens, users] = await Promise.all([
      supabase
        .from("tokens")
        .select("mint", { count: "exact", head: true })
        .eq("kind", "mainnet"),
      // Hitung pengguna unik via profiles (wallet kini bisa >1 per user).
      supabase.from("profiles").select("user_id", { count: "exact", head: true }),
    ]);
    const { data: pools } = await supabase
      .from("pools")
      .select("liquidity_usd")
      .eq("kind", "mainnet")
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
