const UA =
  "Mozilla/5.0 (compatible; ArtianPreview/1.0; +https://artian-capital-group.trading-ekaryan.workers.dev)";
const FETCH_TIMEOUT_MS = 4_000;
const HTML_CAP = 500_000;

export interface EventMeta {
  provider?: "x" | "web";
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  siteName?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .trim();
}

function attr(content: string): string {
  return decodeEntities(content.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))));
}

/** Ambil nilai tag meta/property (dua urutan atribut umum). */
function findMeta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']{1,1200})["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']{1,1200})["'][^>]+(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return attr(m[1]);
  }
  return null;
}

function isXHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === "x.com" || h === "twitter.com" || h === "mobile.twitter.com";
}

/** Card preview untuk URL postingan — oEmbed X dulu, fallback og-tags. */
export async function fetchEventMeta(url: string): Promise<EventMeta> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }

  if (isXHost(parsed.hostname)) {
    try {
      const oembed = `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(url)}`;
      const res = await fetch(oembed, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          author_name?: string;
          author_url?: string;
          thumbnail_url?: string;
          html?: string;
        };
        const title = data.html?.match(/<strong[^>]*>([^<]{1,300})<\/strong>/i)?.[1] ?? undefined;
        return {
          provider: "x",
          author: data.author_name ?? undefined,
          title: attr(title ?? data.author_name ?? ""),
          image: data.thumbnail_url ?? undefined,
          description: "",
        };
      }
    } catch {
      /* lanjut fallback */
    }
  }

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return {};
    const html = (await res.text()).slice(0, HTML_CAP);
    const ogTitle = findMeta(html, "og:title");
    const titleTag = ogTitle ?? attr(html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ?? "");
    return {
      provider: "web",
      title: titleTag || undefined,
      description: findMeta(html, "og:description") ?? findMeta(html, "description") ?? undefined,
      image: findMeta(html, "og:image") ?? findMeta(html, "twitter:image") ?? undefined,
      siteName: findMeta(html, "og:site_name") ?? parsed.hostname,
    };
  } catch {
    return {};
  }
}
