/**
 * Gambar sertifikat pencapaian ke **canvas** → diunduh user sbg **PNG**
 * (ala payout certificate propfirm: berisi nama user + jenis pencapaian).
 *
 * Digambar manual via Canvas API **tanpa dependensi** — tema neobrutalistis
 * situs: bingkai hitam tebal ganda, aksen lime `#d8ff3e`, teks tebal.
 * `CertificateCtx` = subset API canvas yg dipakai → mudah diuji dgn stub.
 */

export interface CertificateImage {
  /** Nama penerima (display_name → username → email). */
  recipient: string;
  /** Jenis pencapaian (mis. "Mainnet Launcher"). */
  achievement: string;
  /** Rincian milestone (mis. "Launched10 mainnet tokens"). */
  detail: string;
  /** Tanggal capaian sudah diformat (mis. "Oct18,2026"). */
  date: string;
  /** ID sertifikat sbg nomor seri (mis. "token-mainnet-10"). */
  serial: string;
}

/** Subset `CanvasRenderingContext2D` yang dipakai `drawCertificate`. */
export interface CertificateCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
}

/** Ukuran kanvas (lanscape, rasio mirip A4). */
export const CERT_W = 1200;
export const CERT_H = 850;

const INK = "#000000";
const LIME = "#d8ff3e";
const MUTED = "#4b4b4b";
const FONT = 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const MAX_TEXT = 960; // lebar maks teks isi (bingkai + margin)

/** Spasi manual utk teks kecil ber-tracking ("ARTIAN" → "A R T I A N"). */
function tracked(text: string): string {
  return [...text].join(" ");
}

/** Pecah teks jadi baris yang muat di `maxWidth` (wrap per kata). */
export function wrapText(ctx: CertificateCtx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Kecilkan ukuran font (dari `startPx`) sampai `text` muat di `maxWidth`. */
function fitFont(ctx: CertificateCtx, text: string, maxWidth: number, startPx: number, weight: string): number {
  let px = startPx;
  ctx.font = `${weight} ${px}px ${FONT}`;
  while (px > 20 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${FONT}`;
  }
  return px;
}

/** Gambar sertifikat penuh ke ctx (ukuran {@link CERT_W}×{@link CERT_H}). */
export function drawCertificate(ctx: CertificateCtx, image: CertificateImage): void {
  const cx = CERT_W / 2;
  const recipient = image.recipient.trim() || "Artian Member";

  ctx.save();

  // Latar putih + bingkai hitam tebal ganda (khas tema situs)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CERT_W, CERT_H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  ctx.strokeRect(20, 20, CERT_W - 40, CERT_H - 40);
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, CERT_W - 72, CERT_H - 72);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ── Header ──
  ctx.fillStyle = INK;
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(tracked("ARTIAN CAPITAL GROUP"), cx, 112);
  ctx.font = `900 66px ${FONT}`;
  ctx.fillText("CERTIFICATE", cx, 192);
  ctx.font = `700 20px ${FONT}`;
  ctx.fillText(tracked("OF ACHIEVEMENT"), cx, 232);
  // Strip lime di bawah judul
  ctx.fillStyle = LIME;
  ctx.fillRect(cx - 170, 248, 340, 12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 170, 248, 340, 12);

  // ── Segel bulat kanan-atas (lime + bintang) ──
  ctx.beginPath();
  ctx.arc(1040, 150, 62, 0, Math.PI * 2);
  ctx.fillStyle = LIME;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `900 44px ${FONT}`;
  ctx.fillText("★", 1040, 158);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText(tracked("ACHIEVED"), 1040, 186);

  // ── Penerima ──
  ctx.fillStyle = MUTED;
  ctx.font = `italic 500 24px ${FONT}`;
  ctx.fillText("This certificate is proudly presented to", cx, 330);

  ctx.fillStyle = INK;
  const namePx = fitFont(ctx, recipient, MAX_TEXT, 56, "800");
  ctx.fillText(recipient, cx, 410);
  // Garis bawah nama
  const nameW = Math.min(ctx.measureText(recipient).width, MAX_TEXT);
  ctx.beginPath();
  ctx.moveTo(cx - nameW / 2 - 24, 430);
  ctx.lineTo(cx + nameW / 2 + 24, 430);
  ctx.lineWidth = namePx > 30 ? 3 : 2;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // ── Jenis pencapaian (plang lime) ──
  const achv = image.achievement;
  const achvPx = fitFont(ctx, achv, MAX_TEXT - 60, 36, "900");
  const achvW = ctx.measureText(achv).width;
  ctx.fillStyle = LIME;
  ctx.fillRect(cx - achvW / 2 - 24, 470, achvW + 48, 62);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - achvW / 2 - 24, 470, achvW + 48, 62);
  ctx.fillStyle = INK;
  ctx.font = `900 ${achvPx}px ${FONT}`;
  ctx.fillText(achv, cx, 513);

  // ── Rincian milestone (maks2 baris) ──
  ctx.fillStyle = MUTED;
  ctx.font = `500 22px ${FONT}`;
  const detailLines = wrapText(ctx, image.detail, MAX_TEXT).slice(0, 2);
  detailLines.forEach((line, i) => ctx.fillText(line, cx, 578 + i * 30));

  // ── Footer: tanggal · situs · nomor seri ──
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, 700);
  ctx.lineTo(CERT_W - 80, 700);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(`Awarded on ${image.date || "—"}`, 90, 748);

  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = `500 16px ${FONT}`;
  ctx.fillText("artian-capital-group.trading-ekaryan.workers.dev", cx, 746);

  ctx.textAlign = "right";
  ctx.fillStyle = INK;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(`SERIAL #${image.serial}`, CERT_W - 90, 746);

  ctx.restore();
}
