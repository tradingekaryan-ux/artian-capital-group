import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { assertSafeDestUrl } from "@/lib/algos";
import { getWebhookConfig, getDiscordInviteUrl, WEBHOOK_KEYS, WEBHOOK_SLOTS, DISCORD_KEY } from "@/lib/webhooks";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";

/** Slot alert (5) + `discord` (invite link tombol situs — bukan alert POST). */
const ADMIN_URL_SLOTS = [...WEBHOOK_SLOTS, "discord"] as const;

const patchSchema = z.object({
  slot: z.enum(ADMIN_URL_SLOTS),
  url: z.string().max(500, "URL too long"),
});

/** GET /api/admin/webhooks — URL tiap slot ("" = belum diset) + invite Discord. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await rateLimit(`admin-webhooks-read:${admin.id}`, 120, 60_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  try {
    const [cfg, discord] = await Promise.all([getWebhookConfig(), getDiscordInviteUrl()]);
    return NextResponse.json({ ...cfg, discord });
  } catch (e) {
    console.error("[webhooks] GET failed:", e);
    return NextResponse.json({ error: "Failed to load webhooks" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/webhooks — set / clear URL satu slot.
 * body: { slot: "events"|"tx"|"wallet"|"algo"|"user", url: string }
 * url "" = bersihkan (alert slot itu nonaktif). Validasi SSRF memakai
 * assertSafeDestUrl (http/https saja, tolak localhost/IP privat).
 */
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await rateLimit(`admin-webhooks:${admin.id}`, 10, 60_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Validation failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const slot = parsed.data.slot;
  const raw = parsed.data.url.trim();
  const key = slot === "discord" ? DISCORD_KEY : WEBHOOK_KEYS[slot];

  if (!raw) {
    const { error } = await supabaseAdmin().from("pricing_config").delete().eq("key", key);
    if (error) return NextResponse.json({ error: "Failed to clear webhook" }, { status: 500 });
    await audit({
      actor: admin.id,
      action: "webhook_cleared",
      target: slot,
      payload: {},
      ip: clientIp(req),
    });
    return NextResponse.json({ ok: true, slot, url: "" });
  }

  let safeUrl: string;
  try {
    safeUrl = assertSafeDestUrl(raw);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("pricing_config")
    .upsert(
      { key, value: { url: safeUrl }, updated_by: admin.id, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return NextResponse.json({ error: "Failed to save webhook" }, { status: 500 });

  await audit({
    actor: admin.id,
    action: "webhook_configured",
    target: slot,
    payload: { url: safeUrl },
    ip: clientIp(req),
  });
  return NextResponse.json({ ok: true, slot, url: safeUrl });
}
