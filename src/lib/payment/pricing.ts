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
  | "withdraw";

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

export function rawToUsdc(raw: bigint | number): number {
  return Number(raw) / 10 ** USDC_DECIMALS;
}

/** Fee swap in-app: persen dari nilai, dengan minimum. */
export function swapFeeRaw(inAmountRaw: bigint, percent: number, minUsdc: number): bigint {
  const fee = BigInt(Math.ceil(Number(inAmountRaw) * (percent / 100)));
  const min = usdcToRaw(minUsdc);
  return fee > min ? fee : min;
}

/** Total biaya withdrawal = flat + (buffer jaringan opsional). */
export async function withdrawFeeRaw(): Promise<bigint> {
  const row = await getPrice("withdraw");
  return usdcToRaw(row.flat_usdc ?? 0.5);
}
