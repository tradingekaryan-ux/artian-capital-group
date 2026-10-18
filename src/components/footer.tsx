"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("common");
  return (
    <footer className="border-t-[2.5px] border-black bg-[#0c0c10] py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 text-sm text-white/80 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <p className="display text-lg text-white">
            Artian<span className="text-[#d8ff3e]">.</span>
          </p>
          <p className="mt-1 text-xs uppercase tracking-wide">
            © {new Date().getFullYear()} Artian Capital Group
          </p>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-white/60">{t("disclaimer")}</p>
        <div className="flex gap-5 text-xs font-bold uppercase tracking-wide">
          <Link href="/algos" className="text-white hover:text-[#d8ff3e]">
            Algos
          </Link>
          <Link href="/create" className="text-white hover:text-[#d8ff3e]">
            Create
          </Link>
          <Link href="/explore" className="text-white hover:text-[#d8ff3e]">
            Explore
          </Link>
          <Link href="/events" className="text-white hover:text-[#d8ff3e]">
            Events
          </Link>
          <Link href="/faq" className="text-white hover:text-[#d8ff3e]">
            FAQ
          </Link>
        </div>
      </div>
    </footer>
  );
}
