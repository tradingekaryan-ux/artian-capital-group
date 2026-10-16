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
    <section className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /><span /></span>
        <span className="text-muted-ink">{t("recentTokens")}</span>
      </div>
      <div className="p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl">{t("recentTokens")}</h1>
        <Link href="/create" className="btn btn-primary !px-4 !py-1.5 !text-xs">
          + New
        </Link>
      </div>
      {!tokens?.length ? (
        <p className="mt-4 text-sm text-muted-ink">{t("noTokens")}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-black/10">
          {tokens.map((tok) => (
            <li key={tok.mint} className="flex items-center gap-3 py-3">
              {tok.logo_uri ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tok.logo_uri} alt="" className="h-10 w-10 rounded-xl border-2 border-black object-cover" />
              ) : (
                <div className="display flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-[#ede9fe] text-xs">
                  {tok.symbol.slice(0, 3)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/token/${tok.mint}`} className="font-bold hover:underline decoration-2 underline-offset-2">
                  {tok.name} <span className="font-medium text-muted-ink">({tok.symbol})</span>
                </Link>
                <p className="mono text-xs text-muted-ink">{shortAddress(tok.mint, 6)}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-bold">{formatNumber(Number(tok.supply), 0)}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">supply</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}
