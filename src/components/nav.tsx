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
    <header className="sticky top-0 z-40 border-b-[2.5px] border-black bg-[#0c0c10]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="display text-xl text-white">
            Artian<span className="text-[#d8ff3e]">.</span>
          </Link>
          <nav className="hidden items-center gap-1 text-[13px] font-bold uppercase tracking-wide text-white/90 sm:flex">
            <Link
              href="/explore"
              className={`rounded-full border-2 border-transparent px-3 py-1 transition-colors hover:border-[#d8ff3e] hover:text-[#d8ff3e] ${
                pathname === "/explore" ? "border-[#d8ff3e] text-[#d8ff3e]" : ""
              }`}
            >
              {t("explore")}
            </Link>
            <Link
              href="/create"
              className={`rounded-full border-2 border-transparent px-3 py-1 transition-colors hover:border-[#d8ff3e] hover:text-[#d8ff3e] ${
                pathname === "/create" ? "border-[#d8ff3e] text-[#d8ff3e]" : ""
              }`}
            >
              {t("create")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={pathname === "/" ? `/${otherLocale}` : `/${otherLocale}${pathname}`}
            className="rounded-full border-2 border-white/40 px-2.5 py-1 text-xs font-bold uppercase text-white hover:border-[#d8ff3e] hover:text-[#d8ff3e]"
          >
            {otherLocale.toUpperCase()}
          </Link>
          {email ? (
            <>
              <Link href="/dashboard" className="btn btn-secondary !py-1.5 !text-[11px]">
                {t("dashboard")}
              </Link>
              <button onClick={logout} className="btn btn-primary !py-1.5 !text-[11px]">
                {t("logout")}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-secondary !py-1.5 !text-[11px]">
                {t("login")}
              </Link>
              <Link href="/register" className="btn btn-primary !py-1.5 !text-[11px]">
                {t("register")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
