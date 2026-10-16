"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className ?? "btn btn-secondary !py-1 !px-2 text-xs"}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? t("copied") : t("copy")}
    </button>
  );
}
