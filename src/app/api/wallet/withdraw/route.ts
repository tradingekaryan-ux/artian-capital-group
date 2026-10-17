import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { getActiveWallet, readOnChainBalances } from "@/lib/solana/wallet";
import { createWithdrawOtp } from "@/lib/security/otp";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";
import { getPrice, usdcToRaw } from "@/lib/payment/pricing";
import { LIMITS } from "@/lib/config";

const bodySchema = z.object({
  amount_usdc: z.number().positive().max(1_000_000),
  destination: z.string().min(32).max(64),
});

export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Akun ditangguhkan. Hubungi admin." }, { status: 403 });
  }
  const user = auth.user;

  const ip = clientIp(req);
  if (!rateLimit(`withdraw:${user.id}`, LIMITS.withdrawPerHour, 3_600_000)) {
    return NextResponse.json({ error: "Batas penarikan terlampaui, coba besok." }, { status: 429 });
  }
  if (!rateLimit(`withdraw-ip:${ip}`, LIMITS.withdrawPerHour * 3, 3_600_000)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  const { amount_usdc, destination } = parsed.data;
  try {
    new PublicKey(destination);
  } catch {
    return NextResponse.json({ error: "Alamat tujuan bukan Solana address yang valid" }, { status: 400 });
  }

  try {
    const wallet = await getActiveWallet(user.id);
    if (wallet.kind === "demo") {
      return NextResponse.json(
        { error: "Penarikan tidak tersedia di wallet demo (devnet)." },
        { status: 403 },
      );
    }
    if (destination === wallet.public_key) {
      return NextResponse.json({ error: "Alamat tujuan sama dengan dompetmu" }, { status: 400 });
    }

    const fee = await getPrice("withdraw");
    const feeRaw = usdcToRaw(fee.flat_usdc ?? fee.amount_usdc ?? 0.5);
    const amountRaw = usdcToRaw(amount_usdc);
    const totalRaw = amountRaw + feeRaw;

    const balances = await readOnChainBalances(wallet.public_key, "mainnet");
    if (balances.usdcRaw < totalRaw) {
      return NextResponse.json(
        {
          error: "Saldo USDC tidak cukup (jumlah + fee penarikan).",
          code: "INSUFFICIENT_BALANCE",
          balanceUsdc: Number(balances.usdcRaw) / 1e6,
          requiredUsdc: Number(totalRaw) / 1e6,
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
    console.error("[withdraw] gagal:", e);
    return NextResponse.json({ error: "Gagal memproses penarikan" }, { status: 500 });
  }
}
