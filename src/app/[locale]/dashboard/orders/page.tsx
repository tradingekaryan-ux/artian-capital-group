import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { formatUsdc, formatDate } from "@/lib/format";

const STATUS_STYLE: Record<string, string> = {
  draft: "text-muted-ink",
  awaiting_payment: "text-[#a16207]",
  paid: "text-[#5b21b6]",
  processing: "text-[#a16207]",
  confirmed: "text-[#15803d]",
  failed: "text-[#b91c1c]",
  refunded: "text-muted-ink",
};

export default async function OrdersPage({ params }: PageProps<"/[locale]/dashboard/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("orders");
  const user = await requireUser();
  if (!user) return null;

  const db = supabaseAdmin();
  const { data: orders } = await db
    .from("orders")
    .select("id, service, amount_raw, status, created_at, payment_signature, error")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <section className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /><span /></span>
        <span className="text-muted-ink">{t("title")}</span>
      </div>
      <div className="overflow-x-auto p-5">
      {!orders?.length ? (
        <p className="mt-2 text-sm text-muted-ink">{t("empty")}</p>
      ) : (
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2">#</th>
              <th className="py-2">{t("service")}</th>
              <th className="py-2">{t("amount")}</th>
              <th className="py-2">{t("status")}</th>
              <th className="py-2">{t("date")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-black/10">
                <td className="mono py-2.5 text-xs text-muted-ink">{o.id.slice(0, 8)}</td>
                <td className="py-2.5 font-semibold capitalize">{o.service.replace(/_/g, " ")}</td>
                <td className="py-2.5 font-semibold">{formatUsdc(o.amount_raw)} USDC</td>
                <td className={`py-2.5 font-bold uppercase text-xs tracking-wide ${STATUS_STYLE[o.status] ?? ""}`}>
                  {o.status.replace(/_/g, " ")}
                  {o.error && (
                    <span className="ml-1 text-xs font-normal text-[#b91c1c]" title={o.error}>
                      ({String(o.error).slice(0, 40)})
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-muted-ink">{formatDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
    </section>
  );
}
