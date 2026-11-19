// Token Radar, model radar-3.
//
// The board ranks the pre-token protocols of the sealed snapshot by the
// implied value of a launch that has not happened yet. The value model is
// a size curve fitted on the live-token protocols, plus a shrunk category
// offset: big protocols trade at far lower market-cap-to-TVL ratios than
// small ones, and a flat multiple ignores that. Every number on the board
// is derived from the snapshot itself. The intercept and slope are the
// least-squares fit of log market cap on log TVL over the live-token
// protocols with a positive market cap and a positive TVL; the category
// offsets are shrunk averages of the fit residuals in each category. The
// farm plan on each row is computed from that row's own chains, TVL, age
// and seven-day change, with a cost and time rollup and a farm, thin or
// skip verdict. No protocol name is special-cased anywhere; one function
// scores every row.

export const MODEL_VERSION = 'radar-3';

/** How many live-token rows the dashboard shows on its live tab. */
export const LIVE_ROWS_SHOWN = 24;

/** The fixed constants of the model: the shrinkage prior, the reference
 * size the multiples table is quoted at, the gas planning tiers, the
 * capital tiers, the hold rules, the active-minute allowances and the
 * verdict thresholds. The intercept and slope are fitted from the
 * snapshot at run time, so they live on the dashboard data, not here. */
export const MODEL = {
  shrinkagePrior: 8,
  referenceTvlUsd: 100_000_000,
  gasTiers: [
    { match: ['ethereum'], low: 6, high: 12, mid: 9 },
    { match: ['solana'], low: 0.05, high: 0.05, mid: 0.05 },
    { match: ['bitcoin'], low: 3, high: 8, mid: 5 },
    { match: ['base', 'arbitrum', 'optimism', 'polygon', 'blast'], low: 0.5, high: 2, mid: 1 },
  ],
  gasOther: { low: 1, high: 3, mid: 2 },
  capitalTiers: [
    { minTvlUsd: 5_000_000_000, usd: 250 },
    { minTvlUsd: 1_000_000_000, usd: 150 },
    { minTvlUsd: 100_000_000, usd: 100 },
    { minTvlUsd: 10_000_000, usd: 50 },
    { minTvlUsd: 0, usd: 25 },
  ],
  holdYoungCutoffDays: 180,
  holdOldCutoffDays: 365,
  holdYoungDays: 60,
  holdMidDays: 45,
  holdOldDays: 30,
  holdUnknownDays: 30,
  minutesSetup: 15,
  minutesSecondPosition: 15,
  minutesWeekly: 10,
  minutesClaim: 10,
  minutesLog: 5,
  verdictFarmMaxRatio: 10,
  verdictThinMaxRatio: 25,
  verdictFarmMaxMinutes: 180,
  verdictThinMaxMinutes: 480,
};

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

export interface FarmPlan {
  steps: string[];
  spentUsd: number;
  capitalUsd: number;
  activeMinutes: number;
  calendarDays: number;
  breakEvenUsd: number;
  costRatio: number;
  verdict: 'farm' | 'thin' | 'skip';
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  size_curve_value_usd: number;
  category_factor: number;
  verdict: 'farm' | 'thin' | 'skip';
  cost_ratio: number;
  farm_steps: string[];
}

export interface CategoryMultiple {
  category: string;
  live_count: number;
  offset: number;
  multiple: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: {
    intercept: number;
    slope: number;
    shrinkage_prior: number;
    reference_tvl_usd: number;
    gas_tiers: { match: string[]; low: number; high: number; mid: number }[];
    gas_other: { low: number; high: number; mid: number };
    capital_tiers: { min_tvl_usd: number; usd: number }[];
    hold_young_cutoff_days: number;
    hold_old_cutoff_days: number;
    hold_young_days: number;
    hold_mid_days: number;
    hold_old_days: number;
    hold_unknown_days: number;
    minutes_setup: number;
    minutes_second_position: number;
    minutes_weekly: number;
    minutes_claim: number;
    minutes_log: number;
    verdict_farm_max_ratio: number;
    verdict_thin_max_ratio: number;
    verdict_farm_max_minutes: number;
    verdict_thin_max_minutes: number;
  };
  model_version: string;
  global_multiple: number;
  category_multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  no_cap_size: number;
  set_aside_size: number;
  rows: Omit<BoardRow, 'farm_steps'>[];
  live: {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    mcap_usd: number;
    change_7d: number | null;
  }[];
  no_cap: {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
  }[];
}

