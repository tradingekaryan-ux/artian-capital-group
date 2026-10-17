import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { AdminPanel } from "@/components/admin/panel";
import { Link } from "@/i18n/navigation";

export default async function AdminPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const admin = await requireAdmin();
  if (!admin) redirect(`/${locale}/dashboard`);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl">{t("title")}</h1>
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/users" className="btn btn-primary !py-1.5 !text-xs">
          {t("users")}
        </Link>
        <Link href="/admin/revenue" className="btn btn-primary !py-1.5 !text-xs">
          {t("revenue")}
        </Link>
        <Link href="/create" className="btn btn-secondary !py-1.5 !text-xs">
          + {t("createToken")}
        </Link>
      </div>
      <AdminPanel />
    </div>
  );
}
