"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { track } from "@/lib/analytics";

interface CommentDto {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  username: string;
}

export function CommentsSection({
  mint,
  initial,
  currentUserId,
}: {
  mint: string;
  initial: CommentDto[];
  currentUserId: string | null;
}) {
  const t = useTranslations("token");
  const router = useRouter();
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserId) {
      router.push("/login");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/community/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, body: body.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setComments((prev) => [
        {
          id: json.comment.id,
          userId: currentUserId,
          body: json.comment.body,
          createdAt: json.comment.created_at,
          username: "you",
        },
        ...prev,
      ]);
      setBody("");
      track("comment_posted", { mint });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/community/comments?id=${id}`, { method: "DELETE" });
    if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <section className="card overflow-hidden">
      <div className="chrome">
        <span className="chrome-dots"><span /><span /><span /></span>
        <span className="text-muted-ink">{t("comments")} ({comments.length})</span>
      </div>
      <div className="p-5">

      <form onSubmit={submit} className="flex flex-col gap-2">
        <textarea
          className="input min-h-20"
          placeholder={t("commentPlaceholder")}
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-ink">{body.length}/1000</span>
          <button className="btn btn-primary" disabled={busy || !body.trim()}>
            {busy ? "…" : t("commentCta")}
          </button>
        </div>
        {error && <p className="text-sm font-bold text-[#b91c1c]">{error}</p>}
      </form>

      <ul className="mt-4 flex flex-col divide-y divide-black/10">
        {comments.map((c) => (
          <li key={c.id} className="py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold">@{c.username}</span>
              <span className="text-xs text-muted-ink">
                {new Date(c.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-muted-ink">{c.body}</p>
            {currentUserId === c.userId && (
              <button
                className="mt-1 text-xs font-bold text-[#b91c1c] hover:underline"
                onClick={() => remove(c.id)}
              >
                delete
              </button>
            )}
          </li>
        ))}
        {comments.length === 0 && (
          <li className="py-3 text-sm text-muted-ink">No comments yet — be the first.</li>
        )}
      </ul>
      </div>
    </section>
  );
}
