/**
 * The words algo trading shows people: consents, the hypothetical-performance disclosure and the short
 * not-advice line. Pure data, safe on the client. Wording rules as copy trading's (docs/copy-trading.md):
 * describe what a rule does and what happened; never say what anyone should buy or sell, never call a
 * strategy suitable for anyone, and put the hypothetical disclosure beside every backtest number.
 * Changing a text means a new version, so everyone agrees to the words they saw.
 */
export const HYPOTHETICAL = "Hypothetical performance. These results are simulated on historical prices with the costs and rules stated beside them; no one earned them, and they are no promise or prediction of future results. Simulations are built with the benefit of hindsight in choosing the strategy, the universe and its settings, and real trading meets costs, fills and events they do not model. Past performance does not guarantee future results. Not investment advice.";

export const NOT_ADVICE = "Not investment advice. YouBank runs the rules you set, on your own account, within the limits you set; you decide what runs and can stop it at any time.";

export const CONSENTS = {
  terms: {
    version: "2026-10-1",
    title: "Before you use algo trading",
    points: [
      "YouBank is not your investment adviser or broker and does not give personalised advice. Strategies follow rules you choose or approve; nothing here says a strategy is right for you.",
      "Backtests and paper results are hypothetical. They are built with hindsight and leave out costs and events real trading meets. Real orders can lose money, including all of it.",
      "The AI agent can propose strategies, explain trades, run backtests and pause things. It never places an order you did not ask for in your own words, and never trades on what it reads in news or filings.",
      "Every decision, order and agent action is written to an audit log you can download.",
    ],
  },
  live: {
    version: "2026-10-1",
    title: "Before a strategy places real orders",
    points: [
      "Orders go to your own broker, under your broker's terms, and are yours. YouBank never holds your money or securities.",
      "With approval mode, each batch waits for your tap; large batches ask you to type a confirmation. Batches expire after a few minutes, because prices move.",
      "The risk engine checks every order against your limits and the server's ceilings first, and refuses what breaks them. Limit orders may not fill; market orders may fill worse than shown. Selling can realise taxable gains or losses, and buying back within 30 days of a loss can make it a wash sale.",
      "An order whose outcome is unknown is never sent again automatically: check your broker. You can pause a strategy, turn on the kill switch or disconnect your broker at any time.",
    ],
  },
  autonomous: {
    version: "2026-10-1",
    title: "Let this strategy trade without asking",
    points: [
      "This strategy will place real orders in your account on its schedule, without asking you first, within the limits shown here. You can tighten the limits, pause it or turn on the kill switch at any time; loosening a limit needs this confirmation again.",
      "It trades only by its own rules. The AI agent cannot place orders for it, and news or filings cannot trigger its orders.",
      "It stops on its own at its daily loss limit (for the day) and its drawdown limit (until you review it), and after any order with an unknown outcome.",
      "Automated trading can lose money quickly, including through errors, bad data or market gaps. You are responsible for the orders it places in your account.",
    ],
  },
} as const;

export type ConsentKind = keyof typeof CONSENTS;
export const consentText = (k: ConsentKind) => `${CONSENTS[k].title}\n${CONSENTS[k].points.join("\n")}`;

/** The words a person types to let one strategy trade on its own. */
export const autonomousPhrase = (name: string) => `TRADE ${name.trim().toUpperCase().replace(/\s+/g, " ").slice(0, 40)} AUTOMATICALLY`;
