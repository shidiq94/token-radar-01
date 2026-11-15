# Token Launch Radar — Notes

Entry for make.fun `token-radar-01`: rank DefiLlama protocols that record no
token by what their launch would be worth, and show a reader how to farm each
one. The program (`main.ts`, Node 22, standard library only) reads the sealed
snapshot at `/input/snapshot.json` and writes `/output/board.json`,
`/output/dashboard/` (with `data.js`), `/output/screenshots/` and
`/output/dossier.json`. It runs with no network, and two runs write the same
bytes.

## What the snapshot holds

758 protocols at or above $5,000,000 of TVL, fetched once from DefiLlama's
public API (`as_of` 2026-11-14). Each protocol carries ten fields: `slug`,
`name`, `category`, `chains`, `tvl_usd`, `change_7d`, `mcap_usd`,
`listed_at`, `gecko_id`, `symbol`. 342 protocols record no token (both
`gecko_id` and `symbol` are null). The house watchlist names 40 of them:
TVL at or above the $50,000,000 floor, no token recorded, and not a wrapped,
staked or bridged product of a token that already trades.

The snapshot says a protocol *records* no token, never that it *has* none:
a protocol on the list may still have a token its DefiLlama record does not
carry. This entry uses the same language everywhere: "records no token".

## The board: 200 rows

- All 40 watchlist slugs (the gate requires full coverage).
- Plus the 160 most valuable below-floor protocols: TVL under $50,000,000,
  no token recorded, passing the light exclusion filter below, ranked by the
  same implied value as the watchlist rows.
- The board is pre-token only. Protocols whose token already trades never
  appear as rows: they are the valuation comps, not the subjects. The
  dashboard says so, and shows the peer multiples they imply.

Light exclusion filter for below-floor rows (the house watchlist rule,
minus the `parentProtocol` check, which the snapshot does not carry):
a protocol is left out when its category is `CEX`, when its name ends in a
version marker (`V2`, `v2`, `2.0` and the like), when its name carries a
whole word `wrapped`, `staked` or `staking`, or when its name begins with
an exchange's name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX,
Bitfinex, Gemini). Bridge, Canonical Bridge, Liquid Staking, Liquid
Restaking and Restaked BTC protocols below the floor are KEPT: unlike the
watchlist's $50M+ giants, these are small standalone protocols whose own
governance token is still to come, and a bridge or liquid-staking token is
a real launch shape. CEXs are out throughout: an exchange token is not
something a reader farms on the protocol.

The 20 above-floor protocols the house left off the watchlist (for
example the curator vaults and sub-products whose parent protocol
DefiLlama records) are left off this board too: the extras are early,
below-floor protocols only, the ones the radar exists to find.

## The value model

Implied value is computed from the snapshot's own figures only — no
hardcoded list of names, no outside data:

```
implied_value_usd = round(tvl_usd x peer_multiple x growth_factor x tenure_factor)
```

- `peer_multiple`: the median `mcap_usd / tvl_usd` of the token-bearing
  protocols in the same category, computed from this snapshot. A category
  needs at least 2 listed peers, otherwise the multiple is the global
  median across all listed protocols (0.2138 here). The multiple is
  clamped to [0.02, 2.0] so a single thin peer cannot set an absurd
  price (one category's lone peer implies a multiple above 400; the clamp
  keeps the board honest).
- `growth_factor`: `1 + clamp(change_7d, -40, +100) / 200`, so a protocol
  whose TVL grew 100% in seven days is worth 1.5x its base, one that fell
  40% is worth 0.8x. A missing `change_7d` counts as 0.
- `tenure_factor`: `1 + 0.03 x min(years since listed_at, 5)`, up to
  1.15. A protocol that has run for years, grown large, and still records
  no token carries the most pent-up launch value. A missing `listed_at`
  counts as 1.0 (no premium, no penalty).

Rows are ranked by implied value, highest first; ties break by TVL, then
by slug, so the order is total and the two grading runs agree byte for
byte. The top of this snapshot's board is about $608M of implied value;
the median row is about $5.2M; the smallest about $0.2M. The model is
deliberately conservative: the peer multiple is a median, not a mean,
and every factor is capped.

What the model does NOT do: it does not predict whether or when a token
is issued. The implied value answers "what would the token be worth if
the protocol's record stayed as it is". A protocol can sit high on this
board for years and never launch — the farm steps say so, and the
dashboard says so.

## Farm steps

Every row carries 6 steps (the gate allows 3 to 12, each 20 to 600
characters). Steps are generated from templates keyed by the protocol's
category, filled with the protocol's own name and primary chain — never
copied from a list of names. Each plan names concrete actions, a budget,
and a cadence:

1. Set up on the primary chain (wallet, gas, bridge in).
2. The category's core action (swap, supply, deposit, mint, stake...).
3. The second leg (provide liquidity, borrow, loop, hold...).
4. Position sizing and how often to touch it (weekly is the default).
5. What to track (points, announcements, on-chain receipts).
6. Costs, time, and what can go wrong (including "no token may ever
   come").

Steps never promise an airdrop. They say what to do, what it costs, and
how long it takes.

## The dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css`,
`app.js` and `data.js` (the board, one row per line, so the dossier
shows the first rows whole). It sorts by any column, filters by text,
category, chain and watchlist membership, and opens a detail view for
every protocol showing the model's arithmetic (TVL x multiple x growth
x tenure = implied value) and its farm plan. The palette is dark navy
with an amber accent; type is a system stack, no web fonts, no external
links or images anywhere.

## Files

- `main.ts` — entrypoint: reads the snapshot, scores, writes the board,
  the dashboard data, copies `dashboard/` and `screenshots/`, writes the
  dossier with `buildDossier` from `vendor/makefun-board.ts`.
- `lib/model.ts` — the value model, the board selection, the farm-step
  templates. Pure functions of the snapshot; no network, no clock, no
  randomness.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
  from the kit (the scorer's own copy).
- `dashboard/` — the static page source.
- `screenshots/` — 1-board.png (the board), 2-detail.png (a protocol's
  detail view), 3-filtered.png (a filtered view), each 1440x900.
- `LICENSE` — MIT. `.makefun/owner.json` is added at submit time by the
  parent (the claim file naming the account's wallet).

## Verification (this session)

- `node main.ts --input <snapshot> ` with `MAKEFUN_OUTPUT_DIR=out`
  writes `board.json` (200 rows, all 40 watchlist slugs, ranks 1..200,
  implied values non-increasing), `dashboard/data.js`,
  `screenshots/` and `dossier.json`.
- Two runs into two directories are byte-identical.
- A local gate script replays the seven sealed-gate rows (dashboard
  files, board file, sorted-by-value, coverage, farm steps, screenshots,
  dossier matches) before submit.
