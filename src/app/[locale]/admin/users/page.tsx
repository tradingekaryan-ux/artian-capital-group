import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { AdminUsersPanel } from "@/components/admin/users-panel";
import { Link } from "@/i18n/navigation";

export default async function AdminUsersPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const q = typeof sp?.q === "string" ? sp.q : "";
  const t = await getTranslations("admin");
  const admin = await requireAdmin();
  if (!admin) redirect(`/${locale}/dashboard`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl">{t("usersTitle")}</h1>
        <Link href="/admin" className="btn btn-secondary !py-1.5 !text-xs">
          ← {t("back")}
        </Link>
      </div>
      <AdminUsersPanel initialQ={q} />
    </div>
  );
}
