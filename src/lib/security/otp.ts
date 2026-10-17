import { randomOtp, sha256Hex, timingSafeEqualStr } from "@/lib/security/crypto";
import { SECRETS } from "@/lib/config";
import { supabaseAdmin } from "@/lib/db/client";

const TTL_MINUTES = 10;

/**
 * Buat & kirim OTP 6 digit untuk withdrawal (disimpan di row withdrawals).
 * Tanpa RESEND_API_KEY: kode dikembalikan sebagai devCode (mode devnet MVP).
 * Kegagalan kirim email TIDAK menggagalkan pembuatan OTP (dicatat saja).
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
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRETS.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Artian <onboarding@resend.dev>",
          to: [email],
          subject: "Withdrawal confirmation code — Artian",
          text: `Your Artian withdrawal code: ${code} (valid for ${TTL_MINUTES} minutes).`,
        }),
      });
    } catch (e) {
      console.error("[otp] send email failed:", e);
    }
  }
  // Devnet MVP: tanpa Resend, kode dibagikan langsung ke UI agar alur tetap jalan.
  const devCode = SECRETS.resendApiKey ? undefined : code;
  return { devCode };
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
  return timingSafeEqualStr(data.otp_hash, sha256Hex(code + userId));
}
