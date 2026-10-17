import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";

const USDC_DECIMALS = 1_000_000n;

/**
 * Pendapatan admin (HANYA mainnet — data devnet/demo dikecualikan):
 * - Fee layanan (create_token/create_pool/add_liquidity/…) — dari orders yang SUDAH DIBAYAR.
 * - Fee withdraw — dari withdrawals.fee_raw (dikumpulkan on-chain ke treasury).
 * - Total USDC milik user yang tersimpan (kustodial) — sum balances_cache dompet mainnet.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const db = supabaseAdmin();
    const [paidOrders, withdrawals, balances, mainnetWallets] = await Promise.all([
      db
        .from("orders")
        .select("id, user_id, service, amount_raw, created_at")
        .not("payment_signature", "is", null)
        .eq("kind", "mainnet")
        .limit(20_000),
      db
        .from("withdrawals")
        .select("id, user_id, fee_raw, amount_raw, status, created_at")
        .limit(20_000),
      db.from("balances_cache").select("user_id, wallet_id, usdc_raw").limit(20_000),
      db.from("wallets").select("id").eq("kind", "mainnet").limit(50_000),
    ]);

    // Saldo kustodial hanya dari dompet mainnet (devnet dikecualikan).
    const mainnetWalletIds = new Set((mainnetWallets.data ?? []).map((w) => w.id));
    const realBalances = (balances.data ?? []).filter((b) => mainnetWalletIds.has(b.wallet_id));

    // ── agregat fee per layanan ──
    const byService = new Map<string, { count: number; feeRaw: bigint }>();
    const byUser = new Map<string, { count: number; feeRaw: bigint }>();
    let totalFeeRaw = 0n;
    const userIds = new Set<string>();

    for (const o of paidOrders.data ?? []) {
      const fee = BigInt(o.amount_raw ?? "0");
      const svc = o.service ?? "unknown";
      const s = byService.get(svc) ?? { count: 0, feeRaw: 0n };
      s.count += 1;
      s.feeRaw += fee;
      byService.set(svc, s);

      const u = byUser.get(o.user_id) ?? { count: 0, feeRaw: 0n };
      u.count += 1;
      u.feeRaw += fee;
      byUser.set(o.user_id, u);

      totalFeeRaw += fee;
      userIds.add(o.user_id);
    }

    // ── fee withdraw ──
    let withdrawFeeRaw = 0n;
    let withdrawsWithFee = 0;
    for (const w of withdrawals.data ?? []) {
      if (w.fee_raw != null) {
        withdrawFeeRaw += BigInt(w.fee_raw as string);
        withdrawsWithFee += 1;
        userIds.add(w.user_id);
      }
    }

    // ── total USDC milik user (kustodial, dompet mainnet saja) ──
    let userUsdcRaw = 0n;
    for (const b of realBalances) {
      userUsdcRaw += BigInt(b.usdc_raw ?? "0");
      userIds.add(b.user_id);
    }

    // ── label username untuk tampilan ──
    const ids = [...userIds];
    const { data: profiles } = ids.length
      ? await db.from("profiles").select("user_id, username").in("user_id", ids.slice(0, 500))
      : { data: [] as Array<{ user_id: string; username: string | null }> };
    const names = new Map((profiles ?? []).map((p) => [p.user_id, p.username ?? "user"]));

    return NextResponse.json({
      totalFeeUsdc: Number(totalFeeRaw) / Number(USDC_DECIMALS),
      withdrawFeeUsdc: Number(withdrawFeeRaw) / Number(USDC_DECIMALS),
      withdrawsWithFee,
      totalRevenueUsdc: Number(totalFeeRaw + withdrawFeeRaw) / Number(USDC_DECIMALS),
      userUsdcHeldUsdc: Number(userUsdcRaw) / Number(USDC_DECIMALS),
      userCount: new Set([...realBalances.map((b) => b.user_id), ...(paidOrders.data ?? []).map((o) => o.user_id)]).size,
      byService: [...byService.entries()]
        .map(([service, v]) => ({
          service,
          count: v.count,
          feeUsdc: Number(v.feeRaw) / Number(USDC_DECIMALS),
        }))
        .sort((a, b) => b.feeUsdc - a.feeUsdc),
      byUser: [...byUser.entries()]
        .map(([userId, v]) => ({
          userId,
          username: names.get(userId) ?? "user",
          count: v.count,
          feeUsdc: Number(v.feeRaw) / Number(USDC_DECIMALS),
        }))
        .sort((a, b) => b.feeUsdc - a.feeUsdc)
        .slice(0, 100),
    });
  } catch (e) {
    console.error("[admin] revenue failed:", e);
    return NextResponse.json({ error: "Failed to load revenue" }, { status: 500 });
  }
}
