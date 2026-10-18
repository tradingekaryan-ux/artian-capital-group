import { NextResponse } from "next/server";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";

/** DELETE /api/algos/[id]/slots/[slotId] — lepas slot output (pemilik slot). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; slotId: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, slotId } = await params;

  const db = supabaseAdmin();
  const { data: slot } = await db
    .from("algo_slots")
    .select("id")
    .eq("id", slotId)
    .eq("algo_id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!slot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await db.from("algo_slots").delete().eq("id", slotId);
  if (error) return NextResponse.json({ error: "Failed to remove slot" }, { status: 500 });

  await audit({ actor: auth.user.id, action: "algo_slot_removed", target: id, payload: { slotId } });
  return NextResponse.json({ ok: true });
}
