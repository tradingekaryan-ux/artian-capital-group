import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";

/** DELETE /api/events/[id] — hapus event (hanya admin). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { data: row } = await supabaseAdmin()
    .from("events")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabaseAdmin().from("events").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });

  await audit({ actor: admin.id, action: "event_deleted", target: id });
  return NextResponse.json({ ok: true });
}
