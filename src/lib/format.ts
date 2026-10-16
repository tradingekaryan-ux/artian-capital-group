/** Format angka pendek: 1234 → "1.2K", 1234567 → "1.2M" */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format angka biasa: 1234.5 → "1,234.5" */
export function formatNumber(value: number, maxFrac = 2): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFrac }).format(value);
}

/** Format USD: 1234.5 → "$1,234.50" */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

/** Raw USDC integer (6 desimal) → number USDC */
export function rawToUsdc(raw: string | bigint | number): number {
  return Number(raw) / 1_000_000;
}

/** number USDC → tampilan */
export function formatUsdc(raw: string | bigint): string {
  return formatNumber(rawToUsdc(raw), 6);
}

/** Potong alamat: So111…111 → So111…111 */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** Detik epoch → ISO date */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Detik epoch → waktu relatif pendek */
export function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(new Date(d).toISOString());
}

/** Persen perubahan dengan tanda */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
