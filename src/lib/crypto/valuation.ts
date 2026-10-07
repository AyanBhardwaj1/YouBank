/**
 * Token valuation, the three ways a crypto analyst usually does it. Pure, for tests: the Studio
 * templates build the same arithmetic as live formulas, and the tests check the two agree.
 *
 * 1. Fee or revenue multiple: what the network earns a year times what comparable networks trade at.
 *    Fees are everything users pay; revenue is the protocol's share; holders' revenue is what reaches
 *    tokenholders (buybacks, burns, staking distributions). Market cap over holders' revenue is the
 *    closest thing to a P/E.
 * 2. Discounted token cash flow: holders' cash flows for a few years, fading growth, a terminal value,
 *    discounted at a crypto-appropriate rate, divided by the supply expected at the end of the forecast,
 *    so scheduled unlocks and emissions dilute the value per token the way they will in practice.
 * 3. Staking yield: issuance and fees paid to stakers over what is staked is the nominal yield; less
 *    supply inflation it is the real yield; a non-staker is diluted by the inflation.
 */

export type MultipleInputs = { annualMetricUsd: number; multiple: number; circulating: number; fullyDiluted?: number | null };

export function multipleValue(m: MultipleInputs) {
  const value = m.annualMetricUsd * m.multiple;
  return { value, perToken: m.circulating > 0 ? value / m.circulating : null, perTokenFd: m.fullyDiluted ? value / m.fullyDiluted : null };
}

export type DcfInputs = {
  /** Holders' revenue (cash to tokenholders) in the last year, USD. */
  baseCashflowUsd: number;
  /** Growth in year 1 and year 5; years in between fade linearly. */
  growthY1: number;
  growthY5: number;
  discountRate: number;
  terminalGrowth: number;
  circulating: number;
  /** Net supply growth a year from unlocks and emissions (0.05 is 5%). */
  supplyGrowth: number;
  maxSupply?: number | null;
  years?: number;
};

export function tokenDcf(d: DcfInputs) {
  if (d.discountRate <= d.terminalGrowth) throw new Error("The discount rate must exceed terminal growth");
  const n = d.years ?? 5;
  const flows: number[] = [], supply: number[] = [], pv: number[] = [];
  let cf = d.baseCashflowUsd, s = d.circulating;
  for (let t = 1; t <= n; t++) {
    const g = d.growthY1 + ((d.growthY5 - d.growthY1) * (t - 1)) / Math.max(1, n - 1);
    cf *= 1 + g;
    s *= 1 + d.supplyGrowth;
    if (d.maxSupply && d.maxSupply > 0) s = Math.min(s, d.maxSupply);
    flows.push(cf); supply.push(s); pv.push(cf / (1 + d.discountRate) ** t);
  }
  const terminal = (flows[n - 1] * (1 + d.terminalGrowth)) / (d.discountRate - d.terminalGrowth);
  const pvTerminal = terminal / (1 + d.discountRate) ** n;
  const value = pv.reduce((a, b) => a + b, 0) + pvTerminal;
  return { flows, supply, pv, terminal, pvTerminal, value, perToken: supply[n - 1] > 0 ? value / supply[n - 1] : null, terminalShare: value ? pvTerminal / value : null };
}

export type StakingInputs = {
  supply: number;
  /** New tokens issued a year to stakers, as a share of supply. */
  issuanceRate: number;
  /** Share of supply staked. */
  stakingRatio: number;
  /** Fees (and MEV) paid to stakers a year, USD. */
  feesToStakersUsd: number;
  priceUsd: number;
  /** Tokens burned a year, as a share of supply (EIP-1559-style burns offset issuance). */
  burnRate?: number;
};

export function stakingYield(s: StakingInputs) {
  const staked = s.supply * s.stakingRatio;
  const issuance = s.supply * s.issuanceRate;
  const feesInTokens = s.priceUsd > 0 ? s.feesToStakersUsd / s.priceUsd : 0;
  const nominal = staked > 0 ? (issuance + feesInTokens) / staked : 0;
  const inflation = s.issuanceRate - (s.burnRate ?? 0);
  const real = (1 + nominal) / (1 + inflation) - 1;
  return { staked, nominal, inflation, real, nonStakerDilution: 1 / (1 + inflation) - 1, feeYield: staked > 0 ? feesInTokens / staked : 0 };
}

/** Median and quartiles of a list (Excel's QUARTILE.INC), skipping blanks. */
export function quartiles(xs: (number | null | undefined)[]) {
  const s = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  const q = (p: number) => { if (!s.length) return null; const pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
  return { q1: q(0.25), median: q(0.5), q3: q(0.75), n: s.length };
}
