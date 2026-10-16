import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { formatUsdc, formatDate } from "@/lib/format";

const STATUS_STYLE: Record<string, string> = {
  draft: "text-muted",
  awaiting_payment: "text-warning",
  paid: "text-accent-2",
  processing: "text-warning",
  confirmed: "text-accent",
  failed: "text-danger",
  refunded: "text-muted",
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
    <section className="card overflow-x-auto p-5">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      {!orders?.length ? (
        <p className="mt-4 text-sm text-muted">{t("empty")}</p>
      ) : (
        <table className="mt-4 w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2">#</th>
              <th className="py-2">{t("service")}</th>
              <th className="py-2">{t("amount")}</th>
              <th className="py-2">{t("status")}</th>
              <th className="py-2">{t("date")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-border/60">
                <td className="py-2.5 mono text-xs text-muted">{o.id.slice(0, 8)}</td>
                <td className="py-2.5 capitalize">{o.service.replace(/_/g, " ")}</td>
                <td className="py-2.5">{formatUsdc(o.amount_raw)} USDC</td>
                <td className={`py-2.5 font-medium ${STATUS_STYLE[o.status] ?? ""}`}>
                  {o.status.replace(/_/g, " ")}
                  {o.error && (
                    <span className="ml-1 text-xs font-normal text-danger" title={o.error}>
                      ({String(o.error).slice(0, 40)})
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-muted">{formatDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
