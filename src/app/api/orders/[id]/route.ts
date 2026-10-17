import { NextResponse } from "next/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/orders/[id]">,
) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { data } = await supabaseAdmin()
    .from("orders")
    .select(
      "id, service, status, amount_raw, tx_signature, payment_signature, error, config, created_at, updated_at, tokens(mint, name, symbol, status)",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = Array.isArray(data.tokens) ? data.tokens[0] : data.tokens;
  // Hanya back-reference pool (config bisa berisi logoBase64 ratusan KB — jangan dikirim).
  const poolOrderId = (data.config as { poolOrderId?: string } | null)?.poolOrderId ?? null;
  return NextResponse.json({ order: { ...data, config: undefined, token, poolOrderId } });
}
