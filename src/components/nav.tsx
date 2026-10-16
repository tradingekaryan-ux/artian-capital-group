"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { supabaseBrowser } from "@/lib/db/client";

export function Nav() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [pathname]);

  const otherLocale = locale === "en" ? "id" : "en";

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold tracking-tight">
            <span className="gradient-text">Artian</span>
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-muted sm:flex">
            <Link href="/explore" className="hover:text-foreground">
              {t("explore")}
            </Link>
            <Link href="/create" className="hover:text-foreground">
              {t("create")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={pathname === "/" ? `/${otherLocale}` : `/${otherLocale}${pathname}`}
            className="rounded-lg px-2 py-1 text-muted hover:text-foreground"
          >
            {otherLocale.toUpperCase()}
          </Link>
          {email ? (
            <>
              <Link href="/dashboard" className="btn btn-secondary !py-1.5">
                {t("dashboard")}
              </Link>
              <button onClick={logout} className="btn btn-primary !py-1.5">
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-secondary !py-1.5">
                {t("login")}
              </Link>
              <Link href="/register" className="btn btn-primary !py-1.5">
                {t("register")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
