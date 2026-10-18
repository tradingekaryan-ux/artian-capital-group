import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { pricingValueSchema } from "@/lib/payment/pricing";

const bodySchema = z.object({
  key: z.enum([
    "create_token",
    "create_pool",
    "add_liquidity",
    "remove_liquidity",
    "swap",
    "withdraw",
  ]),
  value: pricingValueSchema,
});

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // H-5: rate limit pricing changes — maks 10x/menit per admin
  if (!(await rateLimit(`admin-pricing:${admin.id}`, 10, 60_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Validation failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("pricing_config")
    .upsert(
      { key: parsed.data.key, value: parsed.data.value, updated_by: admin.id, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return NextResponse.json({ error: "Failed to save" }, { status: 500 });

  await audit({
    actor: admin.id,
    action: "pricing_updated",
    target: parsed.data.key,
    payload: parsed.data.value,
  });
  return NextResponse.json({ ok: true });
}
