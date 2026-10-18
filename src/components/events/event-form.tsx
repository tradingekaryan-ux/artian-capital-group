"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function EventForm() {
  const t = useTranslations("events");
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, caption }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setUrl("");
      setCaption("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card flex flex-col gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-xl font-bold">{t("formTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="label">{t("url")}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("urlPlaceholder")}
            className="input"
            type="url"
            required
            maxLength={2000}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">{t("caption")}</label>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("captionPlaceholder")}
            className="input"
            maxLength={500}
          />
        </div>
      </div>
      <div>
        <button type="submit" disabled={busy || !url.trim()} className="btn btn-primary">
          {busy ? t("posting") : t("post")}
        </button>
        {error ? <span className="ml-3 text-sm font-semibold text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
