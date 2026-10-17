import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getTreasury } from "@/lib/chain/usdc";
import { rpcRead } from "@/lib/solana/connection";
import { LAMPORTS_PER_SOL, USDC_MINT } from "@/lib/config";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";

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
 * (Untuk keperluan admin: tarik dana dari treasury ke wallet eksternal.)
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!(await rateLimit(`admin-treasury:${admin.id}`, 5, 60_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const body = json as { action?: string; toAddress?: string; amountUsdc?: number };
  if (body.action !== "withdraw_usdc") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  if (!body.toAddress || !body.amountUsdc || body.amountUsdc <= 0) {
    return NextResponse.json({ error: "toAddress and amountUsdc are required" }, { status: 400 });
  }

  try {
    const { sendUsdcTransfer } = await import("@/lib/chain/usdc");
    const t = getTreasury("mainnet");
    const toPublicKey = new PublicKey(body.toAddress);
    const amountRaw = BigInt(Math.round(body.amountUsdc * 1_000_000));

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
      target: body.toAddress,
      payload: { amountUsdc: body.amountUsdc, sig },
      ip: req.headers.get("x-forwarded-for") ?? "unknown",
    });

    return NextResponse.json({ ok: true, sig, amountUsdc: body.amountUsdc });
  } catch (e) {
    console.error("[treasury] withdraw failed:", e);
    return NextResponse.json({ error: "Withdrawal failed" }, { status: 500 });
  }
}
