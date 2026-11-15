// Token Launch Radar — value model, board selection and farm plans.
//
// Pure functions of the sealed snapshot. No network, no clock, no
// randomness: the same snapshot bytes always produce the same board.
//
// The model (see NOTES.md for the reasoning):
//   implied = round(tvl_usd * peer_multiple * growth_factor * tenure_factor)
//   peer_multiple: median mcap/tvl of the token-bearing protocols in the
//     same category (>= 2 listed peers, else the global median), clamped
//     to [0.02, 2.0]
//   growth_factor: 1 + clamp(change_7d, -40, +100) / 200  (missing -> 0)
//   tenure_factor: 1 + 0.03 * min(years since listed_at, 5) (missing -> 1)

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ScoredProtocol {
  protocol: SnapshotProtocol;
  implied_value_usd: number;
  multiple: number;
  growth_factor: number;
  tenure_factor: number;
  years_no_token: number;
  watchlist: boolean;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  multiple: number;
  growth_factor: number;
  tenure_factor: number;
  years_no_token: number;
  watchlist: boolean;
  pre_token: boolean;
}

export const BOARD_TARGET_ROWS = 200;
export const MULTIPLE_MIN = 0.02;
export const MULTIPLE_MAX = 2.0;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Median mcap/tvl of the token-bearing protocols, per category and global. */
export function peerMultiples(protocols: SnapshotProtocol[]): {
  byCategory: Map<string, number>;
  global: number;
} {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.gecko_id === null && p.symbol === null) continue;
    if (!p.mcap_usd || !p.tvl_usd || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const global = median(all);
  const out = new Map<string, number>();
  for (const [cat, ratios] of byCategory) {
    if (ratios.length >= 2) out.set(cat, median(ratios));
  }
  return { byCategory: out, global };
}

function multipleFor(
  category: string | null,
  multiples: { byCategory: Map<string, number>; global: number },
): number {
  let m = multiples.global;
  if (category !== null) {
    const cat = multiples.byCategory.get(category);
    if (cat !== undefined) m = cat;
  }
  return clamp(m, MULTIPLE_MIN, MULTIPLE_MAX);
}

/** Whole years between a YYYY-MM-DD day and the snapshot's as_of day. */
export function yearsSince(asOf: string, listedAt: string | null): number {
  if (listedAt === null) return 0;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return (end - start) / 86400000 / 365.25;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  multiples: { byCategory: Map<string, number>; global: number },
  asOf: string,
): ScoredProtocol {
  const multiple = multipleFor(p.category, multiples);
  const change = p.change_7d === null ? 0 : p.change_7d;
  const growth = 1 + clamp(change, -40, 100) / 200;
  const years = yearsSince(asOf, p.listed_at);
  const tenure = 1 + 0.03 * Math.min(years, 5);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * tenure));
  return {
    protocol: p,
    implied_value_usd: implied,
    multiple,
    growth_factor: growth,
    tenure_factor: tenure,
    years_no_token: years,
    watchlist: false,
  };
}

// ---------------------------------------------------------------------------
// Board selection
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES = new Set(["CEX"]);
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Light exclusion filter for below-floor rows: the house watchlist rule
 * minus the parentProtocol check (which the snapshot does not carry).
 * Left out: CEXs, versioned forks, wrapped/staked products, and anything
 * named after an exchange. Bridge and liquid-staking protocols below the
 * floor are kept: small standalone protocols whose own governance token
 * is still to come.
 */
export function passesLightFilter(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

function byValue(a: ScoredProtocol, b: ScoredProtocol): number {
  if (b.implied_value_usd !== a.implied_value_usd) {
    return b.implied_value_usd - a.implied_value_usd;
  }
  if (b.protocol.tvl_usd !== a.protocol.tvl_usd) {
    return b.protocol.tvl_usd - a.protocol.tvl_usd;
  }
  return a.protocol.slug < b.protocol.slug
    ? -1
    : a.protocol.slug > b.protocol.slug
      ? 1
      : 0;
}

/**
 * The board: every watchlist slug, plus the most valuable below-floor
 * pre-token protocols that pass the light filter, all ranked by implied
 * value. Deterministic: the sort order is total.
 */
export function selectBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = peerMultiples(snapshot.protocols);
  const watchSet = new Set(snapshot.watchlist);
  const pre = snapshot.protocols.filter(isPreToken);
  const scored = pre.map((p) => {
    const s = scoreProtocol(p, multiples, snapshot.as_of);
    s.watchlist = watchSet.has(p.slug);
    return s;
  });
  const watchRows = scored.filter((s) => s.watchlist);
  const missing = snapshot.watchlist.filter(
    (slug) => !watchRows.some((s) => s.protocol.slug === slug),
  );
  if (missing.length > 0) {
    throw new Error(`watchlist slugs missing from snapshot: ${missing.join(", ")}`);
  }
  const extras = scored
    .filter(
      (s) =>
        !s.watchlist &&
        s.protocol.tvl_usd < snapshot.floor_usd &&
        passesLightFilter(s.protocol),
    )
    .sort(byValue)
    .slice(0, BOARD_TARGET_ROWS - watchRows.length);
  const all = [...watchRows, ...extras].sort(byValue);
  return all.map((s, i) => ({
    slug: s.protocol.slug,
    name: s.protocol.name,
    rank: i + 1,
    implied_value_usd: s.implied_value_usd,
    farm_steps: farmStepsFor(s.protocol),
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    listed_at: s.protocol.listed_at,
    multiple: s.multiple,
    growth_factor: s.growth_factor,
    tenure_factor: s.tenure_factor,
    years_no_token: s.years_no_token,
    watchlist: s.watchlist,
    pre_token: true,
  }));
}