/** Parse the snapshot text, refusing anything that is not the sealed
 * shape: it must carry the as-of date, the source string, a positive
 * whole-dollar floor, a protocols array and a watchlist of slugs, and
 * every protocol must carry a slug, a name and a finite TVL. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('token radar: the snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('token radar: the snapshot must be a JSON object');
  }
  const snap = raw as Record<string, unknown>;
  if (typeof snap.as_of !== 'string' || snap.as_of.length === 0) {
    throw new Error('token radar: the snapshot carries no as-of date');
  }
  if (typeof snap.source !== 'string' || snap.source.length === 0) {
    throw new Error('token radar: the snapshot carries no source string');
  }
  if (typeof snap.floor_usd !== 'number' || !Number.isInteger(snap.floor_usd) || snap.floor_usd <= 0) {
    throw new Error('token radar: the snapshot carries no positive whole-dollar floor');
  }
  if (!Array.isArray(snap.protocols)) {
    throw new Error('token radar: the snapshot carries no protocols array');
  }
  if (!Array.isArray(snap.watchlist) || !snap.watchlist.every((s) => typeof s === 'string')) {
    throw new Error('token radar: the snapshot carries no watchlist of slugs');
  }
  for (const p of snap.protocols as Record<string, unknown>[]) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      throw new Error('token radar: a protocol entry is not an object');
    }
    if (typeof p.slug !== 'string' || p.slug.length === 0) {
      throw new Error('token radar: a protocol carries no slug');
    }
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new Error('token radar: a protocol carries no name');
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`token radar: protocol ${p.slug} carries no finite TVL`);
    }
  }
  return snap as unknown as Snapshot;
}

/** The live-token protocols that can teach the model anything: a
 * recorded market cap above zero and a TVL above zero. A market cap of
 * exactly zero carries no value signal, and a negative one is a data
 * quirk, since a market cap cannot be negative. */
function trainingSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** The least-squares fit of log market cap on log TVL over the training
 * set: the size curve the whole board hangs on. Returns the intercept
 * and the slope. */
function fitSizeCurve(training: SnapshotProtocol[]): { intercept: number; slope: number } {
  const n = training.length;
  let sumX = 0;
  let sumY = 0;
  for (const p of training) {
    sumX += Math.log(p.tvl_usd);
    sumY += Math.log(p.mcap_usd as number);
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of training) {
    const dx = Math.log(p.tvl_usd) - meanX;
    sxx += dx * dx;
    sxy += dx * (Math.log(p.mcap_usd as number) - meanY);
  }
  const slope = sxy / sxx;
  return { intercept: meanY - slope * meanX, slope };
}

/** The shrunk category offsets. For each live-token protocol in a
 * category, the difference between its log market cap and the size
 * curve at its log TVL; averaged over the category's live protocols,
 * then shrunk toward zero by n / (n + prior). A category with no
 * live-token protocols gets an offset of zero. */
function categoryOffsets(
  training: SnapshotProtocol[],
  fit: { intercept: number; slope: number },
): Map<string, { offset: number; liveCount: number }> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const p of training) {
    const diff = Math.log(p.mcap_usd as number) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const key = p.category ?? 'Other';
    const entry = sums.get(key) ?? { total: 0, count: 0 };
    entry.total += diff;
    entry.count += 1;
    sums.set(key, entry);
  }
  const out = new Map<string, { offset: number; liveCount: number }>();
  for (const [key, entry] of sums) {
    const average = entry.total / entry.count;
    out.set(key, {
      offset: (average * entry.count) / (entry.count + MODEL.shrinkagePrior),
      liveCount: entry.count,
    });
  }
  return out;
}

