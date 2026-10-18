import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { ALGO_MAX_HOOKS, type AlgoRow } from "@/lib/algos";

/** GET /api/algos/[id]/hooks — daftar token input (hanya owner). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("user_id").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((algo as { user_id: string }).user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data: hooks } = await db
    .from("algo_hooks")
    .select("id, token, label, active, last_used_at, created_at")
    .eq("algo_id", id)
    .order("created_at", { ascending: false });
  return NextResponse.json({
    hooks: (hooks ?? []).map((h) => ({
      ...h,
      url: `/api/algos/${id}/hook/${h.token}`,
    })),
  });
}

/** POST /api/algos/[id]/hooks — buat token input baru (maks 5). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }
  const { id } = await params;

  if (!(await rateLimit(`algo-hooks:${auth.user.id}`, 30, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("*").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((algo as AlgoRow).user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let label: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.label === "string" && body.label.trim()) label = body.label.trim().slice(0, 40);
  } catch {
    /* body opsional */
  }

  const { count } = await db
    .from("algo_hooks")
    .select("id", { count: "exact", head: true })
    .eq("algo_id", id);
  if ((count ?? 0) >= ALGO_MAX_HOOKS) {
    return NextResponse.json({ error: "Hook limit reached." }, { status: 400 });
  }

  const token = randomBytes(24).toString("hex");
  const { data: hook, error } = await db
    .from("algo_hooks")
    .insert({ algo_id: id, token, label })
    .select("id, token, label, active, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Failed to create hook" }, { status: 500 });

  await audit({
    actor: auth.user.id,
    action: "algo_hook_created",
    target: id,
    payload: { hookId: hook.id },
  });
  return NextResponse.json(
    { hook: { ...hook, url: `/api/algos/${id}/hook/${token}` } },
    { status: 201 },
  );
}