// ---------------------------------------------------------------------------
// Farm steps
// ---------------------------------------------------------------------------

function gasNote(chain: string | null): string {
  if (chain === "Ethereum") {
    return "on Ethereum, budget $20–$60 of gas per action at busy times";
  }
  if (chain === "Solana") {
    return "on Solana, each action costs well under $0.10 in fees";
  }
  if (chain === null) {
    return "budget a few dollars of gas per action";
  }
  return `on ${chain}, each action usually costs $0.20–$2 in gas`;
}

function primaryChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 0 ? p.chains[0] : null;
}

function chainLabel(p: SnapshotProtocol): string {
  const c = primaryChain(p);
  return c === null ? "the protocol's chain" : c;
}

type Template = (name: string, chain: string, gas: string) => string[];

function fill(lines: string[], name: string, chain: string, gas: string): string[] {
  return lines.map((l) =>
    l.replaceAll("{name}", name).replaceAll("{chain}", chain).replaceAll("{gas}", gas),
  );
}

const GENERIC: Template = (name, chain, gas) => fill(
  [
    "Open {name} on {chain} and connect a wallet you control. Bridge in $100–$500 of stablecoins to start; {gas}.",
    "Use {name} once end to end — the main action on its front page — with a small amount first, so you learn the flow and confirm the transaction lands.",
    "Scale up to your full position only after the test transaction confirms, and keep the position open: most farmable activity rewards time in the protocol, not one visit.",
    "Come back once a week for at least 8 to 12 weeks. Repeat the core action, keep your receipts, and note the dates — airdrop checks usually look for repeated use over months.",
    "Watch {name}'s announcements and docs for a points program or token plan. If points exist, check your balance weekly; if they do not, your on-chain history is the record.",
    "Total cost is gas plus whatever you deposit, and the deposit can fall in value. {name} records no token, so none of this guarantees an airdrop — farm only money you can afford to leave in place.",
  ],
  name, chain, gas,
);

