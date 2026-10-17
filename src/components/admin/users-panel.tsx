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
}: {
  detail: UserDetail;
  reindexBusy: boolean;
  onReindex: () => void;
}) {
  const t = useTranslations("admin");
  const u = detail.user;
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
