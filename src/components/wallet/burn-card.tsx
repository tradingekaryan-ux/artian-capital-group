"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export interface Holding {
  mint: string;
  amount: string;
  decimals: number;
}

interface Props {
  holdings: Holding[];
  meta: Record<string, { name: string; symbol: string }>;
  feeBurnUsdc: number;
  feeEarnUsdc: number;
  initialMode: "burn" | "burn_earn";
}

/** Raw base-unit → string desimal presisi-eksak (untuk saldo & tombol Max). */
function rawToUi(raw: string, decimals: number): string {
  if (decimals <= 0) return raw;
  const s = raw.padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function labelOf(mint: string, meta: Record<string, { name: string; symbol: string }>): string {
  const m = meta[mint];
  if (m) return `${m.name} (${m.symbol})`;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function BurnCard({ holdings, meta, feeBurnUsdc, feeEarnUsdc, initialMode }: Props) {
  const t = useTranslations("burn");
  const router = useRouter();

  const [mode, setMode] = useState<"burn" | "burn_earn">(initialMode);
  const [mint, setMint] = useState<string>(holdings[0]?.mint ?? "");
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ points: number; tx: string | null } | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idemRef = useRef("");

  const selected = holdings.find((h) => h.mint === mint) ?? holdings[0];
  const feeUsdc = mode === "burn_earn" ? feeEarnUsdc : feeBurnUsdc;
  const isEarn = mode === "burn_earn";

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (holdings.length === 0) {
    return <p className="text-sm font-semibold text-muted-ink">{t("noTokens")}</p>;
  }

  function startPolling(id: string, expectedPoints: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${id}`);
        if (!res.ok) return;
        const json = await res.json();
        const o = json.order;
        setOrderStatus(o.status);
        if (o.status === "confirmed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          setDone({ points: expectedPoints, tx: o.tx_signature ?? null });
          router.refresh();
        } else if (o.status === "failed" || o.status === "refunded") {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          setError(o.error ?? "Error");
        }
      } catch {
        /* lanjut poll */
      }
    }, 3000);
  }

  async function submit() {
    if (!selected) return;
    if (!idemRef.current) {
      idemRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const expectedPoints = isEarn ? Math.floor(Number(amount)) : 0;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "burn",
          kind: "mainnet",
          idempotencyKey: idemRef.current,
          config: { mint: selected.mint, amount, mode },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setOrderStatus(json.order.status);
      if (json.order.status === "confirmed") {
        setBusy(false);
        setDone({ points: expectedPoints, tx: json.order.tx_signature ?? null });
        router.refresh();
      } else {
        startPolling(json.order.id, expectedPoints);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border-2 border-black bg-[#ecfdf5] p-5 text-center">
        <p className="font-bold">{isEarn ? t("successEarn") : t("success")}</p>
        {done.points > 0 && (
          <p className="display mt-2 text-2xl text-[#15803d]">
            +{done.points.toLocaleString("en-US")} pt
          </p>
        )}
        {done.tx && (
          <a
            href={`https://explorer.solana.com/tx/${done.tx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-bold underline"
          >
            {t("viewTx")}
          </a>
        )}
        <div className="mt-4">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setDone(null);
              setAmount("");
              idemRef.current = "";
            }}
          >
            {t("again")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab mode */}
      <div className="flex gap-3">
        <button
          className={`btn flex-1 ${!isEarn ? "btn-primary" : "btn-secondary"}`}
          onClick={() => {
            setMode("burn");
            idemRef.current = "";
          }}
        >
          {t("modeBurn")}
        </button>
        <button
          className={`btn flex-1 ${isEarn ? "btn-primary" : "btn-secondary"}`}
          onClick={() => {
            setMode("burn_earn");
            idemRef.current = "";
          }}
        >
          {t("modeEarn")}
        </button>
      </div>
      <p className="text-xs font-semibold text-muted-ink">{isEarn ? t("modeEarnHint") : t("modeBurnHint")}</p>

      {/* Token */}
      <div>
        <label className="label" htmlFor="burn-token">{t("selectToken")}</label>
        <select
          id="burn-token"
          className="mt-1 w-full rounded-xl border-2 border-black bg-white px-3 py-2.5 text-sm font-bold"
          value={selected?.mint ?? ""}
          onChange={(e) => setMint(e.target.value)}
        >
          {holdings.map((h) => (
            <option key={h.mint} value={h.mint}>
              {labelOf(h.mint, meta)} — {rawToUi(h.amount, h.decimals)}
            </option>
          ))}
        </select>
      </div>

      {/* Jumlah */}
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="burn-amount">{t("amount")}</label>
          {selected && (
            <span className="text-[10px] font-bold uppercase text-muted-ink">
              {t("balance")}: {rawToUi(selected.amount, selected.decimals)}
            </span>
          )}
        </div>
        <div className="mt-1 flex gap-2">
          <input
            id="burn-amount"
            inputMode="decimal"
            className="min-w-0 flex-1 rounded-xl border-2 border-black bg-white px-3 py-2.5 text-sm font-bold"
            placeholder="1000"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          <button
            type="button"
            className="rounded-xl border-2 border-black bg-white px-3 py-2.5 text-xs font-bold uppercase shadow-[2px_2px_0_0_#000] hover:-translate-y-0.5"
            onClick={() => selected && setAmount(rawToUi(selected.amount, selected.decimals))}
          >
            {t("max")}
          </button>
        </div>
      </div>

      {/* Fee + gas */}
      <div className="rounded-xl border-2 border-black bg-[#f5f3ff] px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("fee")}</span>
          <span className="font-bold">{feeUsdc > 0 ? `${feeUsdc} USDC` : t("free")}</span>
        </div>
        <p className="mt-1 text-xs font-semibold text-muted-ink">{t("gasHint")}</p>
      </div>

      {error && (
        <p className="rounded-xl border-2 border-[#b91c1c] bg-[#fef2f2] px-3 py-2 text-sm font-bold text-[#b91c1c]">
          {error}
        </p>
      )}

      <button className="btn btn-primary w-full" disabled={busy || !amount} onClick={submit}>
        {busy || orderStatus === "processing" || orderStatus === "paid" || orderStatus === "awaiting_payment"
          ? t("processing")
          : isEarn
            ? t("submitEarn")
            : t("submitBurn")}
      </button>
    </div>
  );
}
