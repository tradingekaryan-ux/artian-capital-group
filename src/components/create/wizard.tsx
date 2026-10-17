"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { track } from "@/lib/analytics";
import { formatNumber } from "@/lib/format";

interface Props {
  priceUsdc: number;
  /** Fee pembuatan pool (USDC) — di-charge otomatis setelah token confirmed. */
  poolFeeUsdc: number;
  /** Estimasi gas SOL per layanan (dari SOL_REQUIREMENT server). */
  gasCreateSol: number;
  gasPoolSol: number;
  /** `demo` (devnet) = order dibayar USDC devnet, hasil token devnet. */
  kind?: "mainnet" | "demo";
}

interface WizardState {
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  logoBase64: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  discord: string;
  revokeMint: boolean;
  revokeFreeze: boolean;
  immutable: boolean;
}

const INITIAL: WizardState = {
  name: "",
  symbol: "",
  decimals: 9,
  supply: "1000000000",
  logoBase64: "",
  description: "",
  website: "",
  twitter: "",
  telegram: "",
  discord: "",
  revokeMint: true,
  revokeFreeze: true,
  immutable: false,
};

export function CreateTokenWizard({
  priceUsdc,
  poolFeeUsdc,
  gasCreateSol,
  gasPoolSol,
  kind = "mainnet",
}: Props) {
  const t = useTranslations("create");
  const tc = useTranslations("common");
  const tt = useTranslations("token");
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [balance, setBalance] = useState<number | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  // Liquidity pool awal: nominal USDC (±1 per klik) + rasio LP% (default 90/10).
  const [lpUsdc, setLpUsdc] = useState(50);
  const [lpPct, setLpPct] = useState(90);
  const [wantedPool, setWantedPool] = useState(false);
  const [poolId, setPoolId] = useState<string | null>(null);
  const [poolStage, setPoolStage] = useState<"idle" | "pending" | "confirmed" | "failed" | "skipped">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [resultMint, setResultMint] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Niat pool saat submit — dibaca closure polling yang stabil (bukan state render).
  const wantedPoolRef = useRef(false);
  // Idempotency: satu key per mount — klik ganda / retry jaringan tidak membuat 2 order.
  // Diisi lazily di handler submit (bukan saat render — aturan purity React).
  const idemRef = useRef("");

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));

  const loadBalance = useCallback(() => {
    fetch("/api/wallet/balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        if (typeof j.usdc === "number") setBalance(j.usdc);
        if (typeof j.sol === "number") setSol(j.sol);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadBalance();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadBalance]);

  async function onLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 500 * 1024) {
      setError("Logo maksimal 500KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patch({ logoBase64: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    let noPoolTicks = 0;
    let tracked = false;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${id}`);
        if (!res.ok) return;
        const json = await res.json();
        const o = json.order;
        setOrderStatus(o.status);
        if (o.token?.mint) setResultMint(o.token.mint);
        if (o.status === "confirmed" && !tracked) {
          tracked = true;
          track("token_created", { mint: o.token?.mint });
        }

        // Pool awal (bundling): pantau order pool yang dibuat runner setelah token confirmed.
        if (o.status === "confirmed" && wantedPoolRef.current) {
          const pid = (o.poolOrderId ?? null) as string | null;
          if (pid) {
            setPoolId(pid);
            setPoolStage((s) => (s === "confirmed" || s === "failed" ? s : "pending"));
            const pr = await fetch(`/api/orders/${pid}`);
            if (pr.ok) {
              const ps = (await pr.json()).order?.status;
              if (ps === "confirmed" || ps === "failed" || ps === "refunded") {
                setPoolStage(ps === "confirmed" ? "confirmed" : "failed");
                if (pollRef.current) clearInterval(pollRef.current);
              }
            }
            return;
          }
          // Runner belum sempat menulis poolOrderId (atau fee pool kurang).
          noPoolTicks += 1;
          if (noPoolTicks >= 6) {
            setPoolStage("skipped");
            if (pollRef.current) clearInterval(pollRef.current);
          }
          return;
        }

        if (o.status === "confirmed" || o.status === "failed" || o.status === "refunded") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* lanjut poll */
      }
    }, 3000);
  }

  async function submit() {
    if (!idemRef.current) {
      idemRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setBusy(true);
    setError(null);
    try {
      const wantsPool = lpUsdc > 0;
      wantedPoolRef.current = wantsPool;
      setWantedPool(wantsPool);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "create_token",
          kind,
          idempotencyKey: idemRef.current,
          config: {
            ...state,
            website: state.website || undefined,
            twitter: state.twitter || undefined,
            telegram: state.telegram || undefined,
            discord: state.discord || undefined,
            ...(wantsPool
              ? { pool: { quoteAmount: String(lpUsdc), lpPercentage: lpPct } }
              : {}),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setOrderId(json.order.id);
      setOrderStatus(json.order.status);
      track("create_token_paid", { service: "create_token" });
      startPolling(json.order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      loadBalance();
    } finally {
      setBusy(false);
    }
  }

  if (orderId) {
    const confirmed = orderStatus === "confirmed";
    const failed = orderStatus === "failed" || orderStatus === "refunded";
    const poolCreating = confirmed && wantedPool && (poolStage === "idle" || poolStage === "pending");
    return (
      <div className="card overflow-hidden text-center">
        <div className="chrome">
          <span className="chrome-dots"><span /><span /><span /></span>
          <span className="text-muted-ink">order</span>
        </div>
        <div className="p-8">
        {failed ? (
          <>
            <h2 className="display text-2xl text-[#b91c1c]">{tc("error")}</h2>
            <p className="mt-2 text-sm text-muted-ink">
              Order failed to process — funds were automatically refunded to your USDC balance.
            </p>
          </>
        ) : poolCreating ? (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-black border-t-[#d8ff3e]" />
            <p className="mt-4 text-sm font-semibold text-muted-ink">{t("poolCreating")}</p>
            <p className="mono mt-1 text-xs text-muted-ink">
              order {orderId.slice(0, 8)} · {orderStatus}
              {poolId ? ` · pool ${poolId.slice(0, 8)}` : ""}
            </p>
          </>
        ) : confirmed ? (
          <>
            <p className="display text-5xl text-[#15803d]">✓</p>
            <h2 className="display mt-2 text-2xl">{t("success")}</h2>
            {wantedPool && poolStage === "confirmed" && (
              <p className="mt-2 text-sm font-bold text-[#15803d]">{t("poolLive")}</p>
            )}
            {wantedPool && poolStage === "failed" && (
              <div className="mx-auto mt-4 max-w-md rounded-xl border-2 border-black bg-[#fef9c3] p-3 text-left text-xs font-semibold text-muted-ink">
                {t("poolFailed")}
              </div>
            )}
            {wantedPool && poolStage === "skipped" && (
              <div className="mx-auto mt-4 max-w-md rounded-xl border-2 border-black bg-[#fef9c3] p-3 text-left text-xs font-semibold text-muted-ink">
                {t("poolSkipped")}
              </div>
            )}
            {resultMint && (
              <Link href={`/token/${resultMint}`} className="btn btn-primary mt-5 inline-flex">
                {t("viewToken")}
              </Link>
            )}
          </>
        ) : (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-black border-t-[#d8ff3e]" />
            <p className="mt-4 text-sm font-semibold text-muted-ink">{t("processing")}</p>
            <p className="mono mt-1 text-xs text-muted-ink">
              order {orderId.slice(0, 8)} · {orderStatus}
            </p>
          </>
        )}
        </div>
      </div>
    );
  }

  const steps = [t("step1"), t("step2"), t("step3"), t("step4")];
  // ── Rincian biaya (live) ──────────────────────────────────────────────
  const poolActive = lpUsdc > 0;
  const feeNow = priceUsdc;
  const feeAfter = poolActive ? poolFeeUsdc : 0;
  const totalUsdcFees = feeNow + feeAfter;
  const totalGas = gasCreateSol + (poolActive ? gasPoolSol : 0);
  const insuffUsdc = balance !== null && balance < totalUsdcFees;
  const insuffSol = sol !== null && sol < totalGas;
  const insufficient = insuffUsdc || insuffSol;
  // ── Derivasi market dari stepper ──────────────────────────────────────
  const supplyNum = Number(state.supply) || 0;
  const poolTokens = (supplyNum * lpPct) / 100;
  const initialPrice = poolTokens > 0 ? lpUsdc / poolTokens : 0;
  const marketCap = lpPct > 0 ? (lpUsdc * 100) / lpPct : 0;

  return (
    <div className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /><span /></span>
        <span className="text-muted-ink">step {step + 1}/4</span>
        {kind === "demo" && (
          <span className="rounded-full border-2 border-black bg-[#d8ff3e] px-2 py-0.5 text-[10px] font-bold uppercase">
            Demo · devnet
          </span>
        )}
      </div>
      <div className="p-6">
      {kind === "demo" && (
        <p className="mb-4 rounded-xl border-2 border-black bg-[#ede9fe] p-3 text-xs font-bold text-muted-ink">
          You are creating this token on DEVNET (demo). This token has no real value —
          practice here before doing it on mainnet.
        </p>
      )}
      {/* progress */}
      <ol className="mb-6 flex gap-2 text-[11px] font-bold uppercase tracking-wide">
        {steps.map((label, i) => (
          <li
            key={label}
            className={`flex-1 rounded-xl border-2 border-black px-2 py-2 text-center ${
              i === step
                ? "bg-[#d8ff3e] text-ink shadow-[3px_3px_0_0_#000]"
                : i < step
                  ? "bg-[#ede9fe] text-ink"
                  : "bg-white text-muted-ink"
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="c-name">
              {t("name")}
            </label>
            <input
              id="c-name"
              className="input"
              value={state.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Artian Coin"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="c-symbol">
                {t("symbol")}
              </label>
              <input
                id="c-symbol"
                className="input uppercase"
                value={state.symbol}
                onChange={(e) => patch({ symbol: e.target.value.toUpperCase().slice(0, 10) })}
                placeholder="ARTN"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="c-decimals">
                {t("decimals")}
              </label>
              <select
                id="c-decimals"
                className="input"
                value={state.decimals}
                onChange={(e) => patch({ decimals: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 6, 9].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="c-supply">
              {t("supply")}
            </label>
            <input
              id="c-supply"
              className="input"
              inputMode="numeric"
              value={state.supply}
              onChange={(e) => patch({ supply: e.target.value.replace(/\D/g, "") })}
              required
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="c-logo">
              {t("logo")}
            </label>
            <input
              id="c-logo"
              type="file"
              accept="image/*"
              className="input"
              onChange={(e) => onLogo(e.target.files?.[0])}
            />
            {state.logoBase64 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.logoBase64} alt="" className="mt-2 h-16 w-16 rounded-full object-cover" />
            )}
          </div>
          <div>
            <label className="label" htmlFor="c-desc">
              {t("description")}
            </label>
            <textarea
              id="c-desc"
              className="input min-h-24"
              maxLength={500}
              value={state.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SocialInput label={t("website")} value={state.website} onChange={(v) => patch({ website: v })} />
            <SocialInput label={t("twitter")} value={state.twitter} onChange={(v) => patch({ twitter: v })} />
            <SocialInput label={t("telegram")} value={state.telegram} onChange={(v) => patch({ telegram: v })} />
            <SocialInput label={t("discord")} value={state.discord} onChange={(v) => patch({ discord: v })} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <Checkbox
            label={t("revokeMint")}
            checked={state.revokeMint}
            onChange={(v) => patch({ revokeMint: v })}
          />
          <Checkbox
            label={t("revokeFreeze")}
            checked={state.revokeFreeze}
            onChange={(v) => patch({ revokeFreeze: v })}
          />
          <Checkbox
            label={t("immutable")}
            checked={state.immutable}
            onChange={(v) => patch({ immutable: v })}
          />
          <p className="rounded-xl border-2 border-black bg-[#ede9fe] p-3 text-xs font-medium text-muted-ink">
            {tc("networkFee")}
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          {/* rincian token */}
          <dl className="flex flex-col divide-y divide-black/10 rounded-xl border-2 border-black text-sm">
            <Row label={t("name")} value={state.name || "—"} />
            <Row label={t("symbol")} value={state.symbol || "—"} />
            <Row label={t("supply")} value={state.supply || "—"} />
            <Row label={t("decimals")} value={String(state.decimals)} />
            <Row label={t("revokeMint")} value={state.revokeMint ? "✓" : "✗"} />
            <Row label={t("revokeFreeze")} value={state.revokeFreeze ? "✓" : "✗"} />
            <Row label={t("immutable")} value={state.immutable ? "✓" : "✗"} />
          </dl>

          {/* liquidity awal — stepper ±1 USDC + rasio LP% */}
          <section className="rounded-xl border-2 border-black bg-[#f5f3ff] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-ink">
                {t("liquidityTitle")}
              </h3>
              <span className="mono text-[10px] font-bold uppercase text-muted-ink">
                {kind === "demo" ? "devnet" : "mainnet"}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                className="btn btn-secondary !px-4 !py-2"
                onClick={() => setLpUsdc((v) => Math.max(0, v - 1))}
                disabled={lpUsdc <= 0 || busy}
                aria-label="minus 1 USDC"
              >
                −
              </button>
              <div className="mono flex-1 rounded-xl border-2 border-black bg-white px-3 py-2 text-center font-bold">
                {lpUsdc} USDC
              </div>
              <button
                type="button"
                className="btn btn-secondary !px-4 !py-2"
                onClick={() => setLpUsdc((v) => v + 1)}
                disabled={busy}
                aria-label="plus 1 USDC"
              >
                +
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <input
                id="c-lppct"
                type="range"
                min={1}
                max={100}
                value={lpPct}
                onChange={(e) => setLpPct(Number(e.target.value))}
                disabled={busy}
                className="flex-1 accent-black"
              />
              <span className="mono w-20 text-right text-sm font-bold">{lpPct}% LP</span>
            </div>
            <p className="mt-1 text-xs text-muted-ink">
              {t("lpShare")}: <strong>{lpPct}%</strong> · {t("marketShare")}:{" "}
              <strong>{100 - lpPct}%</strong>
              {poolActive && (
                <>
                  {" "}· Pool:{" "}
                  <strong>
                    {formatNumber(poolTokens)} {state.symbol || "tokens"}
                  </strong>
                </>
              )}
            </p>
            {poolActive ? (
              <dl className="mt-3 flex flex-col divide-y divide-black/10 rounded-xl border-2 border-black bg-white text-sm">
                <Row label={tt("initialPrice")} value={`$${initialPrice.toExponential(3)}`} />
                <Row label={t("marketCapLaunch")} value={`${formatNumber(marketCap)} USDC`} />
              </dl>
            ) : (
              <p className="mt-3 text-xs font-semibold text-muted-ink">{t("noPoolYet")}</p>
            )}
          </section>

          {/* rincian biaya & gas */}
          <section className="rounded-xl border-2 border-black p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-ink">
              {t("feeTitle")}
            </h3>
            <dl className="mt-2 flex flex-col divide-y divide-black/10 text-sm">
              <Row label={t("feeService")} value={`${feeNow} USDC`} />
              <Row label={t("feeGasCreate")} value={`±${gasCreateSol} SOL`} />
              {poolActive && <Row label={t("feePool")} value={`${feeAfter} USDC`} />}
              {poolActive && <Row label={t("feeGasPool")} value={`±${gasPoolSol} SOL`} />}
              {poolActive && <Row label={t("feeLiquidity")} value={`${lpUsdc} USDC`} />}
              <Row label={t("totalFees")} value={`${totalUsdcFees} USDC`} />
              <Row label={t("totalGas")} value={`±${totalGas} SOL`} />
            </dl>
            {poolActive && (
              <p className="mt-2 text-[11px] font-semibold text-muted-ink">{t("chargedAfter")}</p>
            )}
          </section>

          {/* saldo & bayar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-muted-ink">
            <span>
              {tc("usdcBalance")}:{" "}
              <strong className={insuffUsdc ? "text-[#b91c1c]" : "text-[#15803d]"}>
                {balance === null ? "…" : balance}
              </strong>
              {" · "}
              {tc("solBalance")}:{" "}
              <strong className={insuffSol ? "text-[#b91c1c]" : "text-[#15803d]"}>
                {sol === null ? "…" : sol}
              </strong>
            </span>
            <span className="mono">
              {t("dueNow")}: {feeNow} USDC
            </span>
          </div>
          {insuffUsdc && (
            <Link href="/dashboard/wallet" className="text-sm font-bold underline decoration-2 underline-offset-2">
              {t("insufficient")}
            </Link>
          )}
          {insuffSol && (
            <p className="text-sm font-bold text-[#b91c1c]">
              {t("insufficientSol", { amount: totalGas })}
            </p>
          )}
          {error && <p className="text-sm font-bold text-[#b91c1c]">{error}</p>}
          <button className="btn btn-primary" onClick={submit} disabled={busy || insufficient}>
            {busy ? "…" : `${t("payCta")} — ${feeNow} USDC`}
          </button>
        </div>
      )}

      {/* navigasi */}
      <div className="mt-6 flex justify-between">
        <button
          className="btn btn-secondary"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
        >
          ←
        </button>
        {step < 3 && (
          <button
            className="btn btn-primary"
            onClick={() => setStep((s) => s + 1)}
            disabled={
              (step === 0 && (!state.name.trim() || !/^[A-Z0-9]{2,10}$/.test(state.symbol))) ||
              (step === 1 && !state.logoBase64)
            }
          >
            →
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className="text-xs font-bold uppercase tracking-wide text-muted-ink">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function SocialInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input text-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-black bg-[#f5f3ff] p-3 text-sm font-semibold shadow-[3px_3px_0_0_#000]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-black"
      />
      {label}
    </label>
  );
}
