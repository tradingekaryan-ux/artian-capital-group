import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser, supabaseAdmin } from "@/lib/db/client";
import type { EventRow } from "@/app/api/events/route";
import { EventForm } from "@/components/events/event-form";
import { DeleteEventButton } from "@/components/events/delete-event-button";

export default async function EventsPage({ params }: PageProps<"/[locale]/events">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("events");

  const db = supabaseAdmin();
  const { data } = await db
    .from("events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  const items = (data ?? []) as EventRow[];

  const user = await requireUser();
  let isAdmin = false;
  if (user) {
    const { data: me } = await db.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
    isAdmin = me?.role === "admin";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl sm:text-4xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("subtitle")}</p>
      </div>

      {isAdmin ? <EventForm /> : null}

      {items.length === 0 ? (
        <div className="card p-12 text-center text-sm font-semibold text-muted-ink">{t("empty")}</div>
      ) : (
        <ul className="flex flex-col gap-5">
          {items.map((ev) => {
            let host = "";
            try {
              host = new URL(ev.url).hostname.replace(/^www\./, "");
            } catch {
              host = "";
            }
            const image = typeof ev.meta?.image === "string" && ev.meta.image.startsWith("https://") ? ev.meta.image : null;
            const title = ev.meta?.title ?? host;
            const desc = ev.meta?.description ?? "";
            const provider = ev.meta?.provider === "x" ? "x" : "web";
            const author = ev.meta?.author;
            return (
              <li key={ev.id} className="card p-5">
                {ev.caption ? <p className="mb-3 text-sm font-bold">{ev.caption}</p> : null}
                <a
                  href={ev.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-4 overflow-hidden rounded-xl border-2 border-black bg-white p-3 transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      className="h-28 w-44 shrink-0 rounded-lg border-2 border-black object-cover"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`mb-1.5 w-fit rounded-full border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                        provider === "x" ? "bg-[#0c0c10] text-white" : "bg-[#d8ff3e]"
                      }`}
                    >
                      {provider === "x" ? t("badgeX") : t("badgeWeb")}
                    </span>
                    <p className="truncate text-sm font-bold">{author ? `${author} — ${title}` : title}</p>
                    {desc ? <p className="mt-1 line-clamp-2 text-xs text-muted-ink">{desc}</p> : null}
                    <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                      <span className="mono truncate text-[11px] font-semibold text-muted-ink">{host}</span>
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-ink">
                        {new Date(ev.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </a>
                {isAdmin ? (
                  <div className="mt-3 flex justify-end">
                    <DeleteEventButton id={ev.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
