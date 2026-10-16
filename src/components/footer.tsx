"use client";

import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("common");
  const locale = useLocale();
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} Artian Capital Group</p>
        <p className="max-w-xl">{t("disclaimer")}</p>
        <div className="flex gap-4">
          <Link href="/explore" className="hover:text-foreground">
            Explore
          </Link>
          <Link href="/create" className="hover:text-foreground">
            Create
          </Link>
          <span className="uppercase">{locale}</span>
        </div>
      </div>
    </footer>
  );
}
