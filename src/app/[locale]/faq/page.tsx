import type { Metadata } from "next";
import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "FAQ",
    description:
      "How Artian Capital Group works — wallets, transactions, fees, the token launcher, signal algos, subscriptions, the Event Tracker and troubleshooting.",
  };
}

interface FaqItem {
  q: string;
  a: ReactNode;
}

interface FaqSection {
  title: string;
  items: FaqItem[];
}

const SECTIONS: FaqSection[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "What is Artian Capital Group?",
        a: "A finance hub for builders and traders on Solana: launch your own token with liquidity in minutes, subscribe to crypto signal algos and forward them to your community, and follow live market events in one place. You pay in USDC — no hidden infrastructure fees.",
      },
      {
        q: "Which network and currencies are used?",
        a: "Everything runs on Solana. USDC (SPL) pays service fees, token launches and algo subscriptions; SOL pays network gas for every on-chain transaction. A demo (devnet) wallet is available for practice with zero real value at risk.",
      },
      {
        q: "Do I need an account? Do I need a seed phrase?",
        a: "Register with your email, password and a 6-digit email verification code. A Solana wallet is created for you automatically — no seed phrase to manage. Registration is rate-limited to 3 accounts per hour.",
      },
      {
        q: "How do I get started?",
        a: (
          <ul className="list-disc space-y-1 pl-5">
            <li>Create an account and open Dashboard → Wallet.</li>
            <li>
              Top up your deposit address with USDC (fees &amp; purchases) and SOL (gas) —
              deposits appear within about a minute.
            </li>
            <li>Launch a token from Create, or subscribe to an algo from the Algos marketplace.</li>
            <li>Follow announcements on the Event Tracker.</li>
          </ul>
        ),
      },
    ],
  },
  {
    title: "Token launcher & markets",
    items: [
      {
        q: "How do I create a token?",
        a: "A four-step wizard: token details → branding (logo, description, socials) → authorities (optionally revoke mint/freeze authority and make metadata immutable) → review & pay. The service fee is deducted in USDC and network gas is paid in SOL from your built-in wallet. You can attach an initial liquidity pool at launch with an LP% slider — if the pool step fails, the pool fee is refunded and you can add the pool later from the token page.",
      },
      {
        q: "How does trading work after launch?",
        a: "Every token gets its own page with a live price chart, stats (price, 24h change, liquidity, volume, FDV, holders, supply) and a liquidity pool panel: in-app swaps between your token and USDC, plus add/remove liquidity.",
      },
      {
        q: "What is Explore?",
        a: "The token directory — search by name, symbol or mint and sort by newest or top gainers. Devnet tokens are labeled so you never confuse them with mainnet ones.",
      },
      {
        q: "What are Burn and Burn & Earn?",
        a: "Burn permanently destroys tokens you hold from your live (mainnet) wallet — the supply shrinks on-chain and it cannot be undone. Burn & Earn does the same but credits you 1 reward point for every whole token destroyed. Both need a little SOL for gas.",
      },
    ],
  },
  {
    title: "Wallets & transactions",
    items: [
      {
        q: "What is the difference between mainnet and demo wallets?",
        a: "The demo wallet runs on devnet — balances are simulated, with one-click faucet buttons, and withdrawals and swaps are disabled. Perfect for practicing. Mainnet wallets hold real value. You can create multiple mainnet wallets, switch the active one at any time, and archive wallets (hidden from your list; admins can still view them). The TREASURY badge marks the platform's internal admin wallet.",
      },
      {
        q: "How do I deposit USDC or SOL?",
        a: "Open Dashboard → Wallet and copy your wallet address. Send USDC (service fees) and SOL (transaction gas) on the Solana network to that address. Deposits are detected and appear automatically within about a minute.",
      },
      {
        q: "How do I withdraw USDC?",
        a: "Wallet → Withdraw USDC: enter the amount and destination address, then confirm with the 6-digit code sent to your email. A fee per the live schedule applies. Withdrawals work on mainnet wallets only — the demo wallet cannot withdraw.",
      },
      {
        q: "Where can I see my transaction history?",
        a: (
          <>
            Wallet → Recent activity lists recent on-chain events for the active wallet.
            Dashboard → Orders records every service-fee payment with its amount, status and date.
          </>
        ),
      },
    ],
  },
  {
    title: "How fees work",
    items: [
      {
        q: "What will I pay?",
        a: (
          <>
            Two separate costs, paid to different parties:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <b>Service fees — USDC.</b> Charged by the platform for each service, deducted from
                your balance and settled on-chain to the platform treasury.
              </li>
              <li>
                <b>Network gas — SOL.</b> Paid by you directly to the Solana network. The platform
                never pays gas for you and never tops up your wallet — keep enough SOL before each
                action.
              </li>
            </ul>
            Storage rent is refunded to you whenever accounts are closed. Live amounts are listed on{" "}
            <Link href="/dashboard/wallet" className="font-bold text-ink underline underline-offset-2">
              Dashboard → Wallet
            </Link>
            .
          </>
        ),
      },
      {
        q: "Can I audit what I paid?",
        a: "Yes — every service-fee order is recorded under Dashboard → Orders, and wallet activity shows each on-chain movement on the active wallet.",
      },
    ],
  },
  {
    title: "Algo marketplace (signals)",
    items: [
      {
        q: "What is an algo?",
        a: "A signal channel you publish to your audience — free, one-time lifetime, or monthly USDC subscription. Every signal lands on a public feed that anyone can read; paid subscribers additionally unlock output slots that forward signals to their own endpoints.",
      },
      {
        q: "How do creators send signals?",
        a: "Create your algo in Dashboard → Algos and copy its webhook URL (a per-algo token endpoint). POST signals to it from a TradingView alert or any script — each signal appears on the public feed instantly and is forwarded to active subscribers automatically.",
      },
      {
        q: "What are output slots?",
        a: "While subscribed to a paid algo, you can paste a destination URL on its page — a Discord webhook or any HTTP endpoint. Every new signal is delivered there automatically, with automatic retries if the first attempt fails.",
      },
      {
        q: "How does subscription payment work?",
        a: (
          <>
            <b>Free algos</b> subscribe instantly with no transaction. <b>Paid algos</b> run one
            on-chain USDC transfer from your active mainnet wallet: the flat platform commission goes
            to the platform treasury and the remainder to the creator — you pay a little SOL for gas.
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Lifetime — never expires.</li>
              <li>Monthly — active for 30 days; renewal is simply paying again.</li>
              <li>You cannot subscribe to your own algo.</li>
            </ul>
          </>
        ),
      },
      {
        q: "What happens if the creator pauses or deletes the algo?",
        a: "While paused, new signals are rejected and no one can subscribe — the feed stays visible to the creator. Creators can delete individual messages from the feed; deleting an algo removes its hooks, signals, subscriptions and output slots permanently.",
      },
    ],
  },
  {
    title: "Event Tracker & community",
    items: [
      {
        q: "What is the Event Tracker?",
        a: "A live feed of announcements, community posts and highlights with direct links — posted by the Artian team from admin accounts. The latest 100 events are shown.",
      },
      {
        q: "Comments and watchlist",
        a: "Every token page has comments and a watch/unwatch button. Posting requires an active account — suspended accounts cannot comment or post.",
      },
      {
        q: "How do I join the community?",
        a: "A Discord button sits at the bottom-right corner of every page and opens the community invite. Platform admins can also push automated alerts — events, transactions, new algos and new users — to community webhooks.",
      },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      {
        q: "\u201cInsufficient USDC balance\u201d or \u201cInsufficient SOL for gas\u201d",
        a: "Top up your deposit address: USDC covers service fees and purchases, SOL covers network gas. Keep a small SOL buffer — subscriptions, for example, need roughly 0.01 SOL extra for gas.",
      },
      {
        q: "\u201cSubscribe requires an active mainnet wallet\u201d",
        a: "Switch to (or create) a mainnet wallet first — demo wallets can't be used for paid subscriptions. Creators likewise need an active mainnet wallet to receive USDC.",
      },
      {
        q: "\u201cAlgo is inactive\u201d or my signal isn't arriving",
        a: "That error means the creator paused the algo. If a signal doesn't reach your output slot: confirm your subscription is still active (monthly ones expire after 30 days), your slot URL uses valid http(s), and the algo is active — failed deliveries are retried automatically.",
      },
      {
        q: "Where do I get demo funds?",
        a: "The demo wallet banner has one-click devnet faucets for SOL (pays gas) and USDC (pays service fees). Paste your demo wallet address into the faucet if it asks.",
      },
      {
        q: "Registration limit or suspended account",
        a: "Registration is limited to 3 accounts per hour — wait for the next hour and try again. If you see \u201cYour account is suspended\u201d, reach out through the Discord button.",
      },
    ],
  },
];

export default async function FaqPage({ params }: PageProps<"/[locale]/faq">) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl sm:text-4xl">FAQ</h1>
        <p className="mt-2 max-w-2xl text-muted-ink">
          How the platform works end to end — wallets, transactions, fees, token launches, signal
          algos, subscriptions and the ecosystem around them.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.title} className="card overflow-hidden">
          <div className="chrome">
            <span className="chrome-dots">
              <span />
              <span />
              <span />
            </span>
            <span className="text-muted-ink">{section.title}</span>
          </div>
          <div className="divide-y divide-black/10 px-5 sm:px-6">
            {section.items.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span className="mt-0.5 text-lg leading-none font-bold text-muted-ink transition-transform group-open:rotate-45 group-open:text-accent">
                    +
                  </span>
                </summary>
                <div className="mt-2 pr-8 text-sm leading-relaxed text-muted-ink">{item.a}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
