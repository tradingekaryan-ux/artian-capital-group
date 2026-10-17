"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { track } from "@/lib/analytics";

export function WatchlistButton({
  mint,
  initial,
}: {
  mint: string;
  initial: boolean;
}) {
  const t = useTranslations("token");
  const router = useRouter();
  const [watching, setWatching] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/community/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setWatching(json.watching);
      track(json.watching ? "watch_added" : "watch_removed", { mint });
    } catch {
      /* diamkan — tombol tetap seperti semula */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className={`btn ${watching ? "btn-primary" : "btn-secondary"}`} onClick={toggle} disabled={busy}>
      {watching ? `✓ ${t("unwatch")}` : `☆ ${t("watch")}`}
    </button>
  );
}
