import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/db/client";
import { archiveWallet, ACTIVE_WALLET_COOKIE } from "@/lib/solana/wallet";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";

/**
 * DELETE /api/wallet/[id]
 * Arsipkan (soft-delete) wallet milik user sendiri.
 * - Wallet yang diarsipkan hilang dari daftar & tidak bisa jadi aktif.
 * - Cookie `wid` dibersihkan agar browser tidak mengacu wallet lama.
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

    // Hapus cookie wid agar tidak mengacu wallet yang sudah diarsipkan
    const res = NextResponse.json({ ok: true, archivedId: archived.id });
    res.cookies.set(ACTIVE_WALLET_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Wallet not found") {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }
    if (msg === "Already archived") {
      return NextResponse.json({ error: "Wallet already archived" }, { status: 409 });
    }
    console.error("[wallet archive] failed:", e);
    return NextResponse.json({ error: "Failed to archive wallet" }, { status: 500 });
  }
}

