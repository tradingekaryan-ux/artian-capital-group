import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { uiToRaw } from "@/lib/payment/pricing";
import { USDC_DECIMALS } from "@/lib/config";
import { getAlgoCommissionRaw, type AlgoRow } from "@/lib/algos";

const PAGE_SIZE = 20;

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(2000).default(""),
  priceUsdc: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, "price must be a non-negative USDC amount")
    .default("0"),
  billing: z.enum(["lifetime", "monthly"]).default("lifetime"),
});

interface AlgoListItem {
  algo: AlgoRow;
  creator: { username: string | null; display_name: string | null };
  lastMessage: { text: string; created_at: string } | null;
}

async function loadList(ids: string[]): Promise<Map<string, AlgoListItem["lastMessage"]>> {
  const out = new Map<string, AlgoListItem["lastMessage"]>();
  if (ids.length === 0) return out;
  const { data } = await supabaseAdmin()
    .from("algo_messages")
    .select("algo_id, text, created_at")
    .in("algo_id", ids)
    .order("created_at", { ascending: false })
    .limit(ids.length * 3);
  for (const m of data ?? []) {
    if (!out.has(m.algo_id)) out.set(m.algo_id, { text: m.text, created_at: m.created_at });
  }
  return out;
}

async function loadCreators(userIds: string[]): Promise<Map<string, { username: string | null; display_name: string | null }>> {
  const out = new Map<string, { username: string | null; display_name: string | null }>();
  if (userIds.length === 0) return out;
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("user_id, username, display_name")
    .in("user_id", userIds);
  for (const p of data ?? []) {
    out.set(p.user_id, { username: p.username, display_name: p.display_name });
  }
  return out;
}

/**
 * GET /api/algos?q=&page= — daftar algo aktif (publik).
 * GET /api/algos?mine=1 — daftar algo milik user (termasuk non-aktif).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const db = supabaseAdmin();
  let query = db.from("algos").select("*");
  if (mine) {
    const auth = await requireActiveUser();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (auth.suspended) {
      return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
    }
    query = query.eq("user_id", auth.user.id).order("created_at", { ascending: false });
  } else {
    query = query.eq("is_active", true).order("created_at", { ascending: false });
  }
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const from = (page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load algos" }, { status: 500 });

  const algos = (data ?? []) as AlgoRow[];
  const ids = algos.map((a) => a.id);
  const [lastMsgs, creators] = await Promise.all([
    loadList(ids),
    loadCreators([...new Set(algos.map((a) => a.user_id))]),
  ]);
  const items: AlgoListItem[] = algos.map((algo) => ({
    algo,
    creator: creators.get(algo.user_id) ?? { username: null, display_name: null },
    lastMessage: lastMsgs.get(algo.id) ?? null,
  }));
  return NextResponse.json({ items, page, pageSize: PAGE_SIZE });
}

/**
 * POST /api/algos — buat algo baru (+ 1 token input webhook gratis).
 * Harga USDC: 0 = free; >0 wajib lebih besar dari komisi platform.
 */
export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }

  const ip = clientIp(req);
  if (!(await rateLimit(`algo-create:${auth.user.id}`, 20, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, { status: 400 });
  }
  const { name, description, priceUsdc, billing } = parsed.data;

  let priceRaw: bigint;
  let commissionRaw: bigint;
  try {
    priceRaw = uiToRaw(priceUsdc, USDC_DECIMALS);
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
  const finalBilling = priceRaw === 0n ? "lifetime" : billing;
  const token = randomBytes(24).toString("hex");

  const db = supabaseAdmin();
  const { data: algo, error } = await db
    .from("algos")
    .insert({
      user_id: auth.user.id,
      name,
      description,
      price_usdc: priceUsdc,
      billing: finalBilling,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: "Failed to create algo" }, { status: 500 });

  const { data: hook, error: hookError } = await db
    .from("algo_hooks")
    .insert({ algo_id: algo.id, token, label: "default" })
    .select("id, token")
    .single();
  if (hookError) {
    await db.from("algos").delete().eq("id", algo.id);
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 500 });
  }

  await audit({
    actor: auth.user.id,
    action: "algo_created",
    target: algo.id as string,
    payload: { name, priceUsdc, billing: finalBilling },
    ip,
  });

  // Alert (slot `algo`) — algo baru dipublikasikan.
  const { notifyWebhook } = await import("@/lib/webhooks");
  await notifyWebhook(
    "algo",
    "algo_created",
    `New algo published: "${name}" — ${priceUsdc} USDC ${finalBilling}`,
    { algoId: algo.id, name, priceUsdc, billing: finalBilling, userId: auth.user.id },
  );
  return NextResponse.json(
    {
      algo: algo as AlgoRow,
      hook: {
        id: hook.id as string,
        token: hook.token as string,
        url: `/api/algos/${algo.id}/hook/${hook.token}`,
      },
    },
    { status: 201 },
  );
}
