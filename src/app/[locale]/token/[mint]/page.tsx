import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { getPrice } from "@/lib/payment/pricing";
import { formatUsd, formatPercent, formatCompact, formatDate, shortAddress } from "@/lib/format";
import { CopyButton } from "@/components/copy-button";
import { SITE } from "@/lib/config";
import { Sparkline, PriceChart } from "@/components/market/chart";
import { WatchlistButton } from "@/components/market/watchlist-button";
import { CommentsSection } from "@/components/community/comments";
import { PoolPanel } from "@/components/pools/pool-panel";
import { Link } from "@/i18n/navigation";

interface Snapshot {
  ts: string;
  price_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  fdv_usd: number | null;
}

export default async function TokenPage({ params }: PageProps<"/[locale]/token/[mint]">) {
  const { locale, mint } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("token");

  const db = supabaseAdmin();
  const { data: token } = await db
    .from("tokens")
    .select("*")
    .eq("mint", mint)
    .maybeSingle();
  if (!token || token.status === "failed") notFound();

  const [snapshots, pool, creator, watching, comments, poolPrice, addLiqPrice] =
    await Promise.all([
    db
      .from("price_snapshots")
      .select("ts, price_usd, liquidity_usd, volume_24h_usd, fdv_usd")
      .eq("mint", mint)
      .order("ts", { ascending: false })
      .limit(168)
      .then(({ data }) => ((data ?? []) as Snapshot[]).reverse()),
    db.from("pools").select("*").eq("token_id", token.id).maybeSingle(),
    db
      .from("profiles")
      .select("username")
      .eq("user_id", token.user_id)
      .maybeSingle(),
    (async () => {
      const user = await requireUser();
      if (!user) return null;
      const { data } = await db
        .from("watchlists")
        .select("mint")
        .eq("user_id", user.id)
        .eq("mint", mint)
        .maybeSingle();
      return { watching: !!data, userId: user.id };
    })(),
    db
      .from("comments")
      .select("id, user_id, body, created_at, profiles(username)")
      .eq("mint", mint)
      .order("created_at", { ascending: false })
      .limit(50),
    getPrice("create_pool").catch(() => ({ amount_usdc: 10 })),
    getPrice("add_liquidity").catch(() => ({ amount_usdc: 1 })),
  ]);

  const latest = snapshots[snapshots.length - 1];
  const change24h = computeChange24h(snapshots);

  const isOwner = watching?.userId === token.user_id;
  const poolRow = pool.data;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${token.name} ($${token.symbol})`,
    description: token.description ?? `${token.name} on Solana — live market data on ${SITE.name}.`,
    url: `${SITE.url}/${locale}/token/${mint}`,
    inLanguage: locale,
    ...(latest?.price_usd
      ? {
          offers: {
            "@type": "Offer",
            price: Number(latest.price_usd),
            priceCurrency: "USD",
          },
        }
      : {}),
    subjectOf: {
      "@type": "Thing",
      name: token.name,
      alternateName: token.symbol,
      additionalProperty: [
        { "@type": "PropertyValue", name: "mint", value: token.mint },
        { "@type": "PropertyValue", name: "supply", value: String(token.supply) },
      ],
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* header */}
      <section className="card flex flex-wrap items-center gap-4 p-5">
        {token.logo_uri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={token.logo_uri} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 font-bold">
            {token.symbol.slice(0, 3)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-2xl font-bold">{token.name}</h1>
            <span className="text-muted">${token.symbol}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="mono">{shortAddress(token.mint, 6)}</span>
            <CopyButton value={token.mint} />
            <span>
              by {creator.data?.username ?? "unknown"} · {formatDate(token.created_at)}
            </span>
            <a
              href={`https://explorer.solana.com/address/${token.mint}?cluster=${process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-2 hover:underline"
            >
              {t("explorer")}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Sparkline points={snapshots.map((s) => s.price_usd ?? 0)} />
          <WatchlistButton mint={token.mint} initial={watching?.watching ?? false} />
        </div>
      </section>

      {/* stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={t("price")} value={latest?.price_usd ? formatUsd(latest.price_usd) : "—"} />
        <Stat
          label={t("change24h")}
          value={change24h !== null ? formatPercent(change24h) : "—"}
          tone={change24h !== null ? (change24h >= 0 ? "up" : "down") : undefined}
        />
        <Stat label={t("liquidity")} value={latest?.liquidity_usd ? `$${formatCompact(latest.liquidity_usd)}` : "—"} />
        <Stat
          label={t("volume24h")}
          value={latest?.volume_24h_usd ? `$${formatCompact(latest.volume_24h_usd)}` : "—"}
        />
        <Stat label={t("fdv")} value={latest?.fdv_usd ? `$${formatCompact(latest.fdv_usd)}` : "—"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* chart + info */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">{t("chart")}</h2>
            <PriceChart points={snapshots} />
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">About</h2>
            <p className="whitespace-pre-wrap text-sm text-muted">
              {token.description || "—"}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {Object.entries((token.socials ?? {}) as Record<string, string | null>).map(
                ([key, url]) =>
                  url && (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-2 hover:underline"
                    >
                      {key}
                    </a>
                  ),
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">{t("supply")}</dt>
                <dd className="font-semibold">{formatCompact(Number(token.supply))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Decimals</dt>
                <dd className="font-semibold">{token.decimals}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Authorities</dt>
                <dd className="font-semibold text-xs">
                  mint {token.revoke_mint ? "revoked" : "active"} · freeze{" "}
                  {token.revoke_freeze ? "revoked" : "active"}
                </dd>
              </div>
            </dl>
          </section>

          <CommentsSection
            mint={token.mint}
            initial={(comments.data ?? []).map((c) => {
              const profile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
              return {
                id: c.id,
                userId: c.user_id,
                body: c.body,
                createdAt: c.created_at,
                username: profile?.username ?? "user",
              };
            })}
            currentUserId={watching?.userId ?? null}
          />
        </div>

        {/* pool panel */}
        <div className="flex flex-col gap-6">
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">{t("poolTitle")}</h2>
            {poolRow?.status === "active" && poolRow.pool_id ? (
              <div className="flex flex-col gap-2 text-sm">
                <InfoRow label="DEX" value="Raydium CPMM" />
                <InfoRow label="Pair" value={`${token.symbol} / USDC`} />
                <InfoRow
                  label={t("liquidity")}
                  value={
                    poolRow.quote_amount
                      ? `$${formatCompact(Number(poolRow.quote_amount) * 2)}`
                      : "—"
                  }
                />
                <InfoRow
                  label={t("initialPrice")}
                  value={poolRow.initial_price ? formatUsd(Number(poolRow.initial_price)) : "—"}
                />
                <InfoRow label="Pool" value={shortAddress(poolRow.pool_id, 6)} />
                <a
                  href={`https://raydium.io/liquidity/?pool=${poolRow.pool_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 text-accent-2 hover:underline"
                >
                  Buka di Raydium ↗
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted">{t("noPool")}</p>
            )}
          </section>

          <PoolPanel
            tokenId={token.id}
            mint={token.mint}
            symbol={token.symbol}
            decimals={token.decimals}
            supply={String(token.supply)}
            isOwner={!!isOwner}
            poolId={poolRow?.id ?? null}
            poolAddress={poolRow?.pool_id ?? null}
            hasPool={poolRow?.status === "active"}
            poolFeeUsdc={poolPrice.amount_usdc ?? 10}
            addLiquidityFeeUsdc={addLiqPrice.amount_usdc ?? 1}
          />

          <Link href="/explore" className="btn btn-secondary w-full">
            ← Explore
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${
          tone === "up" ? "text-accent" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="mono text-xs">{value}</span>
    </div>
  );
}

/** Perubahan 24j: bandingkan snapshot terakhir dengan snapshot tertua yang ≤23.5 jam lalu. */
function computeChange24h(snapshots: Snapshot[]): number | null {
  const now = Date.now();
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.find(
    (s) => new Date(s.ts).getTime() <= now - 23.5 * 3600_000,
  );
  if (latest?.price_usd && previous?.price_usd) {
    return ((latest.price_usd - previous.price_usd) / previous.price_usd) * 100;
  }
  return null;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/token/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  try {
    const { data } = await supabaseAdmin()
      .from("tokens")
      .select("name, symbol, description")
      .eq("mint", mint)
      .maybeSingle();
    if (!data) return {};
    return {
      title: `${data.name} ($${data.symbol})`,
      description: data.description ?? `${data.name} on Solana — live market data on Artian.`,
    };
  } catch {
    return {};
  }
}
