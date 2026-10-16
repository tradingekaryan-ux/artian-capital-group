import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({
  key: z.enum([
    "create_token",
    "create_pool",
    "add_liquidity",
    "remove_liquidity",
    "swap",
    "withdraw",
  ]),
  value: z.record(z.string(), z.unknown()),
});

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Validasi gagal" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("pricing_config")
    .upsert(
      { key: parsed.data.key, value: parsed.data.value, updated_by: admin.id, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return NextResponse.json({ error: "Gagal menyimpan" }, { status: 500 });

  await audit({
    actor: admin.id,
    action: "pricing_updated",
    target: parsed.data.key,
    payload: parsed.data.value,
  });
  return NextResponse.json({ ok: true });
}
