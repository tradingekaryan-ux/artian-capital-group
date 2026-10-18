"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { shortAddress } from "@/lib/format";

interface UserRow {
  id: string;
  email: string | null;
  createdAt: string;
  username: string | null;
  displayName: string | null;
  role: string;
  isSuspended: boolean;
  wallet: string | null;
  usdcRaw: string;
  solLamports: number;
  tokensCount: number;
  ordersCount: number;
  paidRaw: string;
}

interface UserDetail {
  user: UserRow & { balanceRefreshedAt: string | null };
  tokens: { mint: string; name: string; symbol: string; supply: string; status: string; created_at: string }[];
  orders: { id: string; service: string; amount_raw: string; status: string; payment_signature: string | null; created_at: string }[];
  withdrawals: { id: string; amount_raw: string; fee_raw: string | null; status: string; tx_signature: string | null; fee_tx: string | null; created_at: string }[];
  wallets: { id: string; kind: string; label: string | null; public_key: string; archived_at: string | null }[];
  algos?: { id: string; name: string; price_usdc: string | number; billing: string; is_active: boolean; created_at: string }[];
}

const rawToUsdc = (raw: string) => Number(raw ?? 0) / 1_000_000;

export function AdminUsersPanel({ initialQ = "" }: { initialQ?: string }) {
  const t = useTranslations("admin");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState(initialQ);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback((p: number) => {
    fetch(`/api/admin/users?page=${p}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("ERR"))))
      .then((j) => {
        setUsers(j.users ?? []);
        setHasMore(!!j.hasMore);
        setError(null);
      })
      .catch(() => setError(t("loadError")));
  }, [t]);

  useEffect(() => {
    load(page);
  }, [page, load]);

  async function patch(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "ERR");
      load(page);
      if (openId === body.userId) void openDetail(String(body.userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setBusy(null);
    }
  }

  async function openDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetailBusy(true);
    try {
      const res = await fetch(`/api/admin/users?id=${id}`);
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      setError(t("loadError"));
    } finally {
      setDetailBusy(false);
    }
  }

  /** Muat ulang detail user terbuka + daftar (setelah topup/hapus dsb.). */
  async function refreshDetail(id: string) {
    try {
      const res = await fetch(`/api/admin/users?id=${id}`);
      if (res.ok) setDetail(await res.json());
    } catch {
      /* biarkan tampilan lama bila gagal */
    }
    load(page);
  }

  const filtered = (users ?? []).filter((u) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (u.email ?? "").toLowerCase().includes(s) || (u.username ?? "").toLowerCase().includes(s) || (u.wallet ?? "").toLowerCase().includes(s);
  });

  return (
    <section className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /><span /></span>
        <span className="text-muted-ink">{t("users")}</span>
      </div>
      <div className="p-5">
        {error ? <p className="mb-3 text-sm font-bold text-[#b91c1c]">{error}</p> : null}
        <div className="mb-4 flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchUsers")}
            className="input w-64 !py-1.5 text-sm"
          />
          <span className="text-xs font-bold uppercase tracking-wide text-muted-ink">
            {t("page")} {page}
          </span>
          <div className="ml-auto flex gap-2">
            <button className="btn btn-secondary !py-1.5 !text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← {t("prev")}
            </button>
            <button className="btn btn-secondary !py-1.5 !text-xs" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
              {t("next")} →
            </button>
          </div>
        </div>

        {!users ? (
          <p className="text-sm font-bold text-white/80">Loading…</p>
        ) : !filtered.length ? (
          <p className="text-sm text-muted-ink">{t("noUsers")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-2">{t("userCol")}</th>
                  <th className="py-2">{t("role")}</th>
                  <th className="py-2">{t("status")}</th>
                  <th className="py-2">USDC</th>
                  <th className="py-2">{t("tokensCount")}</th>
                  <th className="py-2">{t("ordersCount")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <Fragment key={u.id}>
                    <tr className="border-b border-black/10 align-top">
                      <td className="py-2">
                        <p className="font-bold">{u.username ?? "—"}</p>
                        <p className="text-xs text-muted-ink">{u.email ?? "—"}</p>
                      </td>
                      <td className="py-2">
                        <span className={`badge !shadow-none ${u.role === "admin" ? "bg-[#ede9fe] text-[#5b21b6]" : "bg-[#f4f4f5]"}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2">
                        <span className={`badge !shadow-none ${u.isSuspended ? "bg-[#fee2e2] text-[#b91c1c]" : "bg-[#dcfce7] text-[#15803d]"}`}>
                          {u.isSuspended ? t("suspended") : t("active")}
                        </span>
                      </td>
                      <td className="mono py-2 text-xs font-bold">{rawToUsdc(u.usdcRaw).toFixed(2)}</td>
                      <td className="py-2 font-bold">{u.tokensCount}</td>
                      <td className="py-2 font-bold">{u.ordersCount}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button className="btn btn-secondary !px-2 !py-1 !text-[11px]" onClick={() => void openDetail(u.id)}>
                            {openId === u.id ? t("hideDetail") : t("detail")}
                          </button>
                          <button
                            className="btn btn-secondary !px-2 !py-1 !text-[11px]"
                            disabled={busy === u.id}
                            onClick={() => void patch({ userId: u.id, isSuspended: !u.isSuspended }, u.id)}
                          >
                            {u.isSuspended ? t("unsuspend") : t("suspend")}
                          </button>
                          <button
                            className="btn btn-secondary !px-2 !py-1 !text-[11px]"
                            disabled={busy === u.id}
                            onClick={() => void patch({ userId: u.id, role: u.role === "admin" ? "user" : "admin" }, u.id)}
                          >
                            {u.role === "admin" ? t("demote") : t("promote")}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {openId === u.id ? (
                      <tr className="border-b border-black/10">
                        <td colSpan={7} className="bg-[#faf9ff] p-4">
                          {detailBusy || !detail ? (
                            <p className="text-sm text-muted-ink">…</p>
                          ) : (
                            <UserDetailView
                              detail={detail}
                              reindexBusy={busy === `reindex-${u.id}`}
                              onReindex={() => void patch({ userId: u.id, reindex: true }, `reindex-${u.id}`)}
                              onRefresh={() => void refreshDetail(u.id)}
                            />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function UserDetailView({
  detail,
  reindexBusy,
  onReindex,
  onRefresh,
}: {
  detail: UserDetail;
  reindexBusy: boolean;
  onReindex: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("admin");
  const u = detail.user;
  const [opsWalletId, setOpsWalletId] = useState("");
  const [opsAsset, setOpsAsset] = useState<"usdc" | "sol">("usdc");
  const [opsAmount, setOpsAmount] = useState("");
  const [opsBusy, setOpsBusy] = useState<string | null>(null);
  const [opsMsg, setOpsMsg] = useState<string | null>(null);

  const mainnetWallets = detail.wallets.filter((w) => w.kind === "mainnet");
  const defaultWallet = mainnetWallets.find((w) => !w.archived_at) ?? mainnetWallets[0];
  const selectedWalletId = opsWalletId || defaultWallet?.id || "";

  async function walletOp(action: "topup" | "withdraw") {
    if (!selectedWalletId || !opsAmount) return;
    const key = `${action}-${selectedWalletId}`;
    const question =
      action === "topup"
        ? t("confirmTopup", { amount: opsAmount, asset: opsAsset.toUpperCase() })
        : t("confirmWithdraw", { amount: opsAmount, asset: opsAsset.toUpperCase() });
    if (!window.confirm(question)) return;
    setOpsBusy(key);
    setOpsMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, asset: opsAsset, amount: opsAmount, walletId: selectedWalletId }),
      });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) throw new Error(String(j.error ?? "ERR"));
      setOpsMsg(t("walletOpSent", { sig: String(j.sig ?? "").slice(0, 12) }));
      setOpsAmount("");
      onRefresh();
    } catch (e) {
      setOpsMsg(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setOpsBusy(null);
    }
  }

  async function deleteWallet(walletId: string, addr: string) {
    if (!window.confirm(t("confirmDeleteWallet", { addr }))) return;
    setOpsBusy(`del-${walletId}`);
    setOpsMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/wallet?walletId=${walletId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) throw new Error(String(j.error ?? "ERR"));
      setOpsMsg(t("walletDeleted"));
      onRefresh();
    } catch (e) {
      setOpsMsg(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setOpsBusy(null);
    }
  }

  async function deleteAlgo(algoId: string, name: string) {
    if (!window.confirm(t("confirmDeleteAlgo", { name }))) return;
    setOpsBusy(`algo-${algoId}`);
    setOpsMsg(null);
    try {
      const res = await fetch(`/api/algos/${algoId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) throw new Error(String(j.error ?? "ERR"));
      setOpsMsg(t("algoDeleted"));
      onRefresh();
    } catch (e) {
      setOpsMsg(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setOpsBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mono text-xs text-muted-ink">
          {u.wallet ? `${shortAddress(u.wallet, 8)} · ` : ""}
          {t("balanceUpdated")}: {u.balanceRefreshedAt ? new Date(u.balanceRefreshedAt).toLocaleString() : "—"}
        </p>
        <button className="btn btn-secondary !px-2 !py-1 !text-[11px]" disabled={reindexBusy} onClick={onReindex}>
          {t("reindex")}
        </button>
      </div>

      {/* ── Topup / withdraw dompet user (mitra = wallet aktif admin) ── */}
      <div className="rounded border border-black/15 bg-white p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t("walletOps")}</p>
        {mainnetWallets.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              {t("walletOpsWallet")}
              <select
                className="input !py-1.5 text-xs"
                value={selectedWalletId}
                onChange={(e) => {
                  setOpsWalletId(e.target.value);
                  setOpsMsg(null);
                }}
              >
                {mainnetWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {shortAddress(w.public_key, 6)}
                    {w.archived_at ? " · archived" : ""}
                    {w.label ? ` · ${w.label}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              {t("treasuryAsset")}
              <select
                className="input !py-1.5 text-xs"
                value={opsAsset}
                onChange={(e) => setOpsAsset(e.target.value === "sol" ? "sol" : "usdc")}
              >
                <option value="usdc">USDC</option>
                <option value="sol">SOL</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">
              {t("treasuryAmount")}
              <input
                className="input !py-1.5 text-xs"
                inputMode="decimal"
                placeholder="0.00"
                value={opsAmount}
                onChange={(e) => setOpsAmount(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary !px-3 !py-1.5 !text-[11px]"
              disabled={!!opsBusy}
              onClick={() => void walletOp("topup")}
            >
              {opsBusy === `topup-${selectedWalletId}` ? "…" : t("walletTopup")}
            </button>
            <button
              className="btn btn-secondary !px-3 !py-1.5 !text-[11px]"
              disabled={!!opsBusy}
              onClick={() => void walletOp("withdraw")}
            >
              {opsBusy === `withdraw-${selectedWalletId}` ? "…" : t("walletWithdraw")}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-ink">{t("noMainnetWallet")}</p>
        )}
        {opsMsg ? <p className="mt-2 break-all text-xs font-bold text-[#15803d]">{opsMsg}</p> : null}
      </div>

      {/* Wallet list — semua (termasuk archived) + hapus permanen */}
      {detail.wallets?.length ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t("walletsAll")}</p>
          <ul className="flex flex-col gap-1">
            {detail.wallets.map((w) => (
              <li key={w.id} className="flex items-center gap-2 text-xs">
                <span className="mono font-bold">{shortAddress(w.public_key, 6)}</span>
                <span className="rounded-full border border-black/20 bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] uppercase">{w.kind}</span>
                {w.archived_at && (
                  <span className="rounded-full border border-black/20 bg-[#fee2e2] px-1.5 py-0.5 text-[10px] uppercase text-[#b91c1c]">{t("archived")}</span>
                )}
                {w.label && <span className="text-muted-ink">{w.label}</span>}
                <button
                  className="btn btn-danger ml-auto !px-2 !py-0.5 !text-[10px]"
                  disabled={!!opsBusy}
                  onClick={() => void deleteWallet(w.id, w.public_key)}
                >
                  {opsBusy === `del-${w.id}` ? "…" : t("deleteWallet")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Algo milik user — hapus permanen oleh admin */}
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t("userAlgos")}</p>
        {detail.algos?.length ? (
          <ul className="flex flex-col gap-1">
            {detail.algos.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs">
                <span className="font-bold">{a.name}</span>
                <span className="mono text-muted-ink">
                  {Number(a.price_usdc) === 0 ? "FREE" : `${a.price_usdc} USDC`} · {a.billing}
                </span>
                <span
                  className={`rounded-full border border-black/20 px-1.5 py-0.5 text-[10px] uppercase ${
                    a.is_active ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#fee2e2] text-[#b91c1c]"
                  }`}
                >
                  {a.is_active ? t("active") : "off"}
                </span>
                <button
                  className="btn btn-danger ml-auto !px-2 !py-0.5 !text-[10px]"
                  disabled={!!opsBusy}
                  onClick={() => void deleteAlgo(a.id, a.name)}
                >
                  {opsBusy === `algo-${a.id}` ? "…" : t("deleteAlgo")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-ink">—</p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t("recentTokens")}</p>
          {detail.tokens.length ? (
            <ul className="flex flex-col gap-1">
              {detail.tokens.map((tok) => (
                <li key={tok.mint} className="flex items-center justify-between gap-2">
                  <Link href={`/token/${tok.mint}`} className="font-bold hover:underline decoration-2 underline-offset-2">
                    {tok.name} ({tok.symbol})
                  </Link>
                  <span className="mono text-[10px] text-muted-ink">{shortAddress(tok.mint, 4)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-ink">—</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t("recentOrders")}</p>
          {detail.orders.length ? (
            <ul className="flex flex-col gap-1 text-xs">
              {detail.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="font-semibold capitalize">{o.service?.replace(/_/g, " ")}</span>
                  <span className="mono text-muted-ink">{rawToUsdc(o.amount_raw).toFixed(2)} · {o.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-ink">—</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-ink">{t("recentWithdrawals")}</p>
          {detail.withdrawals.length ? (
            <ul className="flex flex-col gap-1 text-xs">
              {detail.withdrawals.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{rawToUsdc(w.amount_raw).toFixed(2)} USDC</span>
                  <span className="mono text-muted-ink">
                    fee {w.fee_raw ? rawToUsdc(w.fee_raw).toFixed(2) : "—"} · {w.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-ink">—</p>
          )}
        </div>
      </div>
    </div>
  );
}
