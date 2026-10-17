import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { verifyWithdrawOtp } from "@/lib/security/otp";
import { enqueue } from "@/lib/jobs/queue";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";

const bodySchema = z.object({
  id: z.union([z.string(), z.number()]),
  otp: z.string().length(6),
});

export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended. Contact admin." }, { status: 403 });
  }
  const user = auth.user;

  const ip = clientIp(req);
  if (!(await rateLimit(`withdraw-verify:${user.id}`, 10, 3_600_000))) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 400 });
  }

  const id = String(parsed.data.id);
  const ok = await verifyWithdrawOtp(id, user.id, parsed.data.otp);
  if (!ok) {
    return NextResponse.json({ error: "Wrong or expired code" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: updated } = await db
    .from("withdrawals")
    .update({ status: "processing", otp_hash: null, otp_expires_at: null })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id, wallet_id")
    .maybeSingle();
  if (!updated) {
    return NextResponse.json({ error: "Withdrawal is not in pending status" }, { status: 409 });
  }

  await enqueue("withdraw", {
    withdrawalId: id,
    userId: user.id,
    walletId: updated.wallet_id ?? null,
  });
  await audit({
    actor: user.id,
    action: "withdraw_confirmed",
    target: id,
    payload: {},
    ip,
  });

  return NextResponse.json({ ok: true, status: "processing" });
}
