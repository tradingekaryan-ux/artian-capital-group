"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

interface Revenue {
  totalFeeUsdc: number;
  withdrawFeeUsdc: number;
  withdrawsWithFee: number;
  totalRevenueUsdc: number;
  userUsdcHeldUsdc: number;
  userCount: number;
  byService: { service: string; count: number; feeUsdc: number }[];
  byUser: { userId: string; username: string; count: number; feeUsdc: number }[];
}

interface TreasuryData {
  address: string;
  sol: number;
  usdc: number;
}

export function AdminRevenuePanel() {
  const t = useTranslations("admin");
  const [data, setData] = useState<Revenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<TreasuryData | null>(null);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch("/api/admin/revenue")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("ERR"))))
        .then((j) => {
          if (!cancelled) {
            setData(j);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setError(t("loadError"));
        });
    };
    const tickTreasury = () => {
      fetch("/api/admin/treasury")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && j) setTreasury(j); })
        .catch(() => {});
    };
    tick();
    tickTreasury();
    const iv = setInterval(() => { tick(); tickTreasury(); }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [t]);

  async function doWithdraw() {
    if (!withdrawTo || !withdrawAmt) return;
    setWithdrawing(true);
    setWithdrawMsg(null);
    try {
      const res = await fetch("/api/admin/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw_usdc", toAddress: withdrawTo, amountUsdc: Number(withdrawAmt) }),
      });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; sig?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setWithdrawMsg(`✅ Sent! sig: ${(j.sig ?? "").slice(0, 20)}…`);
      setWithdrawTo("");
      setWithdrawAmt("");
    } catch (e) {
      setWithdrawMsg(`❌ ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setWithdrawing(false);
    }
  }

  if (error) return <p className="text-sm font-bold text-[#b91c1c]">{error}</p>;
  if (!data) return <p className="text-sm font-bold text-white/80">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* kartu total */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigCard label={t("totalFees")} value={data.totalFeeUsdc} tone="up" />
        <BigCard label={t("withdrawFees")} value={data.withdrawFeeUsdc} tone="up" />
        <BigCard label={t("grandTotal")} value={data.totalRevenueUsdc} tone="up" />
        <BigCard label={t("userUsdcHeld")} value={data.userUsdcHeldUsdc} />
      </section>

      {/* treasury live */}
      <section className="card overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("treasury")}</span>
        </div>
        <div className="p-5">
          {treasury ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border-2 border-black bg-[#f5f3ff] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">SOL</p>
                  <p className="display mt-1 text-2xl">{treasury.sol.toFixed(4)}</p>
                </div>
                <div className="rounded-xl border-2 border-black bg-[#f0fdf4] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">USDC</p>
                  <p className="display mt-1 text-2xl">{treasury.usdc.toFixed(2)}</p>
                </div>
              </div>
              <p className="mono text-xs text-muted-ink">{t("treasuryAddress")}: {treasury.address}</p>
              {/* Withdraw USDC form */}
              <div className="flex flex-wrap items-end gap-2 rounded-xl border-2 border-black p-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">To Address</label>
                  <input
                    value={withdrawTo}
                    onChange={(e) => setWithdrawTo(e.target.value)}
                    placeholder="Solana address…"
                    className="input !py-1 text-xs w-56"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">USDC Amount</label>
                  <input
                    value={withdrawAmt}
                    onChange={(e) => setWithdrawAmt(e.target.value)}
                    placeholder="0.00"
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="input !py-1 text-xs w-28"
                  />
                </div>
                <button
                  className="btn btn-secondary !py-1.5 !text-xs"
                  disabled={withdrawing || !withdrawTo || !withdrawAmt}
                  onClick={() => void doWithdraw()}
                >
                  {withdrawing ? "Sending…" : "Withdraw USDC"}
                </button>
                {withdrawMsg && <p className="w-full text-xs font-bold">{withdrawMsg}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-ink">Loading treasury…</p>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* per layanan */}
        <section className="card overflow-hidden">
          <div className="chrome">
            <span className="chrome-dots"><span /><span /><span /></span>
            <span className="text-muted-ink">{t("feesByService")}</span>
          </div>
          <div className="overflow-x-auto p-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-2">{t("service")}</th>
                  <th className="py-2 text-right">{t("orders")}</th>
                  <th className="py-2 text-right">Fee (USDC)</th>
                </tr>
              </thead>
              <tbody>
                {data.byService.map((s) => (
                  <tr key={s.service} className="border-b border-black/10 last:border-0">
                    <td className="py-2 font-semibold capitalize">{s.service.replace(/_/g, " ")}</td>
                    <td className="py-2 text-right font-bold">{s.count}</td>
                    <td className="mono py-2 text-right text-xs font-bold">{s.feeUsdc.toFixed(2)}</td>
                  </tr>
                ))}
                {!data.byService.length ? (
                  <tr><td colSpan={3} className="py-3 text-sm text-muted-ink">—</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* per user */}
        <section className="card overflow-hidden">
          <div className="chrome">
            <span className="chrome-dots"><span /><span /><span /></span>
            <span className="text-muted-ink">{t("feesByUser")}</span>
          </div>
          <div className="overflow-x-auto p-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-2">{t("userCol")}</th>
                  <th className="py-2 text-right">{t("orders")}</th>
                  <th className="py-2 text-right">Fee (USDC)</th>
                </tr>
              </thead>
              <tbody>
                {data.byUser.map((u) => (
                  <tr key={u.userId} className="border-b border-black/10 last:border-0">
                    <td className="py-2">
                      <Link
                        href={`/admin/users?q=${encodeURIComponent(u.username)}`}
                        className="font-bold hover:underline decoration-2 underline-offset-2"
                      >
                        {u.username}
                      </Link>
                    </td>
                    <td className="py-2 text-right font-bold">{u.count}</td>
                    <td className="mono py-2 text-right text-xs font-bold">{u.feeUsdc.toFixed(2)}</td>
                  </tr>
                ))}
                {!data.byUser.length ? (
                  <tr><td colSpan={3} className="py-3 text-sm text-muted-ink">—</td></tr>
                ) : null}
              </tbody>
            </table>
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted-ink">
              {t("userCount")}: {data.userCount} · {t("withdrawsWithFee")}: {data.withdrawsWithFee}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function BigCard({ label, value, tone }: { label: string; value: number; tone?: "up" }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">{label}</p>
        <p className={`display mt-1 text-2xl ${tone === "up" ? "text-[#15803d]" : ""}`}>
          ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
    </div>
  );
}
