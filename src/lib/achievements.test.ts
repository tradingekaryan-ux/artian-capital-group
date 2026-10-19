import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, evaluateAchievements, type AchievementTally } from "@/lib/achievements";

const base: AchievementTally = {
  tokenDevnet: 0,
  tokenMainnet: 0,
  algo: 0,
  memberSince: "2026-10-18T07:00:00.000Z",
  tokenDevnetAt: null,
  tokenMainnetAt: null,
  algoAt: null,
};

describe("ACHIEVEMENTS (definisi10 sertifikat)", () => {
  it("ada10 dgn urutan & ambang sesuai spesifikasi", () => {
    expect(ACHIEVEMENTS.map((a) => `${a.id}:${a.threshold}`)).toEqual([
      "member:1",
      "token-devnet-1:1",
      "token-mainnet-1:1",
      "token-mainnet-10:10",
      "token-mainnet-100:100",
      "token-mainnet-1000:1000",
      "algo-1:1",
      "algo-10:10",
      "algo-100:100",
      "algo-1000:1000",
    ]);
  });

  it("id unik (dipakai sbg kunci i18n items.<id>)", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe("evaluateAchievements", () => {
  it("user baru saja daftar: sertifikat member terbuka, sisanya locked dgn progres0", () => {
    const out = evaluateAchievements(base);
    expect(out).toHaveLength(10);
    const member = out[0];
    expect(member.unlocked).toBe(true);
    expect(member.achievedAt).toBe("2026-10-18T07:00:00.000Z");
    for (const c of out.slice(1)) {
      expect(c.unlocked).toBe(false);
      expect(c.achievedAt).toBeNull();
      expect(c.count).toBe(0); // progres tetap tampil utk card terkunci
    }
  });

  it("token mainnet5 → hanya ambang1 yg terbuka; progres5/10 tampil", () => {
    const out = evaluateAchievements({ ...base, tokenMainnet: 5, tokenMainnetAt: "2026-10-19T00:00:00.000Z" });
    const mainnet = out.filter((c) => c.category === "token_mainnet");
    expect(mainnet.map((c) => c.unlocked)).toEqual([true, false, false, false]);
    expect(mainnet[1].count).toBe(5); // dipakai utk menampilkan "5/10"
    expect(mainnet[0].achievedAt).toBe("2026-10-19T00:00:00.000Z");
    expect(mainnet[1].achievedAt).toBeNull();
  });

  it("tepat di ambang → terbuka (>= threshold)", () => {
    const out = evaluateAchievements({ ...base, algo: 10, algoAt: "2026-10-20T00:00:00.000Z" });
    const algo = out.filter((c) => c.category === "algo");
    expect(algo.map((c) => c.unlocked)).toEqual([true, true, false, false]);
  });

  it("semua kategori penuh →10/10 unlocked dgn tanggal masing-masing", () => {
    const out = evaluateAchievements({
      tokenDevnet: 3,
      tokenMainnet: 1500,
      algo: 1000,
      memberSince: "2026-10-18T07:00:00.000Z",
      tokenDevnetAt: "2026-10-18T08:00:00.000Z",
      tokenMainnetAt: "2026-10-19T08:00:00.000Z",
      algoAt: "2026-10-20T08:00:00.000Z",
    });
    expect(out.every((c) => c.unlocked)).toBe(true);
    expect(out.every((c) => c.achievedAt !== null)).toBe(true);
    expect(out.find((c) => c.id === "token-devnet-1")?.achievedAt).toBe("2026-10-18T08:00:00.000Z");
  });

  it("count > threshold tidak membuat count melonjak (tetap nilai asli utk progres)", () => {
    const out = evaluateAchievements({ ...base, tokenMainnet: 1200, tokenMainnetAt: "2026-10-19T00:00:00.000Z" });
    expect(out.find((c) => c.id === "token-mainnet-1000")?.count).toBe(1200);
    expect(out.find((c) => c.id === "token-mainnet-1000")?.unlocked).toBe(true);
  });
});
