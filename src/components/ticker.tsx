const TICKS = [
  "Launch your token on Solana",
  "Zero infra fees",
  "Pay in USDC · withdraw anytime",
  "Live market data",
  "Built for creators",
  "Liquidity pools in one click",
] as const;

export function Ticker() {
  const doubled = [...TICKS, ...TICKS];
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
