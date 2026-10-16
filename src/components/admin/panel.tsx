"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Overview {
  pricing: Record<string, { amount_usdc?: number; percent?: number; flat_usdc?: number; min_usdc?: number }>;
  jobs: { list: JobItem[]; pending: number };
  orders: OrderItem[];
  withdrawals: OrderItem[];
  treasury: { sol: number; usdc: number };
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
          if (!cancelled) setError("Gagal memuat (cek login admin & env).");
        });
    };
    tick();
    const iv = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* treasury */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">{t("treasury")}</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs text-muted">SOL</p>
            <p className="text-xl font-bold">{data.treasury.sol.toFixed(4)}</p>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs text-muted">USDC</p>
            <p className="text-xl font-bold">{data.treasury.usdc.toFixed(2)}</p>
          </div>
        </div>
      </section>

      {/* pricing */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">{t("pricing")}</h2>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(data.pricing).map(([key, value]) => (
              <tr key={key} className="border-b border-border/60 last:border-0">
                <td className="py-2 capitalize">{key.replace(/_/g, " ")}</td>
                <td className="py-2 text-right font-medium">
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
      </section>

      {/* jobs */}
      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-3 font-semibold">
          {t("jobs")} <span className="text-xs text-warning">pending: {data.jobs.pending}</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2">ID</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2">Attempts</th>
                <th className="py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.list.map((j) => (
                <tr key={j.id} className="border-b border-border/50">
                  <td className="py-2 mono text-xs">{j.id}</td>
                  <td className="py-2">{j.type}</td>
                  <td
                    className={`py-2 font-medium ${
                      j.status === "failed"
                        ? "text-danger"
                        : j.status === "done"
                          ? "text-accent"
                          : "text-warning"
                    }`}
                  >
                    {j.status}
                  </td>
                  <td className="py-2">{j.attempts}</td>
                  <td className="max-w-64 truncate py-2 text-xs text-muted" title={j.last_error ?? ""}>
                    {j.last_error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* recent orders */}
      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-3 font-semibold">{t("recentOrders")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2">Order</th>
                <th className="py-2">Service</th>
                <th className="py-2">Amount (raw)</th>
                <th className="py-2">Status</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className="border-b border-border/50">
                  <td className="py-2 mono text-xs">{o.id.slice(0, 8)}</td>
                  <td className="py-2">{o.service?.replace(/_/g, " ")}</td>
                  <td className="py-2 mono text-xs">{o.amount_raw}</td>
                  <td className="py-2">{o.status}</td>
                  <td className="py-2 text-muted">{new Date(o.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
