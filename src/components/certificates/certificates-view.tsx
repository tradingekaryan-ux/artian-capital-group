import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/format";
import type { AchievementCategory, AchievementStatus } from "@/lib/achievements";

/** Gllyph segel per kategori (tema neobrutalistis: segel bulat ber-border tebal). */
const SEAL: Record<AchievementCategory, string> = {
  member: "★",
  token_devnet: "◎",
  token_mainnet: "◎",
  algo: "⚡",
};

/**
 * Grid sertifikat pencapaian — SEMUA sertifikat selalu tampil:
 * - terbuka: card lime + lencana "Achieved" + tanggal
 * - terkunci: card putih + lencana "Locked" + progres bar `count/threshold`
 */
export async function CertificatesView({ items }: { items: AchievementStatus[] }) {
  const t = await getTranslations("certificates");
  const done = items.filter((i) => i.unlocked).length;
  const pctTotal = items.length ? Math.round((done / items.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Ringkasan progres keseluruhan */}
      <div className="card p-5">
        <h1 className="text-2xl font-black uppercase tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("subtitle")}</p>
        <div className="mt-4 flex items-center gap-3">
          <div
            className="h-4 flex-1 overflow-hidden rounded-full border-2 border-black bg-white"
            role="progressbar"
            aria-valuenow={pctTotal}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-[#d8ff3e]" style={{ width: `${pctTotal}%` }} />
          </div>
          <span className="shrink-0 rounded-full border-2 border-black bg-[#f5f3ff] px-3 py-0.5 text-xs font-bold uppercase tracking-wide">
            {t("progress", { done, total: items.length })}
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => {
          const pct = Math.min(100, Math.round((c.count / c.threshold) * 100));
          return (
            <div
              key={c.id}
              className={`card relative flex flex-col gap-3 p-5 ${c.unlocked ? "bg-[#d8ff3e]" : "bg-white"}`}
            >
              <span
                className={`absolute right-3 top-3 rounded-full border-2 border-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  c.unlocked ? "bg-white" : "bg-[#f5f3ff] text-muted-ink"
                }`}
              >
                {c.unlocked ? t("achieved") : t("locked")}
              </span>

              <div className="flex items-center gap-3 pr-16">
                <span
                  aria-hidden
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-black text-xl font-black ${
                    c.unlocked ? "bg-white shadow-[2px_2px_0_0_#000]" : "bg-[#f5f3ff] text-muted-ink"
                  }`}
                >
                  {SEAL[c.category]}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-black uppercase tracking-tight">
                    {t(`items.${c.id}.name`)}
                  </h2>
                  <p className="text-xs text-muted-ink">{t(`items.${c.id}.desc`)}</p>
                </div>
              </div>

              <div className="mt-auto flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide">
                  <span>
                    {t("progressOf", { count: Math.min(c.count, c.threshold), threshold: c.threshold })}
                  </span>
                  {c.unlocked && c.achievedAt && (
                    <span className="truncate text-muted-ink">
                      {t("achievedOn", { date: formatDate(c.achievedAt) })}
                    </span>
                  )}
                </div>
                <div className="h-3 overflow-hidden rounded-full border-2 border-black bg-white">
                  <div
                    className={`h-full transition-all ${c.unlocked ? "bg-black" : "bg-[#d8ff3e]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
