import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/db/client";
import { getActiveWallet, listWallets, createMainnetWallet, createDemoWallet } from "@/lib/solana/wallet";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import { audit } from "@/lib/security/audit";

const bodySchema = z.object({
  action: z.enum(["create_mainnet", "create_demo"]),
  label: z.string().max(40).optional(),
});

/** GET: daftar wallet user + wallet aktif saat ini. */
export async function GET() {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [wallets, active] = await Promise.all([
      listWallets(auth.user.id),
      getActiveWallet(auth.user.id),
    ]);
    return NextResponse.json({
      wallets: wallets.map((w) => ({
        id: w.id,
        kind: w.kind,
        label: w.label,
        publicKey: w.public_key,
        createdAt: w.created_at,
      })),
      activeId: active.id,
    });
  } catch (e) {
    console.error("[wallet list] failed:", e);
    return NextResponse.json({ error: "Failed to load wallets" }, { status: 500 });
  }
}

/** POST: buat wallet baru (mainnet berlabel / demo sekali per user). */
export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended. Contact admin." }, { status: 403 });
  }
  const ip = clientIp(req);
  if (!(await rateLimit(`wallet-create:${auth.user.id}`, 10, 3_600_000))) {
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
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  try {
    const wallet =
      parsed.data.action === "create_demo"
        ? await createDemoWallet(auth.user.id)
        : await createMainnetWallet(auth.user.id, parsed.data.label);

    await audit({
      actor: auth.user.id,
      action: parsed.data.action === "create_demo" ? "demo_wallet_created" : "mainnet_wallet_created",
      target: wallet.id,
      payload: { publicKey: wallet.public_key },
      ip,
    });

    const res = NextResponse.json({
      wallet: {
        id: wallet.id,
        kind: wallet.kind,
        label: wallet.label,
        publicKey: wallet.public_key,
      },
    });
    res.cookies.set("wid", wallet.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (e) {
    console.error("[wallet create] failed:", e);
    return NextResponse.json({ error: "Failed to create wallet" }, { status: 500 });
  }
}
