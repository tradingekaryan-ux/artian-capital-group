"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { track } from "@/lib/analytics";

interface Props {
  tokenId: string;
  mint: string;
  symbol: string;
  decimals: number;
  supply: string;
  isOwner: boolean;
  poolId: string | null;
  poolAddress: string | null;
  hasPool: boolean;
  poolFeeUsdc: number;
  addLiquidityFeeUsdc: number;
}

export function PoolPanel(props: Props) {
  if (!props.isOwner) return null;
  return props.hasPool ? <LiquidityForms {...props} /> : <CreatePoolForm {...props} />;
}

/* ─────────────── buat pool ─────────────── */
function CreatePoolForm({
  tokenId,
  decimals,
  supply,
  symbol,
  poolFeeUsdc,
}: Props) {
  const t = useTranslations("token");
  const router = useRouter();
  const [lpPct, setLpPct] = useState(50);
  const [quoteAmount, setQuoteAmount] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (pollRef.current && clearInterval(pollRef.current)), []);

  const tokenAmount = (Number(supply) * lpPct) / 100;
  const marketPct = 100 - lpPct;
  const initialPrice = Number(quoteAmount) > 0 ? Number(quoteAmount) / tokenAmount : 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "create_pool",
          config: {
            tokenId,
            lpPercentage: lpPct,
            tokenAmount: String(tokenAmount),
            quoteAmount: String(quoteAmount),
            feeBps: 25,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setOrderId(json.order.id);
      setStatus(json.order.status);
      track("create_pool_paid");
      pollRef.current = setInterval(async () => {
        const r = await fetch(`/api/orders/${json.order.id}`);
        if (!r.ok) return;
        const j = await r.json();
        setStatus(j.order.status);
        if (j.order.status === "confirmed") {
          clearInterval(pollRef.current!);
          router.refresh();
        }
        if (j.order.status === "failed" || j.order.status === "refunded") {
          clearInterval(pollRef.current!);
          setError("Pembuatan pool gagal — dana direfund.");
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (orderId) {
    const done = status === "confirmed";
    return (
      <div className="text-sm text-muted">
        {done ? "Pool aktif! Memuat ulang…" : `Memproses pembuatan pool… (${status})`}
      </div>
    );
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold">{t("createPool")}</h2>
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <label className="label" htmlFor="lp-pct">
            {t("lpPercentage")}
          </label>
          <div className="flex items-center gap-3">
            <input
              id="lp-pct"
              type="range"
              min={1}
              max={100}
              value={lpPct}
              onChange={(e) => setLpPct(Number(e.target.value))}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="mono w-10 text-right font-bold">{lpPct}%</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Pool: <strong>{formatNum(tokenAmount)} {symbol}</strong> · {t("marketPercentage")}:{" "}
            <strong>{marketPct}%</strong>
          </p>
        </div>

        <div>
          <label className="label" htmlFor="quote-amount">
            {t("quoteAmount")}
          </label>
          <input
            id="quote-amount"
            className="input"
            inputMode="decimal"
            value={quoteAmount}
            onChange={(e) => setQuoteAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          <p className="mt-1 text-xs text-muted">
            {t("initialPrice")}: <strong>${initialPrice.toExponential(3)}</strong> ·{" "}
            {decimals} decimals
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted">
          {t("poolFee")}: <strong className="text-foreground">{poolFeeUsdc} USDC</strong> ·{" "}
          Biaya jaringan ditanggung platform
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button className="btn btn-primary" onClick={submit} disabled={busy || Number(quoteAmount) <= 0}>
          {busy ? "…" : `${t("createPool")} — ${poolFeeUsdc} USDC`}
        </button>
      </div>
    </section>
  );
}

/* ─────────────── add / remove liquidity ─────────────── */
function LiquidityForms({ poolId, symbol, decimals, addLiquidityFeeUsdc, poolAddress }: Props) {
  const t = useTranslations("token");
  const router = useRouter();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!poolId) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const service = mode === "add" ? "add_liquidity" : "remove_liquidity";
      const config =
        mode === "add"
          ? {
              poolId,
              inputAmountRaw: BigInt(Math.round(Number(amount) * 10 ** decimals)).toString(),
              baseIn: true,
            }
          : {
              poolId,
              lpAmountRaw: BigInt(Math.round(Number(amount) * 10 ** 9)).toString(),
            };
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, config }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      track(service, { poolId });
      setMessage("Sedang diproses — cek halaman Orders untuk status.");
      setAmount("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-3 flex gap-2">
        <button
          className={`btn ${mode === "add" ? "btn-primary" : "btn-secondary"} flex-1`}
          onClick={() => setMode("add")}
        >
          {t("addLiquidity")}
        </button>
        <button
          className={`btn ${mode === "remove" ? "btn-primary" : "btn-secondary"} flex-1`}
          onClick={() => setMode("remove")}
        >
          {t("removeLiquidity")}
        </button>
      </div>

      <div className="flex flex-col gap-3 text-sm">
        <div>
          <label className="label" htmlFor="liq-amount">
            {mode === "add" ? `${symbol} amount` : "LP amount"}
          </label>
          <input
            id="liq-amount"
            className="input"
            inputMode="decimal"
            placeholder={mode === "add" ? "1000" : "100"}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </div>

        {mode === "add" && (
          <p className="text-xs text-muted">
            {t("poolFee")}: <strong>{addLiquidityFeeUsdc} USDC</strong> ·{" "}
            Biaya jaringan ditanggung platform
          </p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        {message && <p className="text-sm text-accent">{message}</p>}

        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={busy || !amount || Number(amount) <= 0}
        >
          {busy ? "…" : mode === "add" ? t("addLiquidity") : t("removeLiquidity")}
        </button>

        {poolAddress && (
          <p className="mono truncate text-xs text-muted">pool: {poolAddress}</p>
        )}
      </div>
    </section>
  );
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}
