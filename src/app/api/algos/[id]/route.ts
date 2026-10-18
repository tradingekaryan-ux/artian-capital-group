import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser, requireUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { uiToRaw } from "@/lib/payment/pricing";
import { USDC_DECIMALS } from "@/lib/config";
import { getAlgoCommissionRaw, getLatestSub, isSubActive, ALGO_FEED_PAGE, type AlgoRow } from "@/lib/algos";

/**
 * GET /api/algos/[id] — detail algo + feed message (paginated) + status
 * langganan saya (bila login). Feed publik: tanpa login pun bisa baca.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("*").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = algo as AlgoRow;

  const user = await requireUser();
  const isOwner = !!user && user.id === row.user_id;
  if (!row.is_active && !isOwner) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(_req.url);
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? Number(afterRaw) : 0;
  let msgQuery = db
    .from("algo_messages")
    .select("id, text, payload, created_at")
    .eq("algo_id", id)
    .order("id", { ascending: false })
    .limit(ALGO_FEED_PAGE);
  if (Number.isFinite(after) && after > 0) {
    msgQuery = db
      .from("algo_messages")
      .select("id, text, payload, created_at")
      .eq("algo_id", id)
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(ALGO_FEED_PAGE);
  }
  const { data: msgs } = await msgQuery;
  const messages = ((msgs ?? []) as { id: number; text: string; payload: unknown; created_at: string }[]).slice().reverse();

  const [{ data: creator }, { count: subCount }, { count: messageCount }] = await Promise.all([
    db.from("profiles").select("username, display_name").eq("user_id", row.user_id).maybeSingle(),
    db
      .from("algo_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("algo_id", id)
      .eq("status", "active"),
    db.from("algo_messages").select("id", { count: "exact", head: true }).eq("algo_id", id),
  ]);

  let mySub = null;
  let mySlotCount = 0;
  if (user) {
    mySub = await getLatestSub(id, user.id);
    const { count } = await db
      .from("algo_slots")
      .select("id", { count: "exact", head: true })
      .eq("algo_id", id)
      .eq("user_id", user.id)
      .eq("active", true);
    mySlotCount = count ?? 0;
  }

  return NextResponse.json({
    algo: row,
    creator: {
      username: creator?.username ?? null,
      display_name: creator?.display_name ?? null,
    },
    messages,
    mySub: mySub
      ? {
          id: mySub.id,
          status: mySub.status,
          billing: mySub.billing,
          expires_at: mySub.expires_at,
          active: isSubActive(mySub),
        }
      : null,
    mySlotCount,
    subCount: subCount ?? 0,
    messageCount: messageCount ?? 0,
    viewerIsOwner: isOwner,
  });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(2000).optional(),
  priceUsdc: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, "price must be a non-negative USDC amount")
    .optional(),
  billing: z.enum(["lifetime", "monthly"]).optional(),
  isActive: z.boolean().optional(),
});

/** PATCH /api/algos/[id] — ubah algo (hanya owner). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }
  const { id } = await params;

  const ip = clientIp(req);
  if (!(await rateLimit(`algo-update:${auth.user.id}`, 60, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const db = supabaseAdmin();
  const { data: algo } = await db.from("algos").select("*").eq("id", id).maybeSingle();
  if (!algo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((algo as AlgoRow).user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
  if (parsed.data.priceUsdc !== undefined) {
    let priceRaw: bigint;
    let commissionRaw: bigint;
    try {
      priceRaw = uiToRaw(parsed.data.priceUsdc, USDC_DECIMALS);
      commissionRaw = await getAlgoCommissionRaw();
    } catch {
      return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    }
    if (priceRaw > 0n && priceRaw <= commissionRaw) {
      return NextResponse.json(
        { error: "Price must be greater than the platform commission." },
        { status: 400 },
      );
    }
    patch.price_usdc = parsed.data.priceUsdc;
    // harga baru = 0 → billing lifetime (free tidak berlangganan bulanan)
    if (priceRaw === 0n) patch.billing = "lifetime";
    else if (parsed.data.billing) patch.billing = parsed.data.billing;
  } else if (parsed.data.billing !== undefined) {
    if (parsed.data.billing === "monthly" && Number((algo as AlgoRow).price_usdc) === 0) {
      return NextResponse.json({ error: "Free algos cannot be monthly." }, { status: 400 });
    }
    patch.billing = parsed.data.billing;
  }

  const { data: updated, error } = await db.from("algos").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: "Failed to update" }, { status: 500 });

  await audit({
    actor: auth.user.id,
    action: "algo_updated",
    target: id,
    payload: patch,
    ip,
  });
  return NextResponse.json({ algo: updated as AlgoRow });
}
