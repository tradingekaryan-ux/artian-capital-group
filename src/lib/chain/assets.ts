import { supabaseAdmin } from "@/lib/db/client";
import { randomBytes } from "node:crypto";

const BUCKET = "token-assets";

export interface TokenMetadataInput {
  name: string;
  symbol: string;
  description?: string;
  imageBase64: string; // data-url atau raw base64 (png/jpeg/webp)
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
}

function extensionFromBase64(b64: string): string {
  if (b64.startsWith("data:image/png")) return "png";
  if (b64.startsWith("data:image/webp")) return "webp";
  if (b64.startsWith("data:image/jpeg") || b64.startsWith("data:image/jpg")) return "jpg";
  return "png";
}

function stripDataUrl(b64: string): string {
  const idx = b64.indexOf("base64,");
  return idx >= 0 ? b64.slice(idx + 7) : b64;
}

/**
 * Upload logo + metadata JSON ke Supabase Storage → URI publik untuk on-chain.
 * (Upgrade permanen Arweave/Irys = fase lanjut.)
 */
export async function uploadTokenAssets(
  userId: string,
  meta: TokenMetadataInput,
): Promise<{ logoUri: string; metadataUri: string }> {
  const db = supabaseAdmin();
  const id = randomBytes(8).toString("hex");
  const ext = extensionFromBase64(meta.imageBase64);
  const logoPath = `${userId}/${id}-logo.${ext}`;
  const metaPath = `${userId}/${id}-metadata.json`;

  const logoBuf = Buffer.from(stripDataUrl(meta.imageBase64), "base64");
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(logoPath, logoBuf, { contentType: `image/${ext}`, upsert: false });
  if (upErr) throw new Error(`Logo upload failed: ${upErr.message}`);

  const offchain = {
    name: meta.name,
    symbol: meta.symbol,
    description: meta.description ?? "",
    image: "",
    extensions: {
      website: meta.website || undefined,
      external_url: meta.website || undefined,
      twitter: meta.twitter || undefined,
      telegram: meta.telegram || undefined,
      discord: meta.discord || undefined,
    },
  };

  const { data: logoUrl } = db.storage.from(BUCKET).getPublicUrl(logoPath);
  offchain.image = logoUrl.publicUrl;

  const { error: metaErr } = await db.storage
    .from(BUCKET)
    .upload(metaPath, Buffer.from(JSON.stringify(offchain, null, 2)), {
      contentType: "application/json",
      upsert: false,
    });
  if (metaErr) throw new Error(`Metadata upload failed: ${metaErr.message}`);

  const { data: metaUrl } = db.storage.from(BUCKET).getPublicUrl(metaPath);
  return { logoUri: logoUrl.publicUrl, metadataUri: metaUrl.publicUrl };
}

/** Pastikan bucket publik ada (dipanggil sekali via admin saat bootstrap). */
export async function ensureAssetsBucket(): Promise<void> {
  const db = supabaseAdmin();
  try {
    await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: "5MB" });
  } catch {
    /* sudah ada */
  }
}