/** The multiple a category's formula gives at the reference size: the
 * implied value of a protocol of that category with the reference TVL,
 * divided by the reference TVL. A display convention only; it never
 * enters the ranking. */
function multipleAtReference(
  fit: { intercept: number; slope: number },
  offset: number,
): number {
  const value = Math.exp(fit.intercept + fit.slope * Math.log(MODEL.referenceTvlUsd) + offset);
  return value / MODEL.referenceTvlUsd;
}

/** A protocol records a token when DefiLlama carries either a CoinGecko
 * id or a symbol for it. */
function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Categories whose protocols are not launches waiting to happen: the
 * wrapped, staked, bridged and exchange products. */
const SET_ASIDE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a pre-token protocol is set aside from the ranking, or null when
 * it is rankable: a versioned name, a wrapped, staked or bridged
 * product, an exchange product, or a set-aside category. */
function setAsideReason(p: SnapshotProtocol): string | null {
  if (VERSION_SUFFIX.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_NAMES.some((name) => p.name.startsWith(name))) return 'exchange product';
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return 'set-aside category';
  return null;
}

/** A protocol is rankable when it records no token and nothing sets it
 * aside. */
function rankable(p: SnapshotProtocol): boolean {
  return !recordsToken(p) && setAsideReason(p) === null;
}

/** Days since the protocol was first listed, counted from the
 * snapshot's as-of date, or null when no listing date is recorded. */
function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = (Date.parse(asOf) - Date.parse(p.listed_at)) / 86_400_000;
  return Math.floor(days);
}

/** The gas tier a chain name falls in: Ethereum, Solana, Bitcoin, the
 * cheap layer twos, and everything else. The tiers are planning
 * estimates per transaction, never live prices: the snapshot is frozen
 * and the program runs with no network. */
function gasTier(chain: string): { low: number; high: number; mid: number } {
  const lower = chain.toLowerCase();
  for (const tier of MODEL.gasTiers) {
    if (tier.match.some((piece) => lower.includes(piece))) return tier;
  }
  return MODEL.gasOther;
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function gasRange(tier: { low: number; high: number; mid: number }): string {
  const fmt = (v: number): string => (v < 1 ? `$${v.toFixed(2)}` : `$${v}`);
  return tier.low === tier.high ? `about ${fmt(tier.low)}` : `about ${fmt(tier.low)} to ${fmt(tier.high)}`;
}

/** The protocol's chains ranked cheapest first by gas midpoint. Ties
 * keep the order the snapshot lists them in, so the ranking is stable
 * from run to run. */
function rankedChains(p: SnapshotProtocol): { chain: string; tier: { low: number; high: number; mid: number } }[] {
  const seen = [...new Set(p.chains)];
  return seen
    .map((chain) => ({ chain, tier: gasTier(chain) }))
    .sort((a, b) => a.tier.mid - b.tier.mid);
}

/** Capital committed to one position, from the protocol's own TVL. */
function capitalFor(tvlUsd: number): number {
  for (const tier of MODEL.capitalTiers) {
    if (tvlUsd >= tier.minTvlUsd) return tier.usd;
  }
  return 25;
}

/** Hold days, from the protocol's age in days since first listing. */
function holdFor(age: number | null): number {
  if (age === null) return MODEL.holdUnknownDays;
  if (age < MODEL.holdYoungCutoffDays) return MODEL.holdYoungDays;
  if (age < MODEL.holdOldCutoffDays) return MODEL.holdMidDays;
  return MODEL.holdOldDays;
}

/** The family a category's farm mechanics follow. Categories the design
 * does not list fall through to the fallback. */
function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c === 'dexs') return 'dex';
  if (c.includes('yield') || c.includes('leveraged')) return 'yield';
  if (c.includes('perpetual') || c.includes('derivative')) return 'derivatives';
  if (c === 'rwa') return 'rwa';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restaking')) return 'staking';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return 'curator';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment')) return 'payments';
  if (c.includes('farm')) return 'farm';
  return 'fallback';
}

