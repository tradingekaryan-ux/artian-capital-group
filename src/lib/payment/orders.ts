import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { readOnChainBalances, getWalletPublicKey } from "@/lib/solana/wallet";
import { getTreasury, sendUsdcTransfer } from "@/lib/chain/usdc";
import { enqueue, type JobType } from "@/lib/jobs/queue";
import { getPrice, usdcToRaw, type ServiceKey } from "@/lib/payment/pricing";

const SERVICE_JOB: Partial<Record<ServiceKey, JobType>> = {
  create_token: "create_token",
  create_pool: "create_pool",
  add_liquidity: "add_liquidity",
  remove_liquidity: "remove_liquidity",
  swap: "swap",
};

export interface CreateOrderInput {
  userId: string;
  service: ServiceKey;
  config: Record<string, unknown>;
  idempotencyKey?: string;
  ip?: string;
}

/**
 * Buat order + bayar langsung dari saldo USDC user → treasury (on-chain),
 * lalu antrikan job pekerjaan on-chain.
 * Khusus `swap`: fee diambil dari hasil swap (tidak dibayar di muka).
 */
export async function createAndPayOrder(input: CreateOrderInput) {
  const db = supabaseAdmin();

  if (input.idempotencyKey) {
    const { data: existing } = await db
      .from("orders")
      .select("*")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing) return { order: existing, reused: true as const };
  }

  const price = await getPrice(input.service);
  const feeRaw = usdcToRaw(price.amount_usdc ?? 0);
  const payUpfront = feeRaw > 0n && input.service !== "swap";

  let paymentSignature: string | null = null;
  if (payUpfront) {
    const owner = await getWalletPublicKey(input.userId);
    const balances = await readOnChainBalances(owner.toBase58());
    if (balances.usdcRaw < feeRaw) {
      throw new OrderError("INSUFFICIENT_BALANCE", "Saldo USDC tidak cukup untuk membayar layanan.");
    }
    const { getWalletKeypair } = await import("@/lib/solana/wallet");
    const userKp = await getWalletKeypair(input.userId);
    paymentSignature = await sendUsdcTransfer({
      from: userKp,
      toOwner: getTreasury().publicKey,
      amountRaw: feeRaw,
      feePayer: getTreasury(),
    });
  }

  const { data: order, error } = await db
    .from("orders")
    .insert({
      user_id: input.userId,
      service: input.service,
      amount_raw: feeRaw.toString(),
      status: payUpfront ? "paid" : "awaiting_payment",
      pricing: price,
      config: input.config,
      payment_signature: paymentSignature,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  const jobType = SERVICE_JOB[input.service];
  if (jobType) {
    await enqueue(jobType, { orderId: order.id, userId: input.userId });
    if (payUpfront) {
      await db.from("orders").update({ status: "processing" }).eq("id", order.id);
    }
  }

  await audit({
    actor: input.userId,
    action: `order_${input.service}`,
    target: order.id,
    payload: { feeRaw: feeRaw.toString(), paymentSignature },
    ip: input.ip ?? null,
  });

  return { order, reused: false as const };
}

export class OrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Tandai order gagal setelah job gagal permanen + refund otomatis. */
export async function failOrder(orderId: string, reason: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("orders").update({ status: "failed", error: reason }).eq("id", orderId);
  await enqueue("refund", { orderId });
}
