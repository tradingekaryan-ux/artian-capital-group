import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import {
  readOnChainBalances,
  ensureWallet,
  getActiveWallet,
  type WalletRow,
} from "@/lib/solana/wallet";
import { getTreasury, sendUsdcTransfer } from "@/lib/chain/usdc";
import { enqueue, type JobType } from "@/lib/jobs/queue";
import { getPrice, usdcToRaw, requiredSolFor, type ServiceKey } from "@/lib/payment/pricing";
import { LAMPORTS_PER_SOL, type WalletKind } from "@/lib/config";

const SERVICE_JOB: Partial<Record<ServiceKey, JobType>> = {
  create_token: "create_token",
  create_pool: "create_pool",
  add_liquidity: "add_liquidity",
  remove_liquidity: "remove_liquidity",
  swap: "swap",
  burn: "burn",
};

export interface CreateOrderInput {
  userId: string;
  service: ServiceKey;
  config: Record<string, unknown>;
  idempotencyKey?: string;
  ip?: string;
  /** `mainnet` (default) = cluster utama; `demo` = devnet, bayar USDC devnet. */
  kind?: WalletKind;
  /** Kunci harga bila berbeda dari service (burn_earn memakai tarif 'burn_earn'). */
  pricingKey?: ServiceKey;
  /**
   * Layanan yang fee/gas-nya menyusul (mis. `create_pool` dari bundling wizard):
   * di-PREFLIGHT dikenakan cek saldo USDC + SOL gabungan, tapi yang ditransfer
   * sekarang tetap hanya fee `service` utama — fee layanan menyusul di-charge
   * saat runner-nya benar-benar menjalankannya.
   */
  deferredServices?: ServiceKey[];
}

/**
 * Buat order + bayar langsung dari saldo USDC user → treasury (on-chain),
 * lalu antrikan job pekerjaan on-chain.
 * Gas on-chain (pembayaran, pekerjaan, refund) = wallet user sebagai fee-payer
 * dari saldo SOL miliknya — preflight SOL di atas mencegah order gagal di tengah.
 * Khusus `swap`: fee diambil dari hasil swap (tidak dibayar di muka).
 * Untuk `kind: "demo"`: pembayaran & pekerjaan on-chain berjalan di devnet
 * (USDC devnet dari wallet demo → treasury devnet; gas dari SOL devnet user).
 */
/**
 * Wallet sumber dana order: UTAMAKAN wallet aktif (cookie `wid`) bila jenisnya
 * cocok — multi-wallet user pasti membayar dari dompet yang sedang dipakai.
 * Fallback: wallet per-kind (auto-create bila belum ada).
 */
async function walletForPayment(userId: string, kind: WalletKind): Promise<WalletRow> {
  try {
    const active = await getActiveWallet(userId);
    if (active.kind === kind) return active;
  } catch {
    /* cookie/headers tidak tersedia (non-request ctx) → fallback */
  }
  return ensureWallet(userId, kind);
}

export async function createAndPayOrder(input: CreateOrderInput) {
  const db = supabaseAdmin();
  const kind: WalletKind = input.kind ?? "mainnet";

  if (input.idempotencyKey) {
    const { data: existing } = await db
      .from("orders")
      .select("*")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing) return { order: existing, reused: true as const };
  }

  // Wallet sumber dana: dompet aktif bila jenisnya cocok, selain itu wallet per-kind.
  const wallet = await walletForPayment(input.userId, kind);

  const price = await getPrice(input.pricingKey ?? input.service);
  const feeRaw = usdcToRaw(price.amount_usdc ?? 0);
  const payUpfront = feeRaw > 0n && input.service !== "swap";

  // Fee & gas layanan menyusul (deferred) — ikut disurf-check di muka,
  // tidak ditransfer sekarang.
  let deferredFeeRaw = 0n;
  let deferredSol = 0;
  for (const key of input.deferredServices ?? []) {
    const p = await getPrice(key);
    deferredFeeRaw += usdcToRaw(p.amount_usdc ?? 0);
    deferredSol += requiredSolFor(key);
  }

  // Cek saldo dulu agar 402 bersih tanpa menyisipkan row order.
  // SOL = gas on-chain (dibayar dari saldo user; platform tidak mendanai treasury).
  const balances = await readOnChainBalances(wallet.public_key, kind);
  if ((payUpfront || deferredFeeRaw > 0n) && balances.usdcRaw < feeRaw + deferredFeeRaw) {
    throw new OrderError(
      "INSUFFICIENT_BALANCE",
      kind === "demo"
        ? "Insufficient devnet USDC. Fund it via a faucet first (see the demo Wallet page)."
        : "Insufficient USDC to pay for this service.",
    );
  }
  const requiredSol = requiredSolFor(input.service) + deferredSol;
  if (balances.solLamports < BigInt(Math.ceil(requiredSol * LAMPORTS_PER_SOL))) {
    throw new OrderError(
      "INSUFFICIENT_SOL",
      kind === "demo"
        ? `Insufficient devnet SOL for transaction gas (need ±${requiredSol} SOL). Get SOL from a faucet, then try again.`
        : `Insufficient SOL for on-chain gas (need ±${requiredSol} SOL). Deposit SOL to your wallet address first, then try again.`,
    );
  }

  // Catat order SEBELUM bayar — jejak tetap ada walau pembayaran on-chain gagal.
  const { data: order, error: insertError } = await db
    .from("orders")
    .insert({
      user_id: input.userId,
      wallet_id: wallet.id,
      kind,
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
      const { keypairFromEncrypted } = await import("@/lib/solana/keypair");
      const userKp = keypairFromEncrypted(wallet);
      const treasury = getTreasury(kind);
      paymentSignature = await sendUsdcTransfer({
        from: userKp,
        toOwner: treasury.publicKey,
        amountRaw: feeRaw,
        feePayer: userKp, // gas dibayar user (satu signer)
        kind,
      });
    } catch (e) {
      await db
        .from("orders")
        .update({
          status: "failed",
          error: `Payment failed: ${e instanceof Error ? e.message : String(e)}`,
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
    await enqueue(jobType, { orderId: order.id, userId: input.userId, kind });
    if (payUpfront) {
      await db.from("orders").update({ status: "processing" }).eq("id", order.id);
    }
  }

  await audit({
    actor: input.userId,
    action: `order_${input.service}`,
    target: order.id,
    payload: { feeRaw: feeRaw.toString(), paymentSignature, kind },
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
