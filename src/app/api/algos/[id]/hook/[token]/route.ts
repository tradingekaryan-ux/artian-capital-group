import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/client";
import { rateLimit } from "@/lib/security/ratelimit";
import { enqueue } from "@/lib/jobs/queue";
import { deliverToSlots, extractText, getAlgo, ALGO_MSG_MAX_BYTES } from "@/lib/algos";

/**
 * POST /api/algos/[id]/hook/[token] — INGEST PUBLIK (tanpa login).
 * TradingView (atau sumber apa pun) mengirim JSON signal; message masuk
 * feed publik algo, lalu di-forward (best-effort inline) ke slot subscriber
 * yang langganannya aktif. Gagal → job `algo_forward` (retry).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;

  const raw = await req.text();
  if (raw.length > ALGO_MSG_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: hook } = await db
    .from("algo_hooks")
    .select("id, algo_id, active")
    .eq("token", token)
    .eq("algo_id", id)
    .maybeSingle();
  if (!hook || !hook.active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // rate limit per token (fail-open: ingest spam hanya membebani diri sender)
  if (!(await rateLimit(`algo-hook:${token}`, 120, 60_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const algo = await getAlgo(id);
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!algo.is_active) {
    return NextResponse.json({ error: "Algo is inactive" }, { status: 409 });
  }

  const text = extractText(payload);
  const { data: msg, error } = await db
    .from("algo_messages")
    .insert({ algo_id: id, hook_id: hook.id, payload, text })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "Failed to store message" }, { status: 500 });

  void db.from("algo_hooks").update({ last_used_at: new Date().toISOString() }).eq("id", hook.id);

  let sent = 0;
  let failed: string[] = [];
  try {
    const result = await deliverToSlots({ id: algo.id, name: algo.name }, msg.id as number, text, payload);
    sent = result.sent;
    failed = result.failed;
  } catch {
    failed = []; // tidak ada slot / error total → biarkan
  }
  if (failed.length > 0) {
    try {
      await enqueue("algo_forward", { messageId: msg.id, slotIds: failed });
    } catch {
      /* enqueue gagal: slot.last_status tetap mencatat error */
    }
  }

  return NextResponse.json(
    { ok: true, id: msg.id as number, forwarded: sent, pending: failed.length },
    { status: 202 },
  );
}
