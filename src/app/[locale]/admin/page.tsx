import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { AdminPanel } from "@/components/admin/panel";

export default async function AdminPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const admin = await requireAdmin();
  if (!admin) redirect(`/${locale}/dashboard`);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <AdminPanel />
    </div>
  );
}
