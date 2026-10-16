import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/db/client";
import { ensureProfile } from "@/lib/profiles";
import { ensureWallet } from "@/lib/solana/wallet";
import { Subnav } from "@/components/subnav";

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  if (!user) redirect(`/${locale}/login`);

  // Pastikan row profile + wallet kustodial sudah ada.
  try {
    await ensureProfile(user.id, {
      username: user.user_metadata?.username as string | undefined,
      email: user.email ?? undefined,
    });
    await ensureWallet(user.id);
  } catch (e) {
    console.error("[dashboard] ensure profile/wallet gagal:", e);
  }

  const t = await getTranslations("nav");
  const items = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/wallet", label: t("wallet") },
    { href: "/dashboard/orders", label: t("orders") },
    { href: "/dashboard/tokens", label: t("myTokens") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Subnav items={items} />
      {children}
    </div>
  );
}
