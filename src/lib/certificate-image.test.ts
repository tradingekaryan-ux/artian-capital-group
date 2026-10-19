import { describe, expect, it } from "vitest";
import { CERT_H, CERT_W, drawCertificate, wrapText, type CertificateCtx } from "@/lib/certificate-image";

/** Stub ctx: measureText ≈10px/karakter + rekam panggilan utk asersi. */
function recordingCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  const ctx: CertificateCtx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: rec("fillRect") as CertificateCtx["fillRect"],
    strokeRect: rec("strokeRect") as CertificateCtx["strokeRect"],
    fillText: rec("fillText") as CertificateCtx["fillText"],
    measureText: (t: string) => ({ width: t.length * 10 }),
    save: rec("save") as CertificateCtx["save"],
    restore: rec("restore") as CertificateCtx["restore"],
    beginPath: rec("beginPath") as CertificateCtx["beginPath"],
    arc: rec("arc") as CertificateCtx["arc"],
    moveTo: rec("moveTo") as CertificateCtx["moveTo"],
    lineTo: rec("lineTo") as CertificateCtx["lineTo"],
    stroke: rec("stroke") as CertificateCtx["stroke"],
    fill: rec("fill") as CertificateCtx["fill"],
  };
  return { ctx, calls };
}

const image = {
  recipient: "Budi Santoso",
  achievement: "Mainnet Launcher",
  detail: "Launched10 mainnet tokens",
  date: "Oct18,2026",
  serial: "token-mainnet-10",
};

describe("wrapText", () => {
  it("membungkus kata-katapada baris yg muat (10px/karakter)", () => {
    const { ctx } = recordingCtx();
    const lines = wrapText(ctx, "satu dua tiga empat lima enam tujuh delapan", 50); // ≤5 kata/baris
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length * 10 <= 50 || !l.includes(" "))).toBe(true);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe("satu dua tiga empat lima enam tujuh delapan");
  });

  it("teks pendek tanpa spasi →1 baris utuh", () => {
    const { ctx } = recordingCtx();
    expect(wrapText(ctx, "Raycoin", 500)).toEqual(["Raycoin"]);
  });
});

describe("drawCertificate", () => {
  it("menggambar tanpa error & memuat nama + jenis pencapaian", () => {
    const { ctx, calls } = recordingCtx();
    drawCertificate(ctx, image);
    const texts = calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
    expect(texts).toContain("Budi Santoso");
    expect(texts).toContain("Mainnet Launcher");
    expect(texts).toContain("CERTIFICATE");
    expect(texts.join(" ")).toContain("Launched10 mainnet tokens");
    expect(texts.join(" ")).toContain("SERIAL #token-mainnet-10");
    // bingkai tebal + bingkai tipis + plang lime + garis footer
    expect(calls.filter((c) => c.op === "strokeRect").length).toBeGreaterThanOrEqual(3);
  });

  it("nama kosong → fallback 'Artian Member'; save/restore berpasangan", () => {
    const { ctx, calls } = recordingCtx();
    drawCertificate(ctx, { ...image, recipient: "  " });
    const texts = calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
    expect(texts).toContain("Artian Member");
    expect(calls.filter((c) => c.op === "save")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "restore")).toHaveLength(1);
  });

  it("konsisten dgn ukuran kanvas yang dideklarasikan", () => {
    expect(CERT_W).toBe(1200);
    expect(CERT_H).toBe(850);
    const { ctx, calls } = recordingCtx();
    drawCertificate(ctx, image);
    const bg = calls.find((c) => c.op === "fillRect" && c.args[2] === CERT_W && c.args[3] === CERT_H);
    expect(bg).toBeTruthy(); // latar penuh seukuran kanvas
  });
});