/** The main position: what the farmer does with the capital, in the
 * category's own mechanics, on the named chain. */
function mainAction(family: string, category: string | null, name: string, capital: number, chain: string): string {
  const c = (category ?? '').toLowerCase();
  if (family === 'lending') {
    if (c.includes('cdp') || c.includes('collateral')) {
      return `Deposit $${capital} of collateral with ${name} on ${chain}, borrow a small amount against it, and keep the position open.`;
    }
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (family === 'dex') {
    return `Supply $${capital} as liquidity to ${name}'s main pool on ${chain}, in the pair the pool actually trades, and keep the position open.`;
  }
  if (family === 'yield') {
    if (c.includes('aggregator')) return `Deposit $${capital} into ${name}'s vault on ${chain} and keep the position open.`;
    if (c.includes('leveraged')) return `Deposit $${capital} into ${name}'s farm on ${chain} and keep the position open.`;
    return `Deposit $${capital} into ${name}'s main yield position on ${chain} and keep it open.`;
  }
  if (family === 'derivatives') {
    return `Deposit $${capital} of USDC as margin with ${name} on ${chain} and open one small hedge, sized well below the deposit so a move against it cannot liquidate the position.`;
  }
  if (family === 'rwa') return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  if (family === 'bridge') {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app on that chain.`;
  }
  if (family === 'staking') {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (family === 'prediction') {
    return `Fund $${capital} and place one market position with ${name} on ${chain}, in the market with the most volume the protocol shows.`;
  }
  if (family === 'curator') {
    return `Deposit $${capital} into a vault of ${name} on ${chain} and keep the vault shares.`;
  }
  if (family === 'stable') return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (family === 'insurance') return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (family === 'payments') return `Pay one invoice of $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (family === 'farm') return `Deposit $${capital} into ${name}'s farm on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second action on a single-chain row: a category-appropriate
 * action that is not the main position, done inside a weekly action so
 * it costs no extra transaction. */
function secondAction(family: string, category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (family === 'dex') return 'a small swap through the same pool to register trading activity alongside the liquidity';
  if (family === 'lending') {
    if (c.includes('cdp') || c.includes('collateral')) {
      return 'a small borrow against the deposited collateral, held briefly and repaid, to register borrowing activity';
    }
    return 'a small borrow against the supply, held briefly and repaid, to register borrowing activity';
  }
  if (family === 'derivatives') return 'a second small hedge in the opposite direction, closed within the week';
  if (family === 'yield') return 'a claim and restake of whatever rewards have accrued';
  if (family === 'rwa') return 'a small redemption and re-mint, to register activity without leaving the position';
  if (family === 'bridge') return 'a second small bridge back, to register two-way activity';
  if (family === 'staking') return 'a small additional stake';
  if (family === 'prediction') return 'a second position in a different market, so the activity is not one market alone';
  if (family === 'curator') return 'a deposit into a second vault of the same protocol, so the activity spans more than one allocation';
  if (family === 'stable') return 'a small redemption and re-mint';
  if (family === 'insurance') return 'a second small cover on a different pool';
  if (family === 'payments') return 'a second payment to a different counterparty';
  if (family === 'farm') return 'a harvest and restake of accrued rewards';
  return "a small swap through the protocol's main function, or a vote where the protocol offers one";
}

/** The weekly qualifying action, in the category's own mechanics. */
function weeklyAction(family: string): string {
  if (family === 'dex') return 'swap through the pool, deposit, or claim rewards';
  if (family === 'lending') return 'deposit, borrow, or repay';
  if (family === 'derivatives') return 'trade, deposit, or pay funding';
  if (family === 'yield') return 'deposit, claim rewards, or restake';
  if (family === 'rwa') return 'mint, redeem, or transfer';
  if (family === 'bridge') return 'bridge, swap on the destination chain, or claim';
  if (family === 'staking') return 'stake, request an unstake, or claim rewards';
  if (family === 'prediction') return 'take a market position or settle one';
  if (family === 'curator') return "deposit, request a withdrawal, or vote on the vault's allocation";
  if (family === 'stable') return 'mint, redeem, or transfer';
  if (family === 'insurance') return 'buy cover, check a claim filing, or renew';
  if (family === 'payments') return 'pay, settle, or check a payout';
  if (family === 'farm') return 'deposit, harvest, or restake';
  return 'deposit, swap, or vote';
}

/** The claim vocabulary of the category: what the protocol's own
 * points or rewards page is called. */
function claimNoun(family: string): string {
  if (family === 'dex' || family === 'yield' || family === 'farm' || family === 'staking') return 'rewards';
  if (family === 'curator') return 'vault points';
  return 'points';
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

function growthNote(change7d: number | null): string {
  if (change7d === null) return 'The seven-day growth figure is missing, so enter at the next weekly check.';
  const shown = `${change7d > 0 ? '+' : ''}${change7d.toFixed(2)}%`;
  if (change7d < -20) return `TVL fell ${shown} in seven days: wait one week and re-check the TVL before adding to the position.`;
  if (change7d > 30) return `TVL rose ${shown} in seven days: enter within the week, since momentum is with the position.`;
  return 'Enter at the next weekly check.';
}

/** The eight farm steps for one row, with the cost and time rollup and
 * the verdict. Every step names the protocol, its cheapest chain or its
 * own numbers, so no step can repeat word for word across the board.
 * The main position goes on the cheapest chain by gas midpoint, not on
 * the first chain the snapshot lists. Capital committed is money held
 * in the position, not money spent: the rollup keeps the two apart. */
function buildFarmPlan(input: {
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
}): FarmPlan {
  const family = familyOf(input.category);
  const ranked = rankedChains({ chains: input.chains } as SnapshotProtocol);
  const first = ranked[0] ?? { chain: 'its main chain', tier: MODEL.gasOther };
  const second = ranked[1] ?? null;
  const multiChain = second !== null;
  const capital = capitalFor(input.tvl_usd);
  const hold = holdFor(input.age_days);
  const weeks = Math.ceil(hold / 7);
  const positions = multiChain ? 2 : 1;
  const capitalCommitted = capital * positions;

  // The rollup counts transactions, not words. The main position takes
  // two, an approval and a deposit; a second position takes a setup and
  // an exit; each weekly action takes one; the claim takes one; the main
  // position's exit takes one. A single-chain row's second action rides
  // inside a weekly action, so it takes no transaction of its own.
  const spent =
    2 * first.tier.mid +
    (multiChain && second ? 2 * second.tier.mid : 0) +
    (weeks + 2) * first.tier.mid;
  const minutes =
    MODEL.minutesSetup +
    (multiChain ? MODEL.minutesSecondPosition : 0) +
    weeks * MODEL.minutesWeekly +
    MODEL.minutesClaim +
    MODEL.minutesLog;
  const ratio = spent / (input.implied_value_usd / 1_000_000);

  let verdict: 'farm' | 'thin' | 'skip';
  if (ratio <= MODEL.verdictFarmMaxRatio && minutes <= MODEL.verdictFarmMaxMinutes) {
    verdict = 'farm';
  } else if (
    (ratio > MODEL.verdictFarmMaxRatio && ratio <= MODEL.verdictThinMaxRatio) ||
    (minutes > MODEL.verdictFarmMaxMinutes && minutes <= MODEL.verdictThinMaxMinutes)
  ) {
    verdict = 'thin';
  } else {
    verdict = 'skip';
  }

  const ageSentence =
    input.age_days === null
      ? 'No listing date is recorded for the protocol.'
      : `The protocol has run ${input.age_days} days with no token on record.`;

  const steps: string[] = [];

  steps.push(
    `Set up a fresh wallet for ${input.name} on ${first.chain}` +
      (multiChain && second ? `, and keep ${second.chain} ready as the second chain` : '') +
      `. Fund it from an exchange or another wallet, never from a wallet that holds your main funds. ` +
      `The first transaction on ${first.chain} costs ${gasRange(first.tier)} of gas. ` +
      `Time: 15 minutes to set up the wallet and open the first position.`,
  );

  steps.push(
    `${mainAction(family, input.category, input.name, capital, first.chain)} ` +
      `Cost: $${capital} of capital plus two transactions on ${first.chain}, ${gasRange(first.tier)} of gas each. ` +
      `Time: inside the 15 minutes the wallet setup takes.`,
  );

  if (multiChain && second) {
    steps.push(
      `Open a second position on ${second.chain}, the next-cheapest chain: ` +
        `${lowerFirst(mainAction(family, input.category, input.name, capital, second.chain))} ` +
        `Cost: $${capital} of capital plus two transactions on ${second.chain}, ${gasRange(second.tier)} of gas each. ` +
        `Time: 15 minutes to set up the second position.`,
    );
  } else {
    steps.push(
      `Once, inside a weekly action on ${first.chain}, ${secondAction(family, input.category)}. ` +
        `Cost: no extra gas beyond that week's transaction. Time: inside the weekly 10 minutes.`,
    );
  }

  steps.push(
    `Once a week for ${weeks} weeks, ${weeklyAction(family)} on ${first.chain}. ` +
      `Cost: ${gasRange(first.tier)} of gas for one weekly action. Time: 10 minutes a week.`,
  );

  steps.push(
    `Hold the position for ${hold} days. ${ageSentence} ${growthNote(input.change_7d)} ` +
      `Cost: the ${money(capitalCommitted)} stays in the position. Time: ${hold} calendar days.`,
  );

  steps.push(
    `Open ${input.name}'s own ${claimNoun(family)} page on ${first.chain} and check whether anything is claimable. ` +
      `Claim only from the link that page publishes, and never pay to claim. ` +
      `Cost: no fee to check. Time: 10 minutes to check and claim.`,
  );

  let verdictSentence: string;
  if (verdict === 'farm') {
    verdictSentence = `The cost ratio is ${ratio.toFixed(1)} dollars spent per $1M of implied value, at or below the farm limit of 10, and the plan stays within 180 active minutes.`;
  } else if (verdict === 'thin') {
    if (minutes > MODEL.verdictFarmMaxMinutes) {
      verdictSentence = `The plan runs ${minutes} active minutes, above the 180 the farm verdict allows, so the plan is thin: it only pays if the allocation beats the break-even.`;
    } else {
      verdictSentence = `The cost ratio is ${ratio.toFixed(1)} dollars spent per $1M of implied value, above 10 and at or below 25, so the plan is thin: it only pays if the allocation beats the break-even.`;
    }
  } else if (minutes > MODEL.verdictThinMaxMinutes) {
    verdictSentence = `The plan runs ${minutes} active minutes, above 480, so the plan is skipped: the time costs more than the position is worth chasing.`;
  } else {
    verdictSentence = `The cost ratio is ${ratio.toFixed(1)} dollars spent per $1M of implied value, above 25, so the plan is skipped: the gas costs more than the position is worth chasing.`;
  }
  steps.push(
    `Totals: ${money(spent)} spent on gas and fees, ${money(capitalCommitted)} of capital committed across ${positions} position${positions === 1 ? '' : 's'}, ` +
      `${minutes} active minutes over ${hold} calendar days. Break-even allocation: ${money(spent)}. ` +
      `Verdict: ${verdict}. ${verdictSentence}`,
  );

  steps.push(
    `Log the wallet, ${first.chain}, the ${hold}-day hold and the ${verdict} verdict in the farm log. ` +
      `Unwind on ${first.chain} when the verdict changes or the snapshot moves: withdraw the position, claim anything pending, and record every transaction. ` +
      `Cost: one exit transaction on ${first.chain}, ${gasRange(first.tier)} of gas. Time: 5 minutes to log.`,
  );

  return {
    steps,
    spentUsd: spent,
    capitalUsd: capitalCommitted,
    activeMinutes: minutes,
    calendarDays: hold,
    breakEvenUsd: spent,
    costRatio: ratio,
    verdict,
  };
}

