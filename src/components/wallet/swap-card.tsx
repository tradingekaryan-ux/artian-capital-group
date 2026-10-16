"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics";

export function SwapCard({ feePercent }: { feePercent: number }) {
  const t = useTranslations("wallet");
  const [asset, setAsset] = useState("SOL");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/wallet/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, amount: Number(amount) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setMessage("Swap sedang diproses — akan muncul di Orders.");
      setAmount("");
      track("swap_submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-xs text-muted-ink">
        Fee in-app: <strong>{feePercent}%</strong> dari hasil swap · Biaya jaringan ditanggung platform
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="s-asset">
            {t("swapFrom")}
          </label>
          <select
            id="s-asset"
            className="input"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
          >
            <option value="SOL">SOL</option>
            <option value="TOKEN">Token (SPL)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-amount">
            {t("swapAmount")}
          </label>
          <input
            id="s-amount"
            className="input"
            inputMode="decimal"
            placeholder="1.5"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            required
          />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "…" : t("swapCta")}
          </button>
        </div>
      </form>
      {message && <p className="text-sm font-bold text-[#15803d]">{message}</p>}
      {error && <p className="text-sm font-bold text-[#b91c1c]">{error}</p>}
    </div>
  );
}
