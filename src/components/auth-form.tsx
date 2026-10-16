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
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">
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
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={32}
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
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? t("loginCta") : t("registerCta")}
          </button>
        </form>
        <p className="mt-4 text-sm text-muted">
          {mode === "login" ? (
            <>
              {t("noAccount")}{" "}
              <Link href="/register" className="text-accent hover:underline">
                {t("register")}
              </Link>
            </>
          ) : (
            <>
              {t("haveAccount")}{" "}
              <Link href="/login" className="text-accent hover:underline">
                {t("login")}
              </Link>
            </>
          )}
        </p>
        {mode === "register" && (
          <p className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
            {t("walletNotice")}
          </p>
        )}
      </div>
    </div>
  );
}
