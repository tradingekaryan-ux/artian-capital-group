"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { AlgoRow } from "@/lib/algos";

interface FeedMessage {
  id: number;
  text: string;
  payload: unknown;
  created_at: string;
}

interface SubInfo {
  status: string;
  billing: "lifetime" | "monthly";
  expires_at: string | null;
  active: boolean;
}

interface SlotItem {
  id: string;
  dest_url: string;
  active: boolean;
  last_status: string | null;
  last_delivered_at: string | null;
}

export function AlgoView({
  algo,
  creator,
  initialMessages,
  mySub,
  isAuthed,
  viewerIsOwner,
  subCount,
  messageCount,
}: {
  algo: AlgoRow;
  creator: { username: string | null; display_name: string | null };
  initialMessages: FeedMessage[];
  mySub: SubInfo | null;
  isAuthed: boolean;
  viewerIsOwner: boolean;
  subCount: number;
  messageCount: number;
}) {
  const t = useTranslations("algos.detail");
  const ta = useTranslations("algos");
  const router = useRouter();
  const price = Number(algo.price_usdc);

  const [messages, setMessages] = useState<FeedMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openRaw, setOpenRaw] = useState<Set<number>>(new Set());
  const [slots, setSlots] = useState<SlotItem[] | null>(null);
  const [slotUrl, setSlotUrl] = useState("");
  const lastIdRef = useRef(initialMessages.at(-1)?.id ?? 0);
  const subActive = !!mySub?.active;

  const loadSlots = useCallback(async () => {
    try {
      const res = await fetch(`/api/algos/${algo.id}/slots`);
      if (!res.ok) return;
      const data = (await res.json()) as { slots: SlotItem[] };
      setSlots(data.slots);
    } catch {
      /* offline — biarkan */
    }
  }, [algo.id]);

  useEffect(() => {
    if (!subActive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/algos/${algo.id}/slots`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { slots: SlotItem[] };
        if (!cancelled) setSlots(data.slots);
      } catch {
        /* offline — biarkan */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subActive, algo.id]);

  // live feed: poll message baru tiap 10 detik
  useEffect(() => {
    let stop = false;
    const timer = setInterval(async () => {
      if (document.hidden || stop) return;
      try {
        const res = await fetch(`/api/algos/${algo.id}?after=${lastIdRef.current}`);
        if (!res.ok) return;
        const data = (await res.json()) as { messages: FeedMessage[] };
        if (data.messages.length > 0 && !stop) {
          lastIdRef.current = data.messages.at(-1)!.id;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            return [...prev, ...data.messages.filter((m) => !seen.has(m.id))];
          });
        }
      } catch {
        /* retry berikutnya */
      }
    }, 10_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [algo.id]);

  async function subscribe() {
    if (price > 0 && !window.confirm(t("subscribeConfirmPay"))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/algos/${algo.id}/subscribe`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function addSlot() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algo.id}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destUrl: slotUrl }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSlotUrl("");
      await loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function removeSlot(slotId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algo.id}/slots/${slotId}`, { method: "DELETE" });
      const gone = res.status === 404 && res.headers.get("content-type")?.includes("application/json") === true;
      if (!res.ok && !gone) throw new Error(`HTTP ${res.status}`);
      await loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMessage(messageId: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algo.id}/messages/${messageId}`, { method: "DELETE" });
      const gone = res.status === 404 && res.headers.get("content-type")?.includes("application/json") === true;
      if (!res.ok && !gone) throw new Error(`HTTP ${res.status}`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  const priceLabel =
    price === 0 ? ta("priceFree") : algo.billing === "monthly" ? ta("priceMonthly", { price: String(price) }) : ta("priceOnce", { price: String(price) });

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold sm:text-3xl">{algo.name}</h1>
              <span className={`badge ${price === 0 ? "bg-[#d8ff3e]" : ""}`}>{priceLabel}</span>
              {!algo.is_active ? <span className="badge bg-red-400">{t("inactiveBadge")}</span> : null}
              {viewerIsOwner ? <span className="badge bg-[#d8ff3e]">{t("ownerBadge")}</span> : null}
            </div>
            {algo.description ? <p className="mt-2 text-sm text-muted-ink">{algo.description}</p> : null}
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted-ink">
              {t("by")} @{creator.username ?? "—"} · {subCount} {t("subs")} · {messageCount} {t("msgs")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {!isAuthed ? (
              <Link href="/login" className="btn btn-secondary">
                {t("loginToSubscribe")}
              </Link>
            ) : viewerIsOwner ? (
              <Link href="/dashboard/algos" className="btn btn-secondary">
                {ta("manage.open")}
              </Link>
            ) : subActive ? (
              <span className="btn btn-primary pointer-events-none opacity-80">{t("subscribed")}</span>
            ) : (
              <button onClick={subscribe} disabled={busy || !algo.is_active} className="btn btn-primary">
                {price === 0 ? t("subscribeFree") : mySub ? t("renew") : t("subscribePay")}
              </button>
            )}
            {subActive && mySub?.expires_at ? (
              <span className="text-[11px] font-bold uppercase text-muted-ink">
                {t("subscribedUntil", { date: new Date(mySub.expires_at).toLocaleDateString() })}
              </span>
            ) : subActive ? (
              <span className="text-[11px] font-bold uppercase text-muted-ink">{t("subscribedLifetime")}</span>
            ) : null}
          </div>
        </div>
        {mySub && !mySub.active ? <p className="mt-3 text-sm font-semibold text-red-700">{t("expired")}</p> : null}
        {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm font-semibold text-green-700">{notice}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* feed */}
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold">{t("feed")}</h2>
            <span className="badge bg-[#d8ff3e]">{t("feedLive")}</span>
          </div>
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-ink">{t("feedEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <li key={m.id} className="rounded-xl border-2 border-black bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold break-words whitespace-pre-wrap">{m.text}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                        {new Date(m.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() =>
                          setOpenRaw((prev) => {
                            const next = new Set(prev);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            return next;
                          })
                        }
                        className="btn btn-dark !px-2 !py-1 !text-[10px]"
                      >
                        {t("raw")}
                      </button>
                      {viewerIsOwner ? (
                        <button
                          onClick={() => deleteMessage(m.id)}
                          disabled={busy}
                          className="btn btn-danger !px-2 !py-1 !text-[10px]"
                        >
                          {t("deleteMsg")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {openRaw.has(m.id) ? (
                    <pre className="mono mt-2 max-h-64 overflow-auto rounded-lg bg-[#0c0c10] p-3 text-[11px] text-white">
                      {JSON.stringify(m.payload, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* slots */}
        <section className="card h-fit p-5">
          <h2 className="text-xl font-bold">{t("slots")}</h2>
          <p className="mt-1 text-xs text-muted-ink">{t("slotsDesc")}</p>
          {!isAuthed || (!subActive && !viewerIsOwner) ? (
            <p className="mt-4 text-sm font-semibold text-muted-ink">{t("slotsLocked")}</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {slots === null ? (
                <p className="text-sm text-muted-ink">…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted-ink">{t("slotsEmpty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {slots.map((s) => (
                    <li key={s.id} className="rounded-xl border-2 border-black bg-white p-3">
                      <p className="mono truncate text-xs font-semibold" title={s.dest_url}>
                        {s.dest_url}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide ${
                            s.last_status === "ok" ? "text-green-700" : s.last_status ? "text-red-700" : "text-muted-ink"
                          }`}
                        >
                          {s.last_status === "ok"
                            ? t("slotOk")
                            : s.last_status
                              ? `${t("slotError")}: ${s.last_status}`
                              : "—"}
                          {s.last_delivered_at
                            ? ` · ${t("slotLast", { date: new Date(s.last_delivered_at).toLocaleString() })}`
                            : ""}
                        </span>
                        <button onClick={() => removeSlot(s.id)} disabled={busy} className="btn btn-danger !px-2 !py-1 !text-[10px]">
                          {t("slotRevoke")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {subActive ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={slotUrl}
                    onChange={(e) => setSlotUrl(e.target.value)}
                    placeholder={t("slotUrl")}
                    className="input !text-xs"
                  />
                  <button onClick={addSlot} disabled={busy || !slotUrl.trim()} className="btn btn-secondary">
                    {t("slotAdd")}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
