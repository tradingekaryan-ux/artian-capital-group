"use client";

import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";

export function Subnav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 pb-1 text-sm">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-full border-2 border-black px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-transform hover:-translate-y-0.5 ${
              active
                ? "bg-[#d8ff3e] text-ink shadow-[3px_3px_0_0_#000]"
                : "bg-white text-ink shadow-[3px_3px_0_0_#000]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
