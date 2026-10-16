import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { formatNumber, shortAddress } from "@/lib/format";

export default async function MyTokensPage({ params }: PageProps<"/[locale]/dashboard/tokens">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const user = await requireUser();
  if (!user) return null;

  const db = supabaseAdmin();
  const { data: tokens } = await db
    .from("tokens")
    .select("mint, name, symbol, supply, created_at, logo_uri")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("recentTokens")}</h1>
        <Link href="/create" className="btn btn-primary !py-1.5 text-xs">
          +
        </Link>
      </div>
      {!tokens?.length ? (
        <p className="mt-4 text-sm text-muted">{t("noTokens")}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {tokens.map((tok) => (
            <li key={tok.mint} className="flex items-center gap-3 py-3">
              {tok.logo_uri ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tok.logo_uri} alt="" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">
                  {tok.symbol.slice(0, 3)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/token/${tok.mint}`} className="font-medium hover:text-accent">
                  {tok.name} <span className="text-muted">({tok.symbol})</span>
                </Link>
                <p className="mono text-xs text-muted">{shortAddress(tok.mint, 6)}</p>
              </div>
              <div className="text-right text-sm">
                <p>{formatNumber(Number(tok.supply), 0)}</p>
                <p className="text-xs text-muted">supply</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
