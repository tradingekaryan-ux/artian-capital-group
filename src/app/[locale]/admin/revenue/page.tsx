import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { AdminRevenuePanel } from "@/components/admin/revenue-panel";
import { Link } from "@/i18n/navigation";

export default async function AdminRevenuePage({ params }: PageProps<"/[locale]/admin/revenue">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const admin = await requireAdmin();
  if (!admin) redirect(`/${locale}/dashboard`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl">{t("revenueTitle")}</h1>
        <Link href="/admin" className="btn btn-secondary !py-1.5 !text-xs">
          ← {t("back")}
        </Link>
      </div>
      <AdminRevenuePanel />
    </div>
  );
}
