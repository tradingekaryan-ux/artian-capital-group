import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { assertSafeDestUrl } from "@/lib/algos";
import { fetchEventMeta, type EventMeta } from "@/lib/events";

const createSchema = z.object({
  url: z.string().trim().min(10).max(2000),
  caption: z.string().trim().max(500).default(""),
});

export interface EventRow {
  id: string;
  url: string;
  caption: string;
  meta: EventMeta;
  created_by: string;
  created_at: string;
}

/** GET /api/events — daftar event (publik, terbaru dulu). */
export async function GET() {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("id, url, caption, meta, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  return NextResponse.json({ items: (data ?? []) as EventRow[] });
}

/**
 * POST /api/events — admin memposting URL (post X / URL apa pun) + caption.
 * Meta card (og / oEmbed X) diambil server-side saat posting.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ip = clientIp(req);
  if (!(await rateLimit(`event-create:${admin.id}`, 30, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, { status: 400 });
  }

  let url: string;
  try {
    url = assertSafeDestUrl(parsed.data.url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
  }

  const meta = await fetchEventMeta(url);

  const { data: row, error } = await supabaseAdmin()
    .from("events")
    .insert({ url, caption: parsed.data.caption, meta, created_by: admin.id })
    .select("id, url, caption, meta, created_by, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Failed to save event" }, { status: 500 });

  await audit({
    actor: admin.id,
    action: "event_created",
    target: row.id as string,
    payload: { url, caption: parsed.data.caption, provider: meta.provider ?? null },
    ip,
  });
  return NextResponse.json({ item: row as EventRow }, { status: 201 });
}
