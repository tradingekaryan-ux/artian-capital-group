import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { getActiveWallet, readOnChainBalances } from "@/lib/solana/wallet";
import { rpcRead } from "@/lib/solana/connection";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";
import { getPrice, swapFeeRaw } from "@/lib/payment/pricing";
import { enqueue } from "@/lib/jobs/queue";
import { SOL_MINT, LAMPORTS_PER_SOL, LIMITS } from "@/lib/config";

const bodySchema = z.object({
  asset: z.union([z.literal("SOL"), z.string().min(32).max(64)]), // "SOL" atau mint address
  amount: z.number().positive(),
});

export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Akun ditangguhkan. Hubungi admin." }, { status: 403 });
  }
  const user = auth.user;

  const ip = clientIp(req);
  if (!(await rateLimit(`swap:${user.id}`, LIMITS.orderPerHour, 3_600_000))) {
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
    return NextResponse.json({ error: "Validasi gagal" }, { status: 400 });
  }

  const { asset, amount } = parsed.data;
  const isSol = asset === "SOL";

  try {
    const wallet = await getActiveWallet(user.id);
    if (wallet.kind === "demo") {
      return NextResponse.json(
        { error: "Swap tidak tersedia di wallet demo (devnet)." },
        { status: 403 },
      );
    }
    // Selalu pakai wallet AKTIF (sudah pasti mainnet — demo ditolak di atas):
    // konsisten dengan cek saldo & sumber dana eksekusi job.
    const owner = new PublicKey(wallet.public_key);

    let inputMint = asset;
    let amountRaw: bigint;
    let decimals = 9;

    if (isSol) {
      inputMint = SOL_MINT;
      amountRaw = BigInt(Math.round(amount * LAMPORTS_PER_SOL));
      const balances = await readOnChainBalances(wallet.public_key, "mainnet");
      if (balances.solLamports < amountRaw + BigInt(0.01 * LAMPORTS_PER_SOL)) {
        return NextResponse.json({ error: "Saldo SOL tidak cukup (butuh sedikit SOL untuk fee)." }, { status: 402 });
      }
    } else {
      // hanya token buatan user yang didukung (kita tahu decimals-nya)
      const db = supabaseAdmin();
      const { data: token } = await db
        .from("tokens")
        .select("mint, decimals")
        .eq("mint", asset)
        .eq("user_id", user.id)
        .eq("kind", "mainnet")
        .maybeSingle();
      if (!token) {
        return NextResponse.json(
          { error: "Aset tidak didukung. Untuk MVP, swap dari SOL atau token buatanmu sendiri." },
          { status: 400 },
        );
      }
      decimals = token.decimals;
      amountRaw = BigInt(Math.round(amount * 10 ** decimals));

      // cek saldo token: getAccountInfo dulu — null = ATA belum ada (saldo 0).
      // RPC gagal sungguhan MELEMPAR (→ 500 di catch luar), bukan "tidak cukup".
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const ata = getAssociatedTokenAddressSync(new PublicKey(asset), owner);
      const acctInfo = await rpcRead((c) => c.getAccountInfo(ata));
      const held = acctInfo
        ? BigInt((await rpcRead((c) => c.getTokenAccountBalance(ata))).value.amount)
        : 0n;
      if (held < amountRaw) {
        return NextResponse.json({ error: "Saldo token tidak cukup." }, { status: 402 });
      }
    }

    const fee = await getPrice("swap");
    const feeRaw = swapFeeRaw(amountRaw, fee.percent ?? 0.3, fee.min_usdc ?? 0.05);

    const db = supabaseAdmin();
    const { data: order, error } = await db
      .from("orders")
      .insert({
        user_id: user.id,
        wallet_id: wallet.id,
        kind: "mainnet",
        service: "swap",
        amount_raw: feeRaw.toString(),
        status: "processing",
        pricing: fee,
        config: { inputMint, amountRaw: amountRaw.toString(), decimals },
      })
      .select("*")
      .single();
    if (error) throw error;

    await enqueue("swap", { orderId: order.id, userId: user.id, kind: "mainnet" });
    await audit({
      actor: user.id,
      action: "swap_requested",
      target: order.id,
      payload: { inputMint, amount: amountRaw.toString(), feeRaw: feeRaw.toString() },
      ip,
    });

    return NextResponse.json({ order, feeRaw: feeRaw.toString() });
  } catch (e) {
    console.error("[swap] gagal:", e);
    return NextResponse.json({ error: "Gagal memproses swap" }, { status: 500 });
  }
}