const TEMPLATES: Record<string, Template> = {
  Dexs: (name, chain, gas) => fill(
    [
      "Open {name} on {chain} and connect a wallet. Bridge in $100–$500; {gas}.",
      "Swap a small amount through {name} — for example $25 of a stablecoin into the chain's native token — to confirm routing and pricing work.",
      "Provide liquidity to one pool with $50–$200 split across the pair, and hold the LP position. Note the pool's fee tier and your entry price.",
      "Return once a week for 8 to 12 weeks: make one swap, and add or rebalance a little liquidity each visit so your address shows repeated use.",
      "Watch {name}'s docs for a points program or fee-share plan, and keep a note of every transaction hash and date.",
      "Costs are gas plus swap slippage and impermanent loss on the LP leg, which can exceed any fee you earn. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  Lending: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500 of stablecoins; {gas}.",
      "Supply $50–$200 to one lending market and confirm the deposit receipt and the supply rate shown.",
      "Borrow a small amount — under 40% of your supplied collateral — against the deposit, then repay part of it, so you use both sides of the market.",
      "Hold the supply position and repeat a borrow-and-repay cycle once a week for 8 to 12 weeks, keeping your health factor comfortably above liquidation.",
      "Watch {name} for a points program; record each supply, borrow and repay with its date and hash.",
      "Costs are gas plus borrow interest; the main risk is liquidation if collateral falls, so keep the loan small. {name} records no token, so farm for the position, not a promised airdrop.",
    ],
    name, chain, gas,
  ),
  Yield: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Deposit $50–$200 into one vault or strategy and confirm the receipt, the strategy's assets, and its stated yield.",
      "Leave the deposit working and add a little more on your second visit, so the vault sees a growing, repeat depositor rather than a single deposit.",
      "Check the vault once a week for 8 to 12 weeks and top up or compound when the strategy allows it; note each action's date.",
      "Watch {name}'s announcements for a points program or token plan, and keep your deposit receipts.",
      "Costs are gas plus the vault's fees and the strategy's own risk — a vault can lose money. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Yield Aggregator": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Deposit $50–$200 into one vault or strategy and confirm the receipt, the strategy's assets, and its stated yield.",
      "Leave the deposit working and add a little more on your second visit, so the vault sees a growing, repeat depositor rather than a single deposit.",
      "Check the vault once a week for 8 to 12 weeks and top up or compound when the strategy allows it; note each action's date.",
      "Watch {name}'s announcements for a points program or token plan, and keep your deposit receipts.",
      "Costs are gas plus the vault's fees and the strategy's own risk — a vault can lose money. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  Derivatives: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$300 of collateral; {gas}.",
      "Open one small perpetual position — $20–$50 notional at low leverage (2x or less) — and close it the same day to learn the flow.",
      "Trade small size once a week for 8 to 12 weeks, alternating long and short, keeping total exposure under $200 and leverage low.",
      "Pay attention to funding costs and keep a written log of every trade: size, side, entry and exit prices.",
      "Watch {name} for a points or volume program; your trading history is the record if one appears.",
      "Costs are gas plus funding and trading losses — perps can wipe a position fast at high leverage, so stay small. {name} records no token, so nothing here guarantees a launch.",
    ],
    name, chain, gas,
  ),
  RWA: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Buy or mint $50–$200 of {name}'s tokenized asset and confirm the receipt, the underlying asset, and any yield terms.",
      "Hold the position and add a little on your second visit; real-world-asset positions reward holders, not flippers.",
      "Check the position once a week for 8 to 12 weeks and note any yield paid, redemption windows, and announcements.",
      "Watch {name} for a points program or governance-token plan, and keep every purchase receipt.",
      "Costs are gas plus the asset's spread and fees; the underlying asset carries its own risk. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  CDP: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500 of collateral; {gas}.",
      "Lock $50–$200 of collateral and mint a small amount of the stablecoin — under 40% of the collateral value — confirming the ratio shown.",
      "Hold the vault open and adjust it once a week for 8 to 12 weeks: top up collateral or repay a little, keeping the ratio comfortably above liquidation.",
      "Use the minted stablecoin somewhere productive — a lending market or a swap — rather than letting it sit idle.",
      "Watch {name} for a points program; record each mint, repay and top-up with its date and hash.",
      "Costs are gas plus stability fees; the risk is liquidation if collateral falls, so keep the ratio high. {name} records no token, so farm for the position, not a promised airdrop.",
    ],
    name, chain, gas,
  ),
  "Basis Trading": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Deposit $50–$200 into the basis strategy and confirm the receipt, the strategy's assets, and its stated yield.",
      "Leave the deposit working and add a little on your second visit, so the strategy sees a repeat depositor.",
      "Check the position once a week for 8 to 12 weeks and note the yield paid and any strategy changes.",
      "Watch {name}'s announcements for a points program or token plan, and keep your deposit receipts.",
      "Costs are gas plus strategy fees; basis trades can lose money when funding flips. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Risk Curators": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Allocate $50–$200 to one curated vault and confirm the receipt, the curator, the underlying markets, and the fee.",
      "Leave the allocation working and add a little on your second visit, so the vault sees a growing, repeat allocator.",
      "Review the vault once a week for 8 to 12 weeks: check the curator's changes, the yield, and any rebalancing.",
      "Watch {name} for a points program or token plan, and keep a note of every allocation and its date.",
      "Costs are gas plus curator and protocol fees, and the underlying markets carry their own risk. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Onchain Capital Allocator": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Allocate $50–$200 to one curated vault and confirm the receipt, the curator, the underlying markets, and the fee.",
      "Leave the allocation working and add a little on your second visit, so the vault sees a growing, repeat allocator.",
      "Review the vault once a week for 8 to 12 weeks: check the curator's changes, the yield, and any rebalancing.",
      "Watch {name} for a points program or token plan, and keep a note of every allocation and its date.",
      "Costs are gas plus curator and protocol fees, and the underlying markets carry their own risk. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Liquidity Manager": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Deposit $50–$200 into one managed liquidity position and confirm the receipt, the pool, and the fee tier.",
      "Leave the position working and add a little on your second visit; managed positions reward time in the pool.",
      "Check the position once a week for 8 to 12 weeks and note rebalances, fees earned, and any announcements.",
      "Watch {name} for a points program; keep every deposit receipt and date.",
      "Costs are gas plus management fees and impermanent loss, which can exceed fees earned. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  Bridge: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and hold $100–$500 to bridge; {gas}.",
      "Bridge $25–$50 to another chain {name} supports and confirm the arrival, the fee, and the time it took.",
      "Bridge back, or onward to a third chain, once a week for 8 to 12 weeks, varying the routes and amounts a little each time.",
      "Keep a log of every bridge: from-chain, to-chain, amount, fee, and date — volume and repetition are what bridge programs usually count.",
      "Watch {name} for a points program; your bridge history is the record if one appears.",
      "Costs are gas on both chains plus the bridge fee; a bridge can delay or, rarely, fail, so start small. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Canonical Bridge": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and hold $100–$500 to bridge; {gas}.",
      "Bridge $25–$50 to another chain {name} supports and confirm the arrival, the fee, and the time it took.",
      "Bridge back, or onward to a third chain, once a week for 8 to 12 weeks, varying the routes and amounts a little each time.",
      "Keep a log of every bridge: from-chain, to-chain, amount, fee, and date — volume and repetition are what bridge programs usually count.",
      "Watch {name} for a points program; your bridge history is the record if one appears.",
      "Costs are gas on both chains plus the bridge fee; a bridge can delay or, rarely, fail, so start small. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Liquid Staking": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Stake $50–$200 and confirm you received the liquid staking receipt token, its exchange rate, and the stated yield.",
      "Hold the receipt token — use it in a lending market or hold it in your wallet — and add a little more on your second visit.",
      "Check the position once a week for 8 to 12 weeks and note the yield accrued and any restaking options.",
      "Watch {name} for a points program; keep every stake receipt and date.",
      "Costs are gas plus the protocol's fee; the receipt token can depeg and the underlying stake carries slashing risk. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Liquid Restaking": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Stake $50–$200 and confirm you received the liquid staking receipt token, its exchange rate, and the stated yield.",
      "Hold the receipt token — use it in a lending market or hold it in your wallet — and add a little more on your second visit.",
      "Check the position once a week for 8 to 12 weeks and note the yield accrued and any restaking options.",
      "Watch {name} for a points program; keep every stake receipt and date.",
      "Costs are gas plus the protocol's fee; the receipt token can depeg and the underlying stake carries slashing risk. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  Restaking: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Stake $50–$200 and confirm you received the liquid staking receipt token, its exchange rate, and the stated yield.",
      "Hold the receipt token — use it in a lending market or hold it in your wallet — and add a little more on your second visit.",
      "Check the position once a week for 8 to 12 weeks and note the yield accrued and any restaking options.",
      "Watch {name} for a points program; keep every stake receipt and date.",
      "Costs are gas plus the protocol's fee; the receipt token can depeg and the underlying stake carries slashing risk. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
  "Prediction Market": (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$300; {gas}.",
      "Buy $10–$25 of shares in one market you understand, and confirm the receipt and the price you paid.",
      "Trade small size once a week for 8 to 12 weeks across different markets, keeping total exposure under $200.",
      "Keep a written log of every market, side, size, and outcome — a history of varied participation is what counts.",
      "Watch {name} for a points program; your trading history is the record if one appears.",
      "Costs are gas plus losing trades — prediction markets are zero-sum, so expect to lose some positions. {name} records no token, so nothing here guarantees a launch.",
    ],
    name, chain, gas,
  ),
  Chain: (name, chain, gas) => fill(
    [
      "Open {name} on {chain}, connect a wallet, and bridge in $100–$500; {gas}.",
      "Make your first transactions on the chain — a swap, a transfer, a small contract interaction — and confirm they land.",
      "Use the chain once a week for 8 to 12 weeks: transact, try its apps, and keep a little balance active.",
      "Try at least three different apps on the chain so your address shows breadth, not a single transaction.",
      "Watch {name}'s announcements for a points, testnet or mainnet program, and keep your transaction history.",
      "Costs are gas on the chain plus anything you deploy or swap; the chain's apps carry their own risks. {name} records no token, so a launch is possible, never promised.",
    ],
    name, chain, gas,
  ),
};

/** Six concrete farm steps for a protocol, from its category's template. */
export function farmStepsFor(p: SnapshotProtocol): string[] {
  const chain = chainLabel(p);
  const gas = gasNote(primaryChain(p));
  const template =
    p.category !== null && p.category in TEMPLATES
      ? TEMPLATES[p.category]
      : GENERIC;
  const steps = template(p.name, chain, gas);
  for (const step of steps) {
    const trimmed = step.trim();
    if (trimmed.length < 20 || trimmed.length > 600) {
      throw new Error(
        `farm step out of bounds (${trimmed.length} chars) for ${p.slug}: ${trimmed.slice(0, 80)}`,
      );
    }
  }
  return steps;
}
