import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import { rateLimit } from "@/lib/security/ratelimit";

const bodySchema = z.object({ mint: z.string().min(32).max(64) });

/** Toggle watchlist. Response: { watching: boolean } */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await rateLimit(`watch:${user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: "Too fast." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 400 });

  const db = supabaseAdmin();

  // M-5: validasi token terdaftar di DB — mencegah watchlist dengan mint arbitrary
  const { data: tokenExists } = await db
    .from("tokens")
    .select("mint")
    .eq("mint", parsed.data.mint)
    .maybeSingle();
  if (!tokenExists) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  const { data: existing } = await db
    .from("watchlists")
    .select("mint")
    .eq("user_id", user.id)
    .eq("mint", parsed.data.mint)
    .maybeSingle();

  if (existing) {
    await db
      .from("watchlists")
      .delete()
      .eq("user_id", user.id)
      .eq("mint", parsed.data.mint);
    return NextResponse.json({ watching: false });
  }

  const { error } = await db
    .from("watchlists")
    .insert({ user_id: user.id, mint: parsed.data.mint });
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
  return NextResponse.json({ watching: true });
}
