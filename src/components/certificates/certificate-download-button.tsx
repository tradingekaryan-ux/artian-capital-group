"use client";

import { useState } from "react";
import { CERT_H, CERT_W, drawCertificate, type CertificateImage } from "@/lib/certificate-image";

/**
 * Tombol **Download PNG** sertifikat (hanya untuk sertifikat yg terbuka).
 * Menggambar sertifikat ke kanvas di sisi client → `canvas.toBlob` → unduh
 * `artian-certificate-<serial>.png` (berisi nama user + jenis pencapaian).
 */
export function CertificateDownloadButton({
  image,
  label,
}: {
  image: CertificateImage;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = CERT_W;
      canvas.height = CERT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported in this browser");
      drawCertificate(ctx, image);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Failed to render PNG");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `artian-certificate-${image.serial}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void download()}
        className="w-fit rounded-full border-2 border-black bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-[2px_2px_0_0_#000] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
      >
        {busy ? "Rendering…" : `↓ ${label}`}
      </button>
      {error && <p className="text-[10px] font-bold text-[#b91c1c]">{error}</p>}
    </div>
  );
}
