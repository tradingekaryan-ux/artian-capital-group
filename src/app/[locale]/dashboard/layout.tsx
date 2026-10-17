import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { ensureProfile } from "@/lib/profiles";
import { ensureWallet, listWallets, getActiveWallet } from "@/lib/solana/wallet";
import { Subnav } from "@/components/subnav";
import { WalletSwitcher } from "@/components/wallet/wallet-switcher";

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  if (!user) redirect("/login");

  // Pastikan row profile + wallet kustodial sudah ada.
  let wallets: { id: string; kind: "mainnet" | "demo"; label: string | null; public_key: string }[] = [];
  let activeId: string | null = null;
  try {
    await ensureProfile(user.id, {
      username: user.user_metadata?.username as string | undefined,
      email: user.email ?? undefined,
    });
    await ensureWallet(user.id);
    wallets = await listWallets(user.id);
    activeId = (await getActiveWallet(user.id)).id;
  } catch (e) {
    console.error("[dashboard] ensure profile/wallet failed:", e);
  }

  const t = await getTranslations("nav");
  const items = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/wallet", label: t("wallet") },
    { href: "/dashboard/orders", label: t("orders") },
    { href: "/dashboard/tokens", label: t("myTokens") },
  ];

  // Tautan Admin hanya untuk akun ber-role admin.
  try {
    const { data: profile } = await supabaseAdmin()
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profile?.role === "admin") {
      items.push({ href: "/admin", label: t("admin") });
    }
  } catch {
    /* profiles belum ada — tanpa tautan admin */
  }

  return (
    <div className="flex flex-col gap-6">
      <Subnav items={items} />
      {wallets.length > 0 && <WalletSwitcher wallets={wallets} activeId={activeId} />}
      {children}
    </div>
  );
}
