import { NextResponse } from "next/server";
import { getDiscordInviteUrl } from "@/lib/webhooks";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";

/**
 * GET /api/discord — URL invite Discord yang diset admin (publik).
 * Dipakai tombol popup Discord (kanan bawah) — client-side fetch agar
 * perubahan admin langsung terlihat (layout halaman bisa SSG).
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`discord-cfg:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const url = await getDiscordInviteUrl();
  return NextResponse.json({ url }, { headers: { "Cache-Control": "public, max-age=60" } });
}
