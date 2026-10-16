import { randomOtp, sha256Hex } from "@/lib/security/crypto";
import { SECRETS } from "@/lib/config";
import { supabaseAdmin } from "@/lib/db/client";

const TTL_MINUTES = 10;

/**
 * Buat & kirim OTP 6 digit untuk withdrawal (disimpan di row withdrawals).
 * Tanpa RESEND_API_KEY, kode hanya muncul di log server (mode dev).
 */
export async function createWithdrawOtp(
  withdrawalId: string,
  userId: string,
  email: string,
): Promise<{ devCode?: string }> {
  const code = randomOtp();
  const hash = sha256Hex(code + userId);
  const expires = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  const { error } = await supabaseAdmin()
    .from("withdrawals")
    .update({ otp_hash: hash, otp_expires_at: expires })
    .eq("id", withdrawalId)
    .eq("user_id", userId);
  if (error) throw error;

  if (SECRETS.resendApiKey) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRETS.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Artian <onboarding@resend.dev>",
        to: [email],
        subject: "Kode konfirmasi withdrawal — Artian",
        text: `Kode konfirmasi withdrawal Anda: ${code} (berlaku ${TTL_MINUTES} menit).`,
      }),
    });
  } else if (process.env.NODE_ENV !== "production") {
    console.warn(`[dev] OTP withdrawal untuk ${email}: ${code}`);
  }
  return { devCode: process.env.NODE_ENV !== "production" ? code : undefined };
}

export async function verifyWithdrawOtp(
  withdrawalId: string,
  userId: string,
  code: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("withdrawals")
    .select("id, user_id, otp_hash, otp_expires_at, status")
    .eq("id", withdrawalId)
    .single();
  if (!data || data.user_id !== userId || data.status !== "pending") return false;
  if (!data.otp_hash || !data.otp_expires_at) return false;
  if (new Date(data.otp_expires_at).getTime() < Date.now()) return false;
  return data.otp_hash === sha256Hex(code + userId);
}
