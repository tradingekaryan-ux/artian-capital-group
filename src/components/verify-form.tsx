"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { supabaseBrowser } from "@/lib/db/client";

export function VerifyForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const email = user.email ?? "";
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: "email",
      });
      if (verifyError) throw new Error(verifyError.message);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{t("verifyTitle")}</h1>
        <p className="mt-2 text-sm text-muted">
          Cek kotak masuk email — kode 6 digit sudah dikirim.
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="otp">
              {t("otp")}
            </label>
            <input
              id="otp"
              className="input mono text-center text-lg tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy || otp.length !== 6}>
            {busy ? "…" : t("verifyCta")}
          </button>
        </form>
      </div>
    </div>
  );
}
