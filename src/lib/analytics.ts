/**
 * Analytics minimal tanpa SDK (opsional). Aktif bila NEXT_PUBLIC_POSTHOG_KEY di-set.
 * Event dikirim fire-and-forget ke PostHog capture API.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

type Props = Record<string, string | number | boolean | null | undefined>;

export function track(event: string, props?: Props): void {
  if (!KEY || typeof window === "undefined") return;
  try {
    const distinctId =
      window.localStorage.getItem("ph_vid") ??
      (window.crypto?.randomUUID?.() ?? String(Math.random()));
    window.localStorage.setItem("ph_vid", distinctId);
    void fetch(`${HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: distinctId,
        properties: props,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics tidak boleh mengganggu UX */
  }
}
