import { NextResponse } from "next/server";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { assertSafeDestUrl, getLatestSub, isSubActive, ALGO_MAX_SLOTS } from "@/lib/algos";

/** GET /api/algos/[id]/slots — slot output milik saya untuk algo ini. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data: slots } = await supabaseAdmin()
    .from("algo_slots")
    .select("id, dest_url, active, last_status, last_delivered_at, created_at")
    .eq("algo_id", id)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });
  return NextResponse.json({ slots: slots ?? [] });
}

/**
 * POST /api/algos/[id]/slots — pasang slot output (forward message ke URL
 * eksternal, mis. Discord webhook). Wajib langganan aktif (free = subscribe
 * gratis dulu). Maks 3 slot per subscriber per algo.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }
  const { id } = await params;

  if (!(await rateLimit(`algo-slot:${auth.user.id}`, 30, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("is_active").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(algo as { is_active: boolean }).is_active) {
    return NextResponse.json({ error: "Algo is inactive" }, { status: 409 });
  }

  const sub = await getLatestSub(id, auth.user.id);
  if (!isSubActive(sub)) {
    return NextResponse.json({ error: "Subscribe first to unlock output slots." }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = json as { destUrl?: unknown };
  const rawUrl = typeof body.destUrl === "string" ? body.destUrl.trim() : "";
  let destUrl: string;
  try {
    destUrl = assertSafeDestUrl(rawUrl);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid URL" }, { status: 400 });
  }

  const { count } = await db
    .from("algo_slots")
    .select("id", { count: "exact", head: true })
    .eq("algo_id", id)
    .eq("user_id", auth.user.id)
    .eq("active", true);
  if ((count ?? 0) >= ALGO_MAX_SLOTS) {
    return NextResponse.json({ error: "Slot limit reached." }, { status: 400 });
  }

  const { data: slot, error } = await db
    .from("algo_slots")
    .insert({ algo_id: id, user_id: auth.user.id, dest_url: destUrl })
    .select("id, dest_url, active, last_status, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Failed to create slot" }, { status: 500 });

  await audit({ actor: auth.user.id, action: "algo_slot_added", target: id, payload: { slotId: slot.id } });
  return NextResponse.json({ slot }, { status: 201 });
}
