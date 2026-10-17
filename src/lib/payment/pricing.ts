import { z } from "zod";
import { supabaseAdmin } from "@/lib/db/client";
import { USDC_DECIMALS } from "@/lib/config";

/**
 * Skema ketat untuk value pricing_config (dipakai PATCH admin) —
 * cegah config "rusak" (tipe salah / field asing) yang membuat fee gagal dihitung.
 */
export const pricingValueSchema = z
  .strictObject({
    label: z.string().max(80).optional(),
    amount_usdc: z.number().min(0).max(1_000_000).optional(),
    flat_usdc: z.number().min(0).max(1_000_000).optional(),
    percent: z.number().min(0).max(100).optional(),
    min_usdc: z.number().min(0).max(1_000_000).optional(),
    max_daily_usdc: z.number().min(0).max(1_000_000).optional(),
  })
  .refine(
    (v) => v.amount_usdc !== undefined || v.flat_usdc !== undefined || v.percent !== undefined,
    { message: "value harus memuat minimal amount_usdc, flat_usdc, atau percent" },
  );

export type ServiceKey =
  | "create_token"
  | "create_pool"
  | "add_liquidity"
  | "remove_liquidity"
  | "swap"
  | "withdraw"
  | "burn"
  | "burn_earn";

export interface PriceRow {
  amount_usdc?: number;
  percent?: number;
  flat_usdc?: number;
  min_usdc?: number;
  max_daily_usdc?: number;
  label?: string;
}

export async function getPricing(): Promise<Record<string, PriceRow>> {
  const { data } = await supabaseAdmin()
    .from("pricing_config")
    .select("key, value");
  const out: Record<string, PriceRow> = {};
  for (const row of data ?? []) out[row.key] = row.value as PriceRow;
  return out;
}

export async function getPrice(key: ServiceKey): Promise<PriceRow> {
  const all = await getPricing();
  return all[key] ?? {};
}

export function usdcToRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10 ** USDC_DECIMALS));
}

/** u64 max — batas amount SPL token on-chain. */
export const U64_MAX = 2n ** 64n - 1n;

/**
 * Konversi amount desimal (string/UI) → raw base-unit TANPA kehilangan
 * presisi Number (Math.round(n * 10**d) salah utk > 2^53).
 * Melempar bila bukan angka valid atau melebihi u64.
 */
export function uiToRaw(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`amount tidak valid: ${s}`);
  const [intPart, fracPart = ""] = s.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`amount melebihi ${decimals} desimal`);
  }
  const frac = fracPart.padEnd(decimals, "0");
  const raw = BigInt(intPart + frac);
  if (raw > U64_MAX) throw new Error("amount melebihi batas u64");
  return raw;
}

export function rawToUsdc(raw: bigint | number): number {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

/** Fee swap in-app: persen dari nilai, dengan minimum. */
export function swapFeeRaw(inAmountRaw: bigint, percent: number, minUsdc: number): bigint {
  const fee = BigInt(Math.ceil(Number(inAmountRaw) * (percent / 100)));
  const min = usdcToRaw(minUsdc);
  return fee > min ? fee : min;
}

/**
 * Estimasi minimum saldo SOL (dalam SOL, sudah termasuk buffer) yang harus
 * dimiliki wallet user PER LAYANAN — gas on-chain dibayar langsung dari saldo
 * SOL user (wallet user = fee-payer), platform tidak mendanai treasury.
 * Dipakai sebagai preflight sebelum order dibuat/dibayar (402 bila kurang).
 */
export const SOL_REQUIREMENT: Record<ServiceKey, number> = {
  create_token: 0.03, // bayar fee + mint rent + metadata + ATA + gas, buffer
  create_pool: 0.31, // bayar fee + protokol CPMM 0.15 SOL + rent pool/vault + buffer
  add_liquidity: 0.01,
  remove_liquidity: 0.01,
  swap: 0.01,
  withdraw: 0.01, // transfer fee + transfer utama + buffer
  burn: 0.01, // burnChecked + tutup ATA bila saldo 0 (reclaim rent) + buffer
  burn_earn: 0.01,
};

export function requiredSolFor(service: ServiceKey): number {
  return SOL_REQUIREMENT[service] ?? 0.01;
}

/** Total biaya withdrawal = flat + (buffer jaringan opsional). */
export async function withdrawFeeRaw(): Promise<bigint> {
  const row = await getPrice("withdraw");
  return usdcToRaw(row.flat_usdc ?? 0.5);
}
