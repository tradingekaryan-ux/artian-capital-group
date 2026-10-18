import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { getActiveWallet, readOnChainBalances, type WalletRow } from "@/lib/solana/wallet";
import { keypairFromEncrypted } from "@/lib/solana/keypair";
import { uiToRaw } from "@/lib/payment/pricing";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { LAMPORTS_PER_SOL } from "@/lib/config";
import type { Keypair, PublicKey, Transaction } from "@solana/web3.js";

/**
 * Operasi dompet user oleh admin (custodial):
 *   POST   /api/admin/users/[userId]/wallet — topup / withdraw (mainnet, USDC/SOL)
 *   DELETE /api/admin/users/[userId]/wallet?walletId=… — hapus dompet user
 *
 * Desain:
 * - Mitra transaksi SELALu wallet aktif admin (mainnet) — sama seperti
 *   /api/admin/treasury. Gas SELALU dibayar wallet admin (feePayer), jadi
 *   dompet user tidak perlu punya SOL untuk withdraw USDC.
 * - Topup:  wallet admin → dompet user.  Withdraw: dompet user → wallet admin.
 * - Guard railing per transaksi + cek saldo on-chain sebelum kirim.
 * - Hapus dompet: wajib saldo on-chain hampir nol (USDC = 0, SOL < 0.001);
 *   bila masih ada dana, admin diminta withdraw dulu (sweep). Baris FK lain
 *   (orders, wallet_events, dst.) `on delete set null`; balances_cache
 *   (PK, tanpa FK) dihapus manual.
 */
