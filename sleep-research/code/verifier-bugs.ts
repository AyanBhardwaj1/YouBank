// Reproduces the verifier bugs found in plan review round 1. Run: pnpm exec tsx sleep-research/code/verifier-bugs.ts
import { checkNumbers } from "../../src/lib/edge/claims/numbers";
const r = (claim: string, payload: string) => { const c = checkNumbers(claim, [payload]); return `${claim} vs ${payload} -> found ${c.found}, derived ${c.derived.length}, missing ${c.missing.join("|")}`; };
console.log(r("LTM revenue was $2.0 billion.", JSON.stringify({ revenue: 1950.3 })));
console.log(r("LTM revenue was $1,950 million.", JSON.stringify({ revenue: 1950.3 })));
console.log(r("Revenue was $7.4 billion.", JSON.stringify({ sic: "7372 Services-Prepackaged Software", revenue: 512.1 })));
console.log(r("Revenue was $2.4 million.", JSON.stringify({ revenue: 2400.0 })));
console.log(r("Revenue was 1.2B.", JSON.stringify({ revenue: 1200.0 })));
