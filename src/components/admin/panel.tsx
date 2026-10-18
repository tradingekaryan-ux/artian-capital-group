"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Overview {
  pricing: Record<string, { amount_usdc?: number; percent?: number; flat_usdc?: number; min_usdc?: number }>;
  jobs: { list: JobItem[]; pending: number };
  orders: OrderItem[];
  withdrawals: OrderItem[];
  treasury: { sol: number; usdc: number; address: string | null };
}

interface JobItem {
  id: number;
  type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  run_at: string;
}

interface OrderItem {
  id: string;
  service?: string;
  amount_raw: string;
  status: string;
  created_at: string;
}

export function AdminPanel() {
  const t = useTranslations("admin");
  const [commission, setCommission] = useState("1");
  const [savingCommission, setSavingCommission] = useState(false);
  const [commissionMsg, setCommissionMsg] = useState<string | null>(null);

  async function saveCommission() {
    setSavingCommission(true);
    setCommissionMsg(null);
    try {
      const n = Number(commission);
      if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
      const res = await fetch("/api/admin/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "algo_commission", value: { amount_usdc: n } }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setCommissionMsg("✓");
    } catch (e) {
      setCommissionMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setSavingCommission(false);
    }
  }
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch("/api/admin/overview")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!cancelled && j) setData(j);
        })
        .catch(() => {
          if (!cancelled) setError("Failed to load (check admin login & env).");
        });
    };
    tick();
    const iv = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  if (error) return <p className="text-sm font-bold text-[#b91c1c]">{error}</p>;
  if (!data) return <p className="text-sm font-bold text-white/80">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* treasury */}
      <section className="card overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("treasury")}</span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border-2 border-black bg-[#f5f3ff] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">SOL</p>
              <p className="display mt-1 text-2xl">{data.treasury.sol.toFixed(4)}</p>
            </div>
            <div className="rounded-xl border-2 border-black bg-[#f5f3ff] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">USDC</p>
              <p className="display mt-1 text-2xl">{data.treasury.usdc.toFixed(2)}</p>
            </div>
          </div>
          {data.treasury.address && (
            <div className="rounded-xl border-2 border-black bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-ink">
                {t("treasuryAddress")}
              </p>
              <p className="mono mt-1 break-all text-xs font-bold">{data.treasury.address}</p>
            </div>
          )}
        </div>
      </section>

      {/* pricing */}
      <section className="card overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("pricing")}</span>
        </div>
        <div className="p-5">
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(data.pricing).map(([key, value]) => (
              <tr key={key} className="border-b border-black/10 last:border-0">
                <td className="py-2 font-semibold capitalize">{key.replace(/_/g, " ")}</td>
                <td className="py-2 text-right font-bold">
                  {value.flat_usdc != null
                    ? `${value.flat_usdc} USDC flat`
                    : value.percent != null
                      ? `${value.percent}%${value.min_usdc != null ? ` (min ${value.min_usdc})` : ""}`
                      : `${value.amount_usdc ?? 0} USDC`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t-2 border-black/10 pt-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-wide">{t("algoCommission")}</label>
            <input
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              inputMode="decimal"
              className="input w-28 !text-sm"
            />
            <p className="text-[11px] text-muted-ink">{t("algoCommissionHint")}</p>
          </div>
          <button onClick={() => void saveCommission()} disabled={savingCommission} className="btn btn-secondary !py-1.5 !text-xs">
            {t("save")}
          </button>
          {commissionMsg ? <span className="text-xs font-bold">{commissionMsg}</span> : null}
        </div>
        </div>
      </section>

      {/* jobs */}
      <section className="card overflow-hidden lg:col-span-2">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("jobs")} · pending: {data.jobs.pending}</span>
        </div>
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-2">ID</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2">Attempts</th>
                <th className="py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.list.map((j) => (
                <tr key={j.id} className="border-b border-black/10">
                  <td className="mono py-2 text-xs">{j.id}</td>
                  <td className="py-2 font-semibold">{j.type}</td>
                  <td
                    className={`py-2 font-bold uppercase text-xs tracking-wide ${
                      j.status === "failed"
                        ? "text-[#b91c1c]"
                        : j.status === "done"
                          ? "text-[#15803d]"
                          : "text-[#a16207]"
                    }`}
                  >
                    {j.status}
                  </td>
                  <td className="py-2">{j.attempts}</td>
                  <td className="max-w-64 truncate py-2 text-xs text-muted-ink" title={j.last_error ?? ""}>
                    {j.last_error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* recent orders */}
      <section className="card overflow-hidden lg:col-span-2">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">{t("recentOrders")}</span>
        </div>
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-2">Order</th>
                <th className="py-2">Service</th>
                <th className="py-2">Amount (raw)</th>
                <th className="py-2">Status</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className="border-b border-black/10">
                  <td className="mono py-2 text-xs">{o.id.slice(0, 8)}</td>
                  <td className="py-2 font-semibold">{o.service?.replace(/_/g, " ")}</td>
                  <td className="mono py-2 text-xs">{o.amount_raw}</td>
                  <td className="py-2 font-semibold capitalize">{o.status}</td>
                  <td className="py-2 text-muted-ink">{new Date(o.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
