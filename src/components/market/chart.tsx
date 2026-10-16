/** Sparkline mini untuk header token (client-safe, murni SVG). */
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="h-10 w-24 rounded-lg border-2 border-black bg-[#ede9fe]" />;
  }
  const w = 96;
  const h = 36;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  const color = up ? "#15803d" : "#b91c1c";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={coords} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

interface SnapshotPoint {
  ts: string;
  price_usd: number | null;
}

/** Chart harga utama dengan sumbu harga + waktu. */
export function PriceChart({ points }: { points: SnapshotPoint[] }) {
  const clean = points.filter((p) => p.price_usd !== null);
  if (clean.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border-2 border-black bg-[#f5f3ff] text-sm font-semibold text-muted-ink">
        Belum cukup data chart — data mulai terkumpul setelah pool aktif.
      </div>
    );
  }
  const w = 640;
  const h = 220;
  const padL = 52;
  const padB = 24;
  const prices = clean.map((p) => p.price_usd as number);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const range = max - min || max || 1;
  const coords = clean
    .map((p, i) => {
      const x = padL + (i / (clean.length - 1)) * (w - padL - 8);
      const y = 8 + (1 - ((p.price_usd as number) - min) / range) * (h - padB - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = prices[prices.length - 1] >= prices[0];
  const color = up ? "#15803d" : "#b91c1c";
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-56 w-full min-w-[480px]"
        role="img"
        aria-label="Price chart"
      >
        {gridLines.map((g) => {
          const y = 8 + g * (h - padB - 8);
          const value = max - g * range;
          return (
            <g key={g}>
              <line
                x1={padL}
                y1={y}
                x2={w - 8}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
              <text x={4} y={y + 3} fontSize="9" fill="var(--muted)">
                {value < 0.01 ? value.toExponential(1) : value.toFixed(4)}
              </text>
            </g>
          );
        })}
        <polyline points={coords} fill="none" stroke={color} strokeWidth="2" />
        <text x={padL} y={h - 6} fontSize="9" fill="var(--muted)">
          {new Date(clean[0].ts).toLocaleDateString()}
        </text>
        <text x={w - 70} y={h - 6} fontSize="9" fill="var(--muted)">
          {new Date(clean[clean.length - 1].ts).toLocaleDateString()}
        </text>
      </svg>
    </div>
  );
}
