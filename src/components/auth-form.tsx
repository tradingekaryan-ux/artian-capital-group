"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { supabaseBrowser } from "@/lib/db/client";
import { track } from "@/lib/analytics";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    try {
      if (mode === "register") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } },
        });
        if (signUpError) throw new Error(signUpError.message);
        track("register");
        router.push("/verify");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw new Error(signInError.message);
        track("login");
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card overflow-hidden">
        <div className="chrome">
          <span className="chrome-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="text-muted-ink">{mode === "login" ? "login" : "register"}</span>
        </div>
        <div className="p-6 sm:p-8">
          <h1 className="text-3xl">
            {mode === "login" ? t("loginTitle") : t("registerTitle")}
          </h1>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {mode === "register" && (
            <div>
              <label className="label" htmlFor="username">
                {t("username")}
              </label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24))
                }
                required
                minLength={3}
                maxLength={24}
                pattern="[a-z0-9_]{3,24}"
                autoComplete="username"
              />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          {error && <p className="text-sm font-bold text-[#b91c1c]">{error}</p>}
          <button className="btn btn-primary w-full !py-3" disabled={busy}>
            {busy ? "…" : mode === "login" ? t("loginCta") : t("registerCta")}
          </button>
        </form>
        <p className="mt-4 text-sm text-muted-ink">
          {mode === "login" ? (
            <>
              {t("noAccount")}{" "}
              <Link href="/register" className="font-bold underline decoration-2 underline-offset-2">
                {t("register")}
              </Link>
            </>
          ) : (
            <>
              {t("haveAccount")}{" "}
              <Link href="/login" className="font-bold underline decoration-2 underline-offset-2">
                {t("login")}
              </Link>
            </>
          )}
        </p>
        {mode === "register" && (
          <p className="mt-4 rounded-xl border-2 border-black bg-[#ede9fe] p-3 text-xs font-medium text-muted-ink">
            {t("walletNotice")}
          </p>
        )}
        </div>
      </div>
    </div>
  );
}
