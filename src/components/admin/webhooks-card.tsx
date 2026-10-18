"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const SLOTS = ["events", "tx", "wallet", "algo", "user", "token", "discord"] as const;
type Slot = (typeof SLOTS)[number];

const LABEL_KEY: Record<Slot, string> = {
  events: "webhookEvents",
  tx: "webhookTx",
  wallet: "webhookWallet",
  algo: "webhookAlgo",
  user: "webhookUser",
  token: "webhookToken",
  discord: "webhookDiscord",
};

const empty: Record<Slot, string> = { events: "", tx: "", wallet: "", algo: "", user: "", token: "", discord: "" };

/**
 * Kartu pengaturan webhook alert —6 slot URL terpisah (event tracker,
 * transaksi, wallet baru, algo baru, user baru, token baru) + URL invite
 * Discord (tombol popup kanan bawah). URL kosong = nonaktif.
 * Simpan per-slot (PATCH /api/admin/webhooks).
 */
export function WebhooksCard() {
  const t = useTranslations("admin");
  const [urls, setUrls] = useState<Record<Slot, string>>(empty);
  const [busy, setBusy] = useState<Slot | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/webhooks")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("ERR"))))
      .then((j: Partial<Record<Slot, string>>) => setUrls({ ...empty, ...j }))
      .catch(() => setError(t("loadError")));
  }, [t]);

  async function save(slot: Slot) {
    setBusy(slot);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/webhooks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, url: urls[slot].trim() }),
      });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) throw new Error(String(j.error ?? "ERR"));
      setUrls((prev) => ({ ...prev, [slot]: String(j.url ?? "") }));
      setMsg(t("webhookSaved", { slot }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="text-muted-ink">{t("webhooks")}</span>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-xs font-medium text-muted-ink">{t("webhookHint")}</p>
        {SLOTS.map((slot) => (
          <div
            key={slot}
            className={
              slot === "discord"
                ? "flex flex-wrap items-end gap-2 border-t border-black/10 pt-3"
                : "flex flex-wrap items-end gap-2"
            }
          >
            <label className="w-24 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              {t(LABEL_KEY[slot])}
            </label>
            <input
              className="input min-w-[220px] flex-1 !py-1.5 text-xs"
              type="url"
              placeholder="https://… (empty = off)"
              value={urls[slot]}
              onChange={(e) => setUrls((prev) => ({ ...prev, [slot]: e.target.value }))}
            />
            <button
              className="btn btn-secondary !px-3 !py-1.5 !text-[11px]"
              disabled={busy === slot}
              onClick={() => void save(slot)}
            >
              {busy === slot ? "…" : t("save")}
            </button>
          </div>
        ))}
        {msg ? <p className="text-xs font-bold text-[#15803d]">{msg}</p> : null}
        {error ? <p className="text-xs font-bold text-[#b91c1c]">{error}</p> : null}
      </div>
    </section>
  );
}