const MAX_USDC = 50_000;
const MAX_SOL = 1_000;
const GAS_BUFFER_LAMPORTS = 10_000_000n; // 0.01 SOL
const DUST_LAMPORTS = 100_000n; // 0.001 SOL — ambang "SOL nol" saat hapus dompet
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postSchema = z.object({
  action: z.enum(["topup", "withdraw"]),
  asset: z.enum(["usdc", "sol"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Invalid amount"),
  walletId: z.string().regex(UUID_RE, "Invalid wallet id").optional(),
});

const SELECT_TARGET =
  "id, user_id, kind, public_key, enc_secret_key, iv, auth_tag, archived_at, created_at";

async function findTargetWallet(userId: string, walletId?: string): Promise<WalletRow | null> {
  const db = supabaseAdmin();
  let q = db
    .from("wallets")
    .select(SELECT_TARGET)
    .eq("user_id", userId)
    .eq("kind", "mainnet");
  if (walletId) q = q.eq("id", walletId);
  const { data } = await q.order("created_at", { ascending: true }).limit(1);
  return ((data ?? [])[0] as unknown as WalletRow | undefined) ?? null;
}

/** POST — topup / withdraw dompet user. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Fail-closed (saat DB down, request DITOLAK) — operasi keuangan.
  if (!(await rateLimit(`admin-userwallet:${admin.id}`, 5, 60_000, { failOpen: false }))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { userId } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Validation failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { action, asset, walletId } = parsed.data;

  let amountRaw: bigint;
  try {
    amountRaw = uiToRaw(parsed.data.amount, asset === "usdc" ? 6 : 9);
  } catch {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (amountRaw <= 0n) {
    return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
  }
  const maxRaw = uiToRaw(asset === "usdc" ? String(MAX_USDC) : String(MAX_SOL), asset === "usdc" ? 6 : 9);
  if (amountRaw > maxRaw) {
    return NextResponse.json(
      { error: `Amount exceeds limit (${MAX_USDC} USDC / ${MAX_SOL} SOL per transaction)` },
      { status: 400 },
    );
  }

  const target = await findTargetWallet(userId, walletId);
  if (!target) {
    return NextResponse.json({ error: "Wallet not found (mainnet-only)." }, { status: 404 });
  }

  // Mitra + fee-payer: wallet aktif admin (mainnet).
  const wallet = await getActiveWallet(admin.id).catch(() => null);
  if (!wallet || wallet.kind !== "mainnet") {
    return NextResponse.json(
      { error: "Switch to a mainnet wallet first (admin transfers are mainnet-only)." },
      { status: 400 },
    );
  }

  try {
    const { sendUsdcTransfer } = await import("@/lib/chain/usdc");
    const { PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = await import(
      "@solana/web3.js"
    );

    const adminKp = keypairFromEncrypted(wallet);
    let source: Keypair;
    let destOwner: PublicKey;
    let feePayer: Keypair;

    if (action === "topup") {
      // Sumber: wallet aktif admin → tujuan: dompet user. Gas: admin.
      const bal = await readOnChainBalances(wallet.public_key, "mainnet");
      if (asset === "usdc") {
        if (bal.usdcRaw < amountRaw) {
          return NextResponse.json({ error: "Insufficient USDC in your active wallet." }, { status: 400 });
        }
        if (bal.solLamports < GAS_BUFFER_LAMPORTS) {
          return NextResponse.json({ error: "Insufficient SOL in your active wallet for gas (need ~0.01 SOL)." }, { status: 400 });
        }
      } else {
        if (bal.solLamports < amountRaw + GAS_BUFFER_LAMPORTS) {
          return NextResponse.json({ error: "Insufficient SOL in your active wallet (amount + ~0.01 SOL gas)." }, { status: 400 });
        }
      }
      source = adminKp;
      destOwner = new PublicKey(target.public_key as string);
      feePayer = adminKp;
    } else {
      // Sumber: dompet user → tujuan: wallet aktif admin. Gas: admin (feePayer).
      const bal = await readOnChainBalances(target.public_key as string, "mainnet");
      if (asset === "usdc") {
        if (bal.usdcRaw < amountRaw) {
          return NextResponse.json({ error: "Insufficient USDC in this wallet." }, { status: 400 });
        }
        const adminBal = await readOnChainBalances(wallet.public_key, "mainnet");
        if (adminBal.solLamports < GAS_BUFFER_LAMPORTS) {
          return NextResponse.json({ error: "Insufficient SOL in your active wallet for gas (need ~0.01 SOL)." }, { status: 400 });
        }
      } else {
        if (bal.solLamports < amountRaw) {
          return NextResponse.json({ error: "Insufficient SOL in this wallet." }, { status: 400 });
        }
        const adminBal = await readOnChainBalances(wallet.public_key, "mainnet");
        if (adminBal.solLamports < GAS_BUFFER_LAMPORTS) {
          return NextResponse.json({ error: "Insufficient SOL in your active wallet for gas (need ~0.01 SOL)." }, { status: 400 });
        }
      }
      source = keypairFromEncrypted(target as unknown as Parameters<typeof keypairFromEncrypted>[0]);
      destOwner = new PublicKey(wallet.public_key);
      feePayer = adminKp;
    }

    let sig: string;
    if (asset === "usdc") {
      sig = await sendUsdcTransfer({
        from: source,
        feePayer,
        toOwner: destOwner,
        amountRaw,
        kind: "mainnet",
      });
    } else {
      const conn = (await import("@/lib/solana/connection")).getConnection("mainnet");
      const tx: Transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: source.publicKey,
          toPubkey: destOwner,
          lamports: Number(amountRaw),
        }),
      );
      const signers = feePayer.publicKey.equals(source.publicKey) ? [feePayer] : [feePayer, source];
      sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
    }

    const amountUi = asset === "usdc" ? Number(amountRaw) / 1_000_000 : Number(amountRaw) / LAMPORTS_PER_SOL;
    await audit({
      actor: admin.id,
      action: action === "topup" ? "admin_wallet_topup" : "admin_wallet_withdraw",
      target: target.public_key as string,
      payload: { userId, walletId: target.id as string, asset, amount: amountUi, sig },
      ip: clientIp(req),
    });

    return NextResponse.json({ ok: true, sig, asset, amount: amountUi });
  } catch (e) {
    console.error(`[admin-userwallet] ${action} failed:`, e);
    return NextResponse.json({ error: "Transfer failed — check balances and try again." }, { status: 500 });
  }
}

/** DELETE — hapus dompet user (saldo on-chain wajib hampir nol). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await rateLimit(`admin-userwallet-del:${admin.id}`, 5, 60_000, { failOpen: false }))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { userId } = await params;
  const walletId = new URL(req.url).searchParams.get("walletId");
  if (!walletId || !UUID_RE.test(walletId)) {
    return NextResponse.json({ error: "walletId is required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: w } = await db
    .from("wallets")
    .select("id, user_id, public_key, kind, archived_at")
    .eq("id", walletId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!w) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  // Mainnet: pastikan benar-benar kosong sebelum kunci dihancurkan permanen.
  if (w.kind === "mainnet") {
    let bal: { usdcRaw: bigint; solLamports: bigint };
    try {
      bal = await readOnChainBalances(w.public_key, "mainnet");
    } catch {
      return NextResponse.json(
        { error: "Could not verify on-chain balance — try again later." },
        { status: 502 },
      );
    }
    if (bal.usdcRaw > 0n || bal.solLamports >= DUST_LAMPORTS) {
      return NextResponse.json(
        {
          error:
            "Wallet still holds funds — withdraw first (USDC must be 0 and SOL below 0.001).",
        },
        { status: 409 },
      );
    }
  }

  const { error } = await db.from("wallets").delete().eq("id", walletId);
  if (error) {
    console.error("[admin-userwallet] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete wallet" }, { status: 500 });
  }
  // balances_cache PK → tanpa FK cascade; wajib manual.
  await db.from("balances_cache").delete().eq("wallet_id", walletId);

  await audit({
    actor: admin.id,
    action: "admin_wallet_deleted",
    target: w.public_key,
    payload: { userId, walletId, kind: w.kind },
    ip: clientIp(req),
  });

  return NextResponse.json({ ok: true });
}
