import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/db/client";
import { archiveWallet, renameWallet } from "@/lib/solana/wallet";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";

const renameSchema = z.object({ label: z.string().max(40) });

/**
 * PATCH /api/wallet/[id] — ganti nama (label) wallet milik sendiri.
 * - Body `{label}` (wajib non-kosong setelah trim — kosong/spasi → 400).
 * - Boleh untuk wallet aktif maupun non-aktif/terarsip (nama hanya tampilan).
 * - Rate limit: 30 x ganti nama / jam.
 */

/**
 * DELETE /api/wallet/[id]
 * Arsipkan (soft-delete) wallet milik user sendiri.
 * - Wallet AKTIF tidak bisa diarsipkan (switch dulu) — dicek di archiveWallet().
 * - Wallet terarsip hilang dari daftar & tidak bisa jadi aktif; tetap terlihat
 *   di dashboard admin dengan label Archived.
 * - Cookie `wid` TIDAK disentuh di sini: wallet yang diarsip selalu non-aktif
 *   (ditolak di atas), jadi pilihan wallet aktif user tidak berubah.
 * - Rate limit: 10 x arsip / jam.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }

  const { id: walletId } = await params;
  if (!walletId) return NextResponse.json({ error: "Missing wallet id" }, { status: 400 });

  const ip = clientIp(req);
  if (!(await rateLimit(`wallet-archive:${auth.user.id}`, 10, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const archived = await archiveWallet(auth.user.id, walletId);

    await audit({
      actor: auth.user.id,
      action: "wallet_archived",
      target: archived.id,
      payload: { publicKey: archived.public_key, kind: archived.kind },
      ip,
    });

    return NextResponse.json({ ok: true, archivedId: archived.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Wallet not found") {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }
    if (msg === "Already archived") {
      return NextResponse.json({ error: "Wallet already archived" }, { status: 409 });
    }
    if (msg.startsWith("Cannot archive the active wallet")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[wallet archive] failed:", e);
    return NextResponse.json({ error: "Failed to archive wallet" }, { status: 500 });
  }
}

/**
 * PATCH /api/wallet/[id] — ganti nama (label) wallet milik sendiri.
 * Boleh wallet aktif/non-aktif; label kosong → 400; bukan milik user → 404.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }

  const { id: walletId } = await params;
  if (!walletId) return NextResponse.json({ error: "Missing wallet id" }, { status: 400 });

  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Label is required (max 40 characters)." }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!(await rateLimit(`wallet-rename:${auth.user.id}`, 30, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const wallet = await renameWallet(auth.user.id, walletId, parsed.data.label);

    await audit({
      actor: auth.user.id,
      action: "wallet_renamed",
      target: wallet.id,
      payload: { label: wallet.label, publicKey: wallet.public_key, kind: wallet.kind },
      ip,
    });

    return NextResponse.json({ ok: true, id: wallet.id, label: wallet.label });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Wallet not found") {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }
    if (msg === "Label required") {
      return NextResponse.json({ error: "Label is required." }, { status: 400 });
    }
    console.error("[wallet rename] failed:", e);
    return NextResponse.json({ error: "Failed to rename wallet" }, { status: 500 });
  }
}

