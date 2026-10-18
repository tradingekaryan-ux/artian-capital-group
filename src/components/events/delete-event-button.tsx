"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function DeleteEventButton({ id }: { id: string }) {
  const t = useTranslations("events");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(t("deleteConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={() => void remove()} disabled={busy} className="btn btn-danger !px-3 !py-1 !text-[11px]">
      {t("delete")}
    </button>
  );
}
