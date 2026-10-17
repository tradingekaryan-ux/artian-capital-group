import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { getPricing } from "@/lib/payment/pricing";
import { rpcRead } from "@/lib/solana/connection";
import { getTreasury } from "@/lib/chain/usdc";
import { LAMPORTS_PER_SOL } from "@/lib/config";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const db = supabaseAdmin();
    const [jobs, orders, withdrawals] = await Promise.all([
      db
        .from("jobs")
        .select("id, type, status, attempts, last_error, run_at")
        .order("id", { ascending: false })
        .limit(30),
      db
        .from("orders")
        .select("id, service, amount_raw, status, created_at")
        .eq("kind", "mainnet")
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("withdrawals")
        .select("id, amount_raw, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const pricing = await getPricing();
    const pendingJobs = jobs.data?.filter((j) => j.status === "pending").length ?? 0;

    let treasury = { sol: 0, usdc: 0 };
    try {
      const [{ PublicKey }] = await Promise.all([import("@solana/web3.js")]);
      const { USDC_MINT } = await import("@/lib/config");
      const t = getTreasury();
      const usdcMint = new PublicKey(USDC_MINT);
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const ata = getAssociatedTokenAddressSync(usdcMint, t.publicKey);
      const [solBal, usdcBal] = await Promise.all([
        rpcRead((c) => c.getBalance(t.publicKey)),
        rpcRead((c) => c.getTokenAccountBalance(ata)).catch(() => null),
      ]);
      treasury = {
        sol: solBal / LAMPORTS_PER_SOL,
        usdc: usdcBal ? Number(usdcBal.value.uiAmountString ?? 0) : 0,
      };
    } catch {
      /* TREASURY_SECRET_KEY belum di-set — tampilkan nol */
    }

    return NextResponse.json({
      pricing,
      jobs: { list: jobs.data ?? [], pending: pendingJobs },
      orders: orders.data ?? [],
      withdrawals: withdrawals.data ?? [],
      treasury,
    });
  } catch (e) {
    console.error("[admin] overview failed:", e);
    return NextResponse.json({ error: "Failed to load overview" }, { status: 500 });
  }
}
