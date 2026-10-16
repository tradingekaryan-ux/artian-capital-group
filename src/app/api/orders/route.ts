import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/db/client";
import { createAndPayOrder, OrderError } from "@/lib/payment/orders";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";
import { LIMITS } from "@/lib/config";

const createTokenSchema = z.object({
  service: z.literal("create_token"),
  config: z.object({
    name: z.string().min(2).max(50),
    symbol: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[A-Z0-9]+$/, "symbol huruf besar/angka saja"),
    decimals: z.number().int().min(0).max(9),
    supply: z.string().refine((v) => Number(v) > 0 && Number(v) <= 1e18, "supply tidak valid"),
    logoBase64: z
      .string()
      .refine((v) => v.startsWith("data:image/"), "logo harus berupa data URL gambar")
      .refine((v) => v.length <= 700_000, "logo terlalu besar (maks ~500KB)"),
    description: z.string().max(500).optional(),
    website: z.string().url().max(200).optional().or(z.literal("")),
    twitter: z.string().max(200).optional().or(z.literal("")),
    telegram: z.string().max(200).optional().or(z.literal("")),
    discord: z.string().max(200).optional().or(z.literal("")),
    revokeMint: z.boolean().default(true),
    revokeFreeze: z.boolean().default(true),
    immutable: z.boolean().default(false),
  }),
  idempotencyKey: z.string().max(100).optional(),
});

const createPoolSchema = z.object({
  service: z.literal("create_pool"),
  config: z.object({
    tokenId: z.string().uuid(),
    lpPercentage: z.number().min(1).max(100),
    tokenAmount: z.string().refine((v) => Number(v) > 0, "tokenAmount tidak valid"),
    quoteAmount: z.string().refine((v) => Number(v) > 0, "quoteAmount tidak valid"),
    quoteMint: z.string().optional(),
    feeBps: z.number().int().min(1).max(100).optional(),
  }),
  idempotencyKey: z.string().max(100).optional(),
});

const addLiquiditySchema = z.object({
  service: z.literal("add_liquidity"),
  config: z.object({
    poolId: z.string().uuid(),
    inputAmountRaw: z.string().refine((v) => /^\d+$/.test(v) && BigInt(v) > 0n, "jumlah tidak valid"),
    baseIn: z.boolean(),
  }),
  idempotencyKey: z.string().max(100).optional(),
});

const removeLiquiditySchema = z.object({
  service: z.literal("remove_liquidity"),
  config: z.object({
    poolId: z.string().uuid(),
    lpAmountRaw: z.string().refine((v) => /^\d+$/.test(v) && BigInt(v) > 0n, "jumlah tidak valid"),
  }),
  idempotencyKey: z.string().max(100).optional(),
});

const bodySchema = z.discriminatedUnion("service", [
  createTokenSchema,
  createPoolSchema,
  addLiquiditySchema,
  removeLiquiditySchema,
]);

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = clientIp(req);
  if (!rateLimit(`order:${user.id}`, LIMITS.orderPerHour, 3_600_000)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba nanti." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  // Otorisasi resource: pastikan asset milik user ini.
  const authError = await authorizeConfig(user.id, parsed.data);
  if (authError) return NextResponse.json({ error: authError }, { status: 403 });

  try {
    const { order, reused } = await createAndPayOrder({
      userId: user.id,
      service: parsed.data.service,
      config: parsed.data.config as Record<string, unknown>,
      idempotencyKey: parsed.data.idempotencyKey,
      ip,
    });
    return NextResponse.json({ order, reused });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 402 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message }, { status: 400 });
    }
    console.error("[orders] gagal:", e);
    await audit({
      actor: user.id,
      action: "order_error",
      payload: { service: parsed.data.service, message: String(e) },
      ip,
    });
    return NextResponse.json({ error: "Gagal membuat pesanan" }, { status: 500 });
  }
}

async function authorizeConfig(
  userId: string,
  data: z.infer<typeof bodySchema>,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/db/client");
  const db = supabaseAdmin();
  if (data.service === "create_pool") {
    const { data: token } = await db
      .from("tokens")
      .select("id, user_id")
      .eq("id", data.config.tokenId)
      .maybeSingle();
    if (!token) return "Token tidak ditemukan";
    if (token.user_id !== userId) return "Bukan token milikmu";
  }
  if (data.service === "add_liquidity" || data.service === "remove_liquidity") {
    const { data: pool } = await db
      .from("pools")
      .select("id, user_id, pool_id")
      .eq("id", data.config.poolId)
      .maybeSingle();
    if (!pool?.pool_id) return "Pool tidak ditemukan";
    if (pool.user_id !== userId) return "Bukan pool milikmu";
  }
  return null;
}
