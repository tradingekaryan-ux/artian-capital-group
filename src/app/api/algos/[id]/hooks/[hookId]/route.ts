import { NextResponse } from "next/server";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";

/** DELETE /api/algos/[id]/hooks/[hookId] — cabut token input (hanya owner). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; hookId: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, hookId } = await params;

  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("user_id").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((algo as { user_id: string }).user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: hook } = await db
    .from("algo_hooks")
    .select("id")
    .eq("id", hookId)
    .eq("algo_id", id)
    .maybeSingle();
  if (!hook) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await db.from("algo_hooks").delete().eq("id", hookId);
  if (error) return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });

  await audit({
    actor: auth.user.id,
    action: "algo_hook_revoked",
    target: id,
    payload: { hookId },
  });
  return NextResponse.json({ ok: true });
}
