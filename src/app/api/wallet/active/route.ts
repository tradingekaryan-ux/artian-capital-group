import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/db/client";
import { getWalletById, ACTIVE_WALLET_COOKIE } from "@/lib/solana/wallet";

const bodySchema = z.object({ walletId: z.string().uuid() });

/** POST: pindah wallet aktif (cookie `wid`) — wajib milik user sendiri. */
export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 });

  const wallet = await getWalletById(parsed.data.walletId);
  if (!wallet || wallet.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  const res = NextResponse.json({ activeId: wallet.id, kind: wallet.kind });
  res.cookies.set(ACTIVE_WALLET_COOKIE, wallet.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