/** The implied value of one protocol: the exponential of the intercept
 * plus the slope times the log of its TVL, plus its category offset,
 * rounded to the nearest whole dollar and never below one dollar. The
 * size-curve value is the same exponential with no category offset, and
 * the category factor is the exponential of the offset, so the implied
 * value is their product rounded. */
function valueOf(
  p: SnapshotProtocol,
  fit: { intercept: number; slope: number },
  offset: number,
): { implied: number; sizeCurve: number; factor: number } {
  const sizeCurve = Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd));
  const factor = Math.exp(offset);
  return { implied: Math.max(1, Math.round(sizeCurve * factor)), sizeCurve, factor };
}

/** The ranked board: every rankable pre-token protocol, strongest
 * implied value first, ranks 1 through N, ties broken by slug
 * ascending. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const training = trainingSet(snapshot);
  const fit = fitSizeCurve(training);
  const offsets = categoryOffsets(training, fit);

  const scored = snapshot.protocols.filter(rankable).map((p) => {
    const entry = offsets.get(p.category ?? 'Other');
    const offset = entry ? entry.offset : 0;
    const value = valueOf(p, fit, offset);
    const age = ageDays(p, snapshot.as_of);
    const plan = buildFarmPlan({
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      implied_value_usd: value.implied,
    });
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: age,
      implied_value_usd: value.implied,
      category_multiple: multipleAtReference(fit, offset),
      size_curve_value_usd: value.sizeCurve,
      category_factor: value.factor,
      verdict: plan.verdict,
      cost_ratio: plan.costRatio,
      farm_steps: plan.steps,
    } as BoardRow;
  });

  scored.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });
  return scored;
}

/** The dashboard data object: the board rows, the live-token rows, the
 * no-cap rows, the multiples table and the model constants. The board
 * may be passed in when it is already built; otherwise it is built
 * here from the snapshot. */
