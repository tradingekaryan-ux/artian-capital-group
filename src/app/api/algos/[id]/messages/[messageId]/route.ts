import { NextResponse } from "next/server";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";

/**
 * DELETE /api/algos/[id]/messages/[messageId] — hapus message dari feed
 * (hanya creator algo atau admin).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, messageId } = await params;
  const msgId = Number(messageId);
  if (!Number.isFinite(msgId)) return NextResponse.json({ error: "Invalid message id" }, { status: 400 });

  if (!(await rateLimit(`algo-msg-del:${auth.user.id}`, 120, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("user_id").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  if ((algo as { user_id: string }).user_id !== auth.user.id && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: msg } = await db
    .from("algo_messages")
    .select("id")
    .eq("id", msgId)
    .eq("algo_id", id)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await db.from("algo_messages").delete().eq("id", msgId);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });

  await audit({
    actor: auth.user.id,
    action: "algo_message_deleted",
    target: id,
    payload: { messageId: msgId, byAdmin: isAdmin },
  });
  return NextResponse.json({ ok: true });
}
