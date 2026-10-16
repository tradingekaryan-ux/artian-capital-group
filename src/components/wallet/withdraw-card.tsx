"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics";

interface Props {
  feeUsdc: number;
}

export function WithdrawCard({ feeUsdc }: Props) {
  const t = useTranslations("wallet");
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [withdrawalId, setWithdrawalId] = useState<number | null>(null);
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_usdc: Number(amount), destination: dest.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setWithdrawalId(json.id);
      setMessage(t("otpSent"));
      track("withdraw_requested");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/withdraw/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: withdrawalId, otp: otp.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setMessage("Withdrawal diproses — cek status di halaman Orders.");
      setWithdrawalId(null);
      setOtp("");
      track("withdraw_confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-xs text-muted-ink">
        {t("withdrawFee")}: <strong>{feeUsdc} USDC</strong> · Biaya jaringan ditanggung platform
      </p>
      {withdrawalId === null ? (
        <form onSubmit={requestWithdraw} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="w-amount">
                {t("withdrawAmount")}
              </label>
              <input
                id="w-amount"
                className="input"
                inputMode="decimal"
                placeholder="10"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="w-dest">
                {t("withdrawDest")}
              </label>
              <input
                id="w-dest"
                className="input mono text-xs"
                placeholder="Solana address…"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                required
                minLength={32}
                maxLength={64}
              />
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "…" : t("withdrawCta")}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="flex flex-col gap-3">
          <p className="text-sm text-muted-ink">{t("otpVerify")}</p>
          <input
            className="input mono text-center text-lg tracking-[0.4em]"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            required
          />
          <button className="btn btn-primary" disabled={busy || otp.length !== 6}>
            {busy ? "…" : t("confirm")}
          </button>
        </form>
      )}
      {message && <p className="text-sm font-bold text-[#15803d]">{message}</p>}
      {error && <p className="text-sm font-bold text-[#b91c1c]">{error}</p>}
    </div>
  );
}