export function buildDashboard(snapshot: Snapshot, board?: BoardRow[]): RadarData {
  const rows = board ?? buildBoard(snapshot);
  const training = trainingSet(snapshot);
  const fit = fitSizeCurve(training);
  const offsets = categoryOffsets(training, fit);
  const global = multipleAtReference(fit, 0);

  const multiples: CategoryMultiple[] = [...offsets.entries()]
    .map(([category, entry]) => ({
      category,
      live_count: entry.liveCount,
      offset: entry.offset,
      multiple: multipleAtReference(fit, entry.offset),
    }))
    .sort((a, b) => b.multiple - a.multiple);

  const watchlist = new Set(snapshot.watchlist);
  const earlySize = rows.filter((r) => !watchlist.has(r.slug)).length;
  const liveSize = snapshot.protocols.filter((p) => p.mcap_usd !== null).length;
  const noCapRows = snapshot.protocols
    .filter((p) => recordsToken(p) && p.mcap_usd === null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
    }));
  const setAsideSize = snapshot.protocols.filter((p) => !recordsToken(p) && !rankable(p)).length;
  const liveRows = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, LIVE_ROWS_SHOWN)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }));

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      intercept: fit.intercept,
      slope: fit.slope,
      shrinkage_prior: MODEL.shrinkagePrior,
      reference_tvl_usd: MODEL.referenceTvlUsd,
      gas_tiers: MODEL.gasTiers.map((t) => ({ match: [...t.match], low: t.low, high: t.high, mid: t.mid })),
      gas_other: { ...MODEL.gasOther },
      capital_tiers: MODEL.capitalTiers.map((t) => ({ min_tvl_usd: t.minTvlUsd, usd: t.usd })),
      hold_young_cutoff_days: MODEL.holdYoungCutoffDays,
      hold_old_cutoff_days: MODEL.holdOldCutoffDays,
      hold_young_days: MODEL.holdYoungDays,
      hold_mid_days: MODEL.holdMidDays,
      hold_old_days: MODEL.holdOldDays,
      hold_unknown_days: MODEL.holdUnknownDays,
      minutes_setup: MODEL.minutesSetup,
      minutes_second_position: MODEL.minutesSecondPosition,
      minutes_weekly: MODEL.minutesWeekly,
      minutes_claim: MODEL.minutesClaim,
      minutes_log: MODEL.minutesLog,
      verdict_farm_max_ratio: MODEL.verdictFarmMaxRatio,
      verdict_thin_max_ratio: MODEL.verdictThinMaxRatio,
      verdict_farm_max_minutes: MODEL.verdictFarmMaxMinutes,
      verdict_thin_max_minutes: MODEL.verdictThinMaxMinutes,
    },
    model_version: MODEL_VERSION,
    global_multiple: global,
    category_multiples: multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: earlySize,
    live_size: liveSize,
    no_cap_size: noCapRows.length,
    set_aside_size: setAsideSize,
    rows: rows.map((r) => {
      const { farm_steps: _steps, ...rest } = r;
      return rest;
    }),
    live: liveRows,
    no_cap: noCapRows,
  };
}

