/**
 * The words the copy feature shows people, kept in one place so the review screens, the consents and
 * docs/copy-trading.md say the same thing. Pure data, safe on the client.
 *
 * Wording rules (see docs/copy-trading.md, "Compliance"): describe what a filing says and what a rule
 * does; never tell a person what they should buy or sell, never call a fund or a copy suitable for them,
 * and put the hypothetical-performance disclosure next to every backtest number.
 */

export const TIMING = "13F filings come once a quarter, up to 45 days after the quarter ends. \"Real time\" here means: the moment a new 13F or 13F/A is filed, we turn it into orders for you to review. The fund may have changed its positions since the quarter it reports.";

export const HYPOTHETICAL = "Hypothetical performance: simulated from public 13F filings, not results anyone earned, and no promise or prediction of future results. The simulation buys each filing's largest long positions at the close of the first trading day after the filing date and holds them until the next filing. No dividends, fees, commissions, spreads, slippage or taxes; long-only; options and holdings without a ticker are left out. The fund's own returns were different: a 13F leaves out shorts, cash, bonds, non-US holdings and all trading within the quarter. Past performance does not guarantee future results.";

export const NO_LAG_NOTE = "The \"quarter end, no lag\" line buys the same holdings at the quarter-end close, which nobody could do: it shows how much the filing delay costs, not a result you could have had.";

export const NOT_ADVICE_SHORT = "Not investment advice. YouBank shows what funds disclosed and builds orders from rules you choose; you decide every trade.";

/** Consent texts. Changing a text means a new version, so everyone agrees to the words they saw. */
export const CONSENTS = {
  terms: {
    version: "2026-10-1",
    title: "Before you copy a fund",
    points: [
      "YouBank is not your investment adviser or broker and does not give personalised advice. Copies follow rules you set; nothing here says a fund, a stock or a copy is right for you.",
      "13F filings are delayed (up to 45 days after the quarter) and incomplete (no shorts, cash, bonds, non-US holdings or trading within the quarter). A copy holds what a fund held then, not what it holds now.",
      "Backtests and paper results are hypothetical. Real orders can lose money, including all of it.",
      "You decide every trade. YouBank never places an order you did not approve, never holds your money, and never moves it.",
    ],
  },
  trading: {
    version: "2026-10-1",
    title: "Before you place real orders",
    points: [
      "Orders go to your own broker through SnapTrade, under your broker's terms, and are yours. YouBank does not hold funds or securities.",
      "Each batch shows every order before it goes. Nothing is sent until you approve that batch; large batches ask you to type a confirmation.",
      "Prices move. Limit orders may not fill; market orders may fill at worse prices than shown. Selling can realise taxable gains or losses.",
      "You can stop at any time: pause a copy, cancel unsent orders, or disconnect your broker. Orders already sent are between you and your broker.",
    ],
  },
} as const;

export type ConsentKind = keyof typeof CONSENTS;
export const consentText = (k: ConsentKind) => `${CONSENTS[k].title}\n${CONSENTS[k].points.join("\n")}`;
