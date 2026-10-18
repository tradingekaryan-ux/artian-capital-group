"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { CopyButton } from "@/components/copy-button";
import type { AlgoRow } from "@/lib/algos";

export interface ManagedAlgo {
  algo: AlgoRow;
  subCount: number;
  msgCount: number;
}

interface HookItem {
  id: string;
  token: string;
  label: string | null;
  active: boolean;
  last_used_at: string | null;
  url: string;
}

interface FeedMessage {
  id: number;
  text: string;
  payload: unknown;
  created_at: string;
}

export function AlgoManager({ initialItems }: { initialItems: ManagedAlgo[] }) {
  const t = useTranslations("algos.manage");
  const td = useTranslations("algos.detail");
  const ta = useTranslations("algos");
  const router = useRouter();

  const [items] = useState(initialItems);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("0");
  const [billing, setBilling] = useState<"lifetime" | "monthly">("lifetime");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hooks, setHooks] = useState<Record<string, HookItem[]>>({});
  const [messages, setMessages] = useState<Record<string, FeedMessage[]>>({});
  const [hookLabel, setHookLabel] = useState("");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/algos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, priceUsdc, billing }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setName("");
      setDescription("");
      setPriceUsdc("0");
      setBilling("lifetime");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(algoId: string) {
    const [hooksRes, msgsRes] = await Promise.all([
      fetch(`/api/algos/${algoId}/hooks`),
      fetch(`/api/algos/${algoId}`),
    ]);
    if (hooksRes.ok) {
      const data = (await hooksRes.json()) as { hooks: HookItem[] };
      setHooks((prev) => ({ ...prev, [algoId]: data.hooks }));
    }
    if (msgsRes.ok) {
      const data = (await msgsRes.json()) as { messages: FeedMessage[] };
      setMessages((prev) => ({ ...prev, [algoId]: data.messages.slice().reverse() }));
    }
  }

  function toggleExpand(algoId: string) {
    if (expandedId === algoId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(algoId);
    if (!hooks[algoId]) void loadDetail(algoId);
  }

  async function toggleActive(algo: AlgoRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !algo.is_active }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function addHook(algoId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algoId}/hooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: hookLabel || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setHookLabel("");
      await loadDetail(algoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function revokeHook(algoId: string, hookId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algoId}/hooks/${hookId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDetail(algoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMessage(algoId: string, messageId: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/algos/${algoId}/messages/${messageId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessages((prev) => ({
        ...prev,
        [algoId]: (prev[algoId] ?? []).filter((m) => m.id !== messageId),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : ta("errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* create */}
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h2 className="text-xl font-bold">{t("create")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="label">{t("name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} className="input" maxLength={60} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">{t("price")} (USDC)</label>
            <input value={priceUsdc} onChange={(e) => setPriceUsdc(e.target.value)} placeholder="0" className="input" inputMode="decimal" />
            <p className="text-[11px] text-muted-ink">{t("priceHint")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">{t("description")}</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} className="input min-h-20" maxLength={2000} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="radio"
              checked={billing === "lifetime"}
              onChange={() => setBilling("lifetime")}
            />
            {t("billingLifetime")}
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="radio" checked={billing === "monthly"} onChange={() => setBilling("monthly")} />
            {t("billingMonthly")}
          </label>
        </div>
        <div>
          <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary">
            {t("create")}
          </button>
        </div>
        {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
      </form>

      {/* list */}
      {items.length === 0 ? (
        <div className="card p-10 text-center text-sm font-semibold text-muted-ink">{t("empty")}</div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map(({ algo, subCount, msgCount }) => {
            const price = Number(algo.price_usdc);
            const expanded = expandedId === algo.id;
            return (
              <li key={algo.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold">{algo.name}</h3>
                      <span className={`badge ${price === 0 ? "bg-[#d8ff3e]" : ""}`}>
                        {price === 0
                          ? ta("priceFree")
                          : algo.billing === "monthly"
                            ? ta("priceMonthly", { price: String(price) })
                            : ta("priceOnce", { price: String(price) })}
                      </span>
                      <span className={`badge ${algo.is_active ? "bg-[#d8ff3e]" : "bg-red-300"}`}>
                        {algo.is_active ? t("active") : t("inactive")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted-ink">
                      {subCount} {ta("subs")} · {msgCount} {ta("msgs")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => toggleActive(algo)} disabled={busy} className="btn btn-secondary !py-1.5 !text-xs">
                      {algo.is_active ? t("pause") : t("resume")}
                    </button>
                    <Link href={`/algos/${algo.id}`} className="btn btn-dark !py-1.5 !text-xs">
                      {t("viewFeed")}
                    </Link>
                    <button onClick={() => toggleExpand(algo.id)} className="btn btn-primary !py-1.5 !text-xs">
                      {expanded ? "−" : "+"} {t("open")}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="mt-5 flex flex-col gap-5 border-t-2 border-black pt-4">
                    {/* hooks */}
                    <div>
                      <h4 className="font-bold">{t("hooks")}</h4>
                      <p className="text-xs text-muted-ink">{t("hooksDesc")}</p>
                      <div className="mt-2 flex flex-col gap-2">
                        {(hooks[algo.id] ?? []).map((h) => (
                          <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-black bg-white p-2">
                            <span className="mono min-w-0 flex-1 truncate text-xs" title={h.url}>
                              {typeof window !== "undefined" ? `${window.location.origin}${h.url}` : h.url}
                            </span>
                            <CopyButton value={typeof window !== "undefined" ? `${window.location.origin}${h.url}` : h.url} />
                            <button onClick={() => revokeHook(algo.id, h.id)} disabled={busy} className="btn btn-danger !py-1 !px-2 !text-[10px]">
                              {t("hookRevoke")}
                            </button>
                          </div>
                        ))}
                        {(hooks[algo.id] ?? []).length === 0 ? (
                          <p className="text-sm text-muted-ink">{t("hookEmpty")}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <input
                            value={hookLabel}
                            onChange={(e) => setHookLabel(e.target.value)}
                            placeholder={t("hookLabel")}
                            className="input max-w-48 !text-xs"
                            maxLength={40}
                          />
                          <button onClick={() => addHook(algo.id)} disabled={busy} className="btn btn-secondary !py-1.5 !text-xs">
                            {t("hookAdd")}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* recent messages */}
                    <div>
                      <h4 className="font-bold">{t("recent")}</h4>
                      <div className="mt-2 flex flex-col gap-2">
                        {(messages[algo.id] ?? []).slice(0, 20).map((m) => (
                          <div key={m.id} className="flex items-start justify-between gap-3 rounded-xl border-2 border-black bg-white p-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold break-words">{m.text}</p>
                              <p className="mt-0.5 text-[10px] uppercase text-muted-ink">
                                {new Date(m.created_at).toLocaleString()}
                              </p>
                            </div>
                            <button onClick={() => deleteMessage(algo.id, m.id)} disabled={busy} className="btn btn-danger !px-2 !py-1 !text-[10px]">
                              {td("deleteMsg")}
                            </button>
                          </div>
                        ))}
                        {(messages[algo.id] ?? []).length === 0 ? (
                          <p className="text-sm text-muted-ink">{t("recentEmpty")}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