/** The board and the dashboard data together, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  return { board, radar: buildDashboard(snapshot, board) };
}

/** Render the dashboard data as the script the page reads: it assigns
 * the data to the page's global data variable. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Why a board fails the gate, or null when it passes: watchlist
 * coverage, ranks, ordering, the shared-value rule and the farm-step
 * shape. */
export function boardIssue(board: BoardRow[], snapshot?: Snapshot): string | null {
  if (!Array.isArray(board)) return 'the board is not an array';
  if (board.length < 100 || board.length > 4000) {
    return `the board holds ${board.length} rows, outside 100 to 4000`;
  }
  const seenSlugs = new Set<string>();
  let previous: number | null = null;
  let allEqual = board.length > 1;
  const firstValue = board.length > 0 ? board[0].implied_value_usd : null;
  for (let i = 0; i < board.length; i++) {
    const row = board[i];
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}, not ${i + 1}`;
    if (typeof row.slug !== 'string' || row.slug.length === 0) return `row ${i + 1} carries no slug`;
    if (seenSlugs.has(row.slug)) return `slug ${row.slug} appears twice on the board`;
    seenSlugs.add(row.slug);
    if (typeof row.name !== 'string' || row.name.length === 0) return `row ${row.slug} carries no name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} carries no positive whole implied value`;
    }
    if (row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} carries an implied value above one hundred trillion dollars`;
    }
    if (previous !== null && row.implied_value_usd > previous) {
      return `row ${row.slug} is worth more than the row ranked above it`;
    }
    previous = row.implied_value_usd;
    if (row.implied_value_usd !== firstValue) allEqual = false;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} carries ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 0} farm steps, outside 3 to 12`;
    }
    for (const step of row.farm_steps) {
      if (typeof step !== 'string') return `row ${row.slug} carries a farm step that is not a string`;
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} carries a farm step of ${trimmed.length} characters, outside 20 to 600`;
      }
    }
  }
  if (allEqual) return 'every row carries the same implied value, so the board ranks nothing';
  if (snapshot) {
    for (const slug of snapshot.watchlist) {
      if (!seenSlugs.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
    }
    const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
    for (const slug of seenSlugs) {
      if (!snapshotSlugs.has(slug)) return `row ${slug} names a protocol the snapshot does not list`;
    }
  }
  return null;
}
