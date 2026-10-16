import { NextResponse } from "next/server";
import { requireUser } from "@/lib/db/client";
import { ensureWallet, readOnChainBalances } from "@/lib/solana/wallet";

/** Saldo on-chain terkini (USDC + SOL) untuk user login. */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const wallet = await ensureWallet(user.id);
    const balances = await readOnChainBalances(wallet.public_key);
    return NextResponse.json({
      address: wallet.public_key,
      usdc: Number(balances.usdcRaw) / 1e6,
      sol: Number(balances.solLamports) / 1e9,
      usdcRaw: balances.usdcRaw.toString(),
    });
  } catch (e) {
    console.error("[balance] gagal:", e);
    return NextResponse.json({ error: "Gagal membaca saldo" }, { status: 500 });
  }
}
