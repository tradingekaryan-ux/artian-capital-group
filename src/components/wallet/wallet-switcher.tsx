"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

interface WalletItem {
  id: string;
  kind: "mainnet" | "demo";
  label: string | null;
  public_key: string;
  isTreasury?: boolean;
}

export function WalletSwitcher({ wallets, activeId }: { wallets: WalletItem[]; activeId: string | null }) {
  const t = useTranslations("wallet.switcher");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ganti nama inline: baris yang sedang diedit menampilkan input, bukan tombol switch.
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createWallet(kind: "mainnet" | "demo") {
    // Tanpa prompt label — server memberi nama otomatis ("Wallet 1", "Wallet 2", …)
    // dan nama itu tampil di daftar switcher (lihat render di bawah).
    await post("/api/wallet", { action: kind === "demo" ? "create_demo" : "create_mainnet" });
  }

  /** Simpan nama baru (PATCH /api/wallet/[id]) — Enter/✓ simpan, Esc/✕ batal. */
  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const label = editing.value.trim();
    if (!label) return; // server juga menolak label kosong
    const walletId = editing.id;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet/${walletId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function archiveWalletAction(walletId: string) {
    if (!window.confirm(t("confirmArchive"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet/${walletId}`, { method: "DELETE" });
      const gone = res.status === 404 && res.headers.get("content-type")?.includes("application/json") === true;
      if (!res.ok && !gone) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /></span>
        <span className="text-muted-ink">{t("title")}</span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {wallets.map((w) => {
          // Treasury = entri virtual admin: tanpa switch, tanpa arsip.
          if (w.isTreasury) {
            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-xl border-2 border-black bg-[#f5f3ff] px-3 py-2 text-sm font-bold"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="mono truncate text-xs">{w.public_key.slice(0, 6)}…{w.public_key.slice(-4)}</span>
                  <span className="rounded-full border-2 border-black bg-[#d8ff3e] px-2 py-0.5 text-[10px] uppercase">
                    {t("treasuryBadge")}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-ink">
                  {t("treasuryLabel")}
                </span>
              </div>
            );
          }
          const active = w.id === activeId;
          const renaming = editing !== null && editing.id === w.id;
          return (
            <div key={w.id} className="flex items-center gap-2">
              {renaming ? (
                /* Mode ganti nama inline — Enter/✓ simpan, Esc/✕ batal. */
                <form onSubmit={saveRename} className="flex flex-1 items-center gap-1.5">
                  <input
                    autoFocus
                    value={editing?.value ?? ""}
                    maxLength={40}
                    onChange={(e) => setEditing({ id: w.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                    }}
                    aria-label={t("renameInput")}
                    className="min-w-0 flex-1 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-sm font-bold focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy || !editing?.value.trim()}
                    title={t("renameSave")}
                    className="shrink-0 rounded-lg border-2 border-black bg-[#d8ff3e] px-2 py-1.5 text-[11px] font-bold uppercase disabled:opacity-40"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title={tc("cancel")}
                    onClick={() => setEditing(null)}
                    className="shrink-0 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-[11px] font-bold uppercase disabled:opacity-40"
                  >
                    ✕
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  disabled={busy || active}
                  onClick={() => post("/api/wallet/active", { walletId: w.id })}
                  className={`flex flex-1 items-center justify-between gap-2 rounded-xl border-2 border-black px-3 py-2 text-left text-sm font-bold transition-transform ${
                    active
                      ? "bg-[#d8ff3e] shadow-[3px_3px_0_0_#000]"
                      : "bg-white hover:-translate-y-0.5"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {w.label && <span className="truncate">{w.label}</span>}
                    <span className="mono truncate text-xs text-muted-ink">
                      {w.public_key.slice(0, 6)}…{w.public_key.slice(-4)}
                    </span>
                    {w.kind === "demo" && (
                      <span className="rounded-full border-2 border-black bg-[#f5f3ff] px-2 py-0.5 text-[10px] uppercase">
                        {t("demoBadge")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-ink">
                    {active ? t("active") : w.kind === "demo" ? t("demo") : t("mainnet")}
                  </span>
                </button>
              )}
              {/* Tombol ganti nama — semua wallet, termasuk yang sedang aktif. */}
              {!renaming && (
                <button
                  type="button"
                  disabled={busy}
                  title={t("rename")}
                  onClick={() => setEditing({ id: w.id, value: w.label ?? "" })}
                  className="shrink-0 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-[11px] font-bold hover:bg-[#f5f3ff] disabled:opacity-40"
                >
                  ✎
                </button>
              )}
              {/* Tombol arsip — hanya untuk wallet non-aktif (wallet aktif harus switch dulu). */}
              {!active && (
                <button
                  type="button"
                  disabled={busy}
                  title={t("archive")}
                  onClick={() => void archiveWalletAction(w.id)}
                  className="shrink-0 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-[11px] font-bold uppercase hover:bg-[#fee2e2] disabled:opacity-40"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => createWallet("mainnet")}
            className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_0_#000] hover:-translate-y-0.5 disabled:opacity-50"
          >
            {busy ? t("creating") : t("createMainnet")}
          </button>
          {!wallets.some((w) => w.kind === "demo") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => createWallet("demo")}
              className="rounded-full border-2 border-black bg-[#d8ff3e] px-3 py-1 text-xs font-bold uppercase shadow-[2px_2px_0_0_#000] hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? t("creating") : t("createDemo")}
            </button>
          )}
        </div>
        {error && <p className="text-xs font-bold text-[#b91c1c]">{error}</p>}
      </div>
    </div>
  );
}
