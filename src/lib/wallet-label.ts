/**
 * Normalisasi nama (label) wallet — dipakai saat **buat** & **ganti nama** wallet.
 *
 * Aturan:
 * - buang karakter kontrol (escape dsb.) & trim spasi di ujung
 * - hasil kosong → `null` (pemanggil memakai nama otomatis saat buat,
 *   atau menolak request saat rename)
 * - dipotong ke maksimum {@link WALLET_LABEL_MAX} char (batas form & tampilan)
 */
export const WALLET_LABEL_MAX = 40;

export function normalizeWalletLabel(label?: string | null): string | null {
  if (typeof label !== "string") return null;
  const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, WALLET_LABEL_MAX);
}
