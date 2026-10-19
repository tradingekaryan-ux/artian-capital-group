/**
 * Pencapaian (achievement) user → **sertifikat** di `/dashboard/certificates`.
 *
 * Definisi murni + evaluator murni (mudah diuji) — pencapaian dihitung langsung
 * dari dataExisting (bukan tabel baru):
 * - member      — akun terdaftar (selalu terbuka setelah registrasi)
 * - token_devnet — jumlah token LIVE dari wallet demo/devnet (`tokens.kind='demo'`)
 * - token_mainnet — jumlah token LIVE mainnet (`tokens.kind='mainnet'`)
 * - algo        — jumlah algo yang diterbitkan user (`algos`)
 *
 * Semua sertifikat SELALU tampil; yang belum terpenuhi tampil terkunci (locked)
 * lengkap dengan progres `count/threshold`.
 */
export type AchievementCategory = "member" | "token_devnet" | "token_mainnet" | "algo";

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  threshold: number;
}

/**10 sertifikat, urut: member → devnet1 → mainnet1/10/100/1000 → algo1/10/100/1000. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "member", category: "member", threshold: 1 },
  { id: "token-devnet-1", category: "token_devnet", threshold: 1 },
  { id: "token-mainnet-1", category: "token_mainnet", threshold: 1 },
  { id: "token-mainnet-10", category: "token_mainnet", threshold: 10 },
  { id: "token-mainnet-100", category: "token_mainnet", threshold: 100 },
  { id: "token-mainnet-1000", category: "token_mainnet", threshold: 1000 },
  { id: "algo-1", category: "algo", threshold: 1 },
  { id: "algo-10", category: "algo", threshold: 10 },
  { id: "algo-100", category: "algo", threshold: 100 },
  { id: "algo-1000", category: "algo", threshold: 1000 },
];

/** Ringkasan pencapaian dari DB (dihitung halaman server). */
export interface AchievementTally {
  tokenDevnet: number;
  tokenMainnet: number;
  algo: number;
  /** Waktu registrasi (profiles.created_at) — dasar sertifikat member. */
  memberSince: string;
  /** Waktu token/algo pertama per kategori (ISO) — null bila belum ada. */
  tokenDevnetAt: string | null;
  tokenMainnetAt: string | null;
  algoAt: string | null;
}

export interface AchievementStatus extends AchievementDef {
  /** Pencapaian saat ini (mis. jumlah token utk kategori token). */
  count: number;
  unlocked: boolean;
  /** Tanggal tercapai (hanya saat unlocked) — kategori = waktu capaian pertama. */
  achievedAt: string | null;
}

/**
 * Hitung status ke-10 sertifikat dari tally. Murni (tanpa DB/time) sehingga
 * mudah diuji. Catatan: `achievedAt` memakai waktu **capaian pertama kategori**
 * (mis. sertifikat "10 token" memakai tanggal token pertama) — cukup utk
 * menampilkan kapan pencapaian kategori dimulai.
 */
export function evaluateAchievements(tally: AchievementTally): AchievementStatus[] {
  const countOf = (c: AchievementCategory): number =>
    c === "member"
      ? 1
      : c === "token_devnet"
        ? tally.tokenDevnet
        : c === "token_mainnet"
          ? tally.tokenMainnet
          : tally.algo;
  const atOf = (c: AchievementCategory): string | null =>
    c === "member"
      ? tally.memberSince
      : c === "token_devnet"
        ? tally.tokenDevnetAt
        : c === "token_mainnet"
          ? tally.tokenMainnetAt
          : tally.algoAt;

  return ACHIEVEMENTS.map((def) => {
    const count = countOf(def.category);
    const unlocked = count >= def.threshold;
    return { ...def, count, unlocked, achievedAt: unlocked ? atOf(def.category) : null };
  });
}
