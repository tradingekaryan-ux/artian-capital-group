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

  // Cek saldo dulu agar 402 bersih tanpa menyisipkan row order.
  if (payUpfront) {
    const owner = await getWalletPublicKey(input.userId);
    const balances = await readOnChainBalances(owner.toBase58());
    if (balances.usdcRaw < feeRaw) {
      throw new OrderError("INSUFFICIENT_BALANCE", "Saldo USDC tidak cukup untuk membayar layanan.");
    }
  }

  // Catat order SEBELUM bayar — jejak tetap ada walau pembayaran on-chain gagal.
  const { data: order, error: insertError } = await db
    .from("orders")
    .insert({
      user_id: input.userId,
      service: input.service,
      amount_raw: feeRaw.toString(),
      status: "awaiting_payment",
      pricing: price,
      config: input.config,
      payment_signature: null,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select("*")
    .single();
  if (insertError) {
    // Race idempotencyKey: request kedua kena unique-violation → kembalikan order existing.
    if (insertError.code === "23505" && input.idempotencyKey) {
      const { data: existing } = await db
        .from("orders")
        .select("*")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing) return { order: existing, reused: true as const };
    }
    throw insertError;
  }

  let paymentSignature: string | null = null;
  if (payUpfront) {
    try {
      const { getWalletKeypair } = await import("@/lib/solana/wallet");
      const userKp = await getWalletKeypair(input.userId);
      paymentSignature = await sendUsdcTransfer({
        from: userKp,
        toOwner: getTreasury().publicKey,
        amountRaw: feeRaw,
        feePayer: getTreasury(),
      });
    } catch (e) {
      await db
        .from("orders")
        .update({
          status: "failed",
          error: `Pembayaran gagal: ${e instanceof Error ? e.message : String(e)}`,
        })
        .eq("id", order.id);
      throw e;
    }
    const { data: paidOrder, error: payError } = await db
      .from("orders")
      .update({ status: "paid", payment_signature: paymentSignature })
      .eq("id", order.id)
      .select("*")
      .single();
    if (payError) throw payError;
    Object.assign(order, paidOrder);
  }

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

/**
 * Tandai order gagal setelah job gagal permanen + refund otomatis bila perlu.
 * Anti-loop: refund hanya di sekali — bila status sudah failed/refunded atau
 * tidak ada pembayaran, tidak ada job refund baru.
 */
export async function failOrder(orderId: string, reason: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: current } = await db
    .from("orders")
    .select("status, payment_signature")
    .eq("id", orderId)
    .maybeSingle();
  if (!current) return;
  if (current.status === "failed" || current.status === "refunded") return;
  await db.from("orders").update({ status: "failed", error: reason }).eq("id", orderId);
  if (current.payment_signature) {
    await enqueue("refund", { orderId });
  }
}
