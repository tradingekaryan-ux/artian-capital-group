import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { getTreasury } from "@/lib/chain/usdc";
import { rpcRead } from "@/lib/solana/connection";
import { LAMPORTS_PER_SOL, USDC_MINT } from "@/lib/config";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";

/** Batas penarikan treasury per transaksi (50,000 USDC). */
const MAX_TREASURY_WITHDRAWAL_USDC = 50_000;

const withdrawSchema = z.object({
  action: z.literal("withdraw_usdc"),
  toAddress: z.string().min(32).max(64),
  amountUsdc: z.number().positive().max(MAX_TREASURY_WITHDRAWAL_USDC),
});

/**
 * GET /api/admin/treasury
 * Kembalikan saldo treasury real-time (SOL + USDC) dari on-chain.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const t = getTreasury("mainnet");
    const usdcMint = new PublicKey(USDC_MINT);
    const ata = getAssociatedTokenAddressSync(usdcMint, t.publicKey);
    const [solBal, usdcBal] = await Promise.all([
      rpcRead((c) => c.getBalance(t.publicKey), "mainnet"),
      rpcRead((c) => c.getTokenAccountBalance(ata), "mainnet").catch(() => null),
    ]);
    return NextResponse.json({
      address: t.publicKey.toBase58(),
      sol: solBal / LAMPORTS_PER_SOL,
      usdc: usdcBal ? Number(usdcBal.value.uiAmountString ?? 0) : 0,
      solLamports: solBal,
      usdcRaw: usdcBal?.value?.amount ?? "0",
    });
  } catch (e) {
    console.error("[treasury] GET failed:", e);
    return NextResponse.json({ error: "Failed to fetch treasury balance" }, { status: 500 });
  }
}

/**
 * POST /api/admin/treasury
 * body: { action: "withdraw_usdc", toAddress: string, amountUsdc: number }
 * Kirim USDC dari treasury ke alamat tujuan.
 * Rate limit: 5x/menit, fail-closed (saat DB down, request DITOLAK).
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!(await rateLimit(`admin-treasury:${admin.id}`, 5, 60_000, { failOpen: false }))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = withdrawSchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Validation failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { toAddress, amountUsdc } = parsed.data;

  // Validasi Solana public key runtime (Zod hanya cek string length)
  let toPublicKey: PublicKey;
  try {
    toPublicKey = new PublicKey(toAddress);
  } catch {
    return NextResponse.json({ error: "toAddress is not a valid Solana public key" }, { status: 400 });
  }

  try {
    const { sendUsdcTransfer } = await import("@/lib/chain/usdc");
    const t = getTreasury("mainnet");
    const amountRaw = BigInt(Math.round(amountUsdc * 1_000_000));

    const sig = await sendUsdcTransfer({
      from: t,
      feePayer: t, // treasury membayar gas untuk withdraw admin
      toOwner: toPublicKey,
      amountRaw,
      kind: "mainnet",
    });

    await audit({
      actor: admin.id,
      action: "treasury_withdraw",
      target: toAddress,
      payload: { amountUsdc, sig },
      ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown",
    });

    return NextResponse.json({ ok: true, sig, amountUsdc });
  } catch (e) {
    console.error("[treasury] withdraw failed:", e);
    return NextResponse.json({ error: "Withdrawal failed" }, { status: 500 });
  }
}
