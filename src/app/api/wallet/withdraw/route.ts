import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { getActiveWallet, readOnChainBalances } from "@/lib/solana/wallet";
import { createWithdrawOtp } from "@/lib/security/otp";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";
import { getPrice, usdcToRaw, requiredSolFor } from "@/lib/payment/pricing";
import { LIMITS, LAMPORTS_PER_SOL } from "@/lib/config";

const bodySchema = z.object({
  amount_usdc: z.number().positive().max(1_000_000),
  destination: z.string().min(32).max(64),
});

export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended. Contact admin." }, { status: 403 });
  }
  const user = auth.user;

  const ip = clientIp(req);
  if (!(await rateLimit(`withdraw:${user.id}`, LIMITS.withdrawPerHour, 3_600_000))) {
    return NextResponse.json({ error: "Daily withdrawal limit reached, try again tomorrow." }, { status: 429 });
  }
  if (!(await rateLimit(`withdraw-ip:${ip}`, LIMITS.withdrawPerHour * 3, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 400 },
    );
  }

  const { amount_usdc, destination } = parsed.data;
  try {
    new PublicKey(destination);
  } catch {
    return NextResponse.json({ error: "Destination address is not a valid Solana address" }, { status: 400 });
  }

  try {
    const wallet = await getActiveWallet(user.id);
    if (wallet.kind === "demo") {
      return NextResponse.json(
        { error: "Withdrawals are not available on the demo wallet (devnet)." },
        { status: 403 },
      );
    }
    if (destination === wallet.public_key) {
      return NextResponse.json({ error: "Destination address is the same as your wallet" }, { status: 400 });
    }

    const fee = await getPrice("withdraw");
    const feeRaw = usdcToRaw(fee.flat_usdc ?? fee.amount_usdc ?? 0.5);
    const amountRaw = usdcToRaw(amount_usdc);
    const totalRaw = amountRaw + feeRaw;

    const balances = await readOnChainBalances(wallet.public_key, "mainnet");
    if (balances.usdcRaw < totalRaw) {
      return NextResponse.json(
        {
          error: "Insufficient USDC (amount + withdrawal fee).",
          code: "INSUFFICIENT_BALANCE",
          balanceUsdc: Number(balances.usdcRaw) / 1e6,
          requiredUsdc: Number(totalRaw) / 1e6,
        },
        { status: 402 },
      );
    }
    // Gas penarikan dibayar dari saldo SOL user (fee-payer = user) — preflight.
    const requiredSol = requiredSolFor("withdraw");
    if (balances.solLamports < BigInt(Math.ceil(requiredSol * LAMPORTS_PER_SOL))) {
      return NextResponse.json(
        {
          error: `Insufficient SOL for withdrawal gas (need ±${requiredSol} SOL). Deposit SOL first, then try again.`,
          code: "INSUFFICIENT_SOL",
        },
        { status: 402 },
      );
    }

    const db = supabaseAdmin();
    const { data: w, error } = await db
      .from("withdrawals")
      .insert({
        user_id: user.id,
        wallet_id: wallet.id,
        amount_raw: amountRaw.toString(),
        destination,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;

    const otp = await createWithdrawOtp(String(w.id), user.id, user.email ?? "");

    await audit({
      actor: user.id,
      action: "withdraw_requested",
      target: String(w.id),
      payload: { amount_usdc, destination, feeRaw: feeRaw.toString() },
      ip,
    });

    return NextResponse.json({ id: w.id, otpSent: true, devCode: otp.devCode });
  } catch (e) {
    console.error("[withdraw] failed:", e);
    return NextResponse.json({ error: "Failed to process withdrawal" }, { status: 500 });
  }
}
