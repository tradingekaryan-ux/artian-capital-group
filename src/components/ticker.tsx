const TICKS = {
  en: [
    "Launch your token on Solana",
    "Zero infra fees",
    "Pay in USDC · withdraw anytime",
    "Live market data",
    "Built for creators",
    "Liquidity pools in one click",
  ],
  id: [
    "Luncurkan token di Solana",
    "Tanpa biaya infra",
    "Bayar USDC · tarik kapan saja",
    "Data pasar real-time",
    "Dibuat untuk kreator",
    "Liquidity pool sekali klik",
  ],
} as const;

export function Ticker({ locale }: { locale: string }) {
  const items = TICKS[locale === "id" ? "id" : "en"];
  const doubled = [...items, ...items];
  return (
    <div className="ticker" aria-hidden>
      <div className="ticker-track">
        {doubled.map((text, i) => (
          <span key={i} className="ticker-item">
            {text}
            <span className="opacity-60">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
