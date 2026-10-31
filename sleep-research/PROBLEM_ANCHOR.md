# Problem anchor (frozen 2026-10-31)

The AI labs (Anthropic finance agents, May 2026; ChatGPT for Financial Services, Sept 2026) and every major data vendor
(over MCP) are commoditising general finance research. Independent benchmarks still put finance agents near 60% and
spreadsheet agents near 35%, failing mainly on evidence extraction and arithmetic. YouBank's core hypothesis is that a
professional at a firm without a Capital IQ budget will choose and keep a tool that (1) makes its numbers
**demonstrably** right, (2) **acts** on the work (outreach, models, follow-up) only as far as it has **earned**, and
(3) costs a fraction of enterprise tools. Today YouBank claims (1) and (2) on its landing page
(`src/components/marketing/Landing.tsx:110,168`), but only Edge checks numbers, the calibration behind that check was
fitted on synthetic claims, and email autonomy is advisory rather than certified. Nothing measures answer quality outside Edge.

Later work may sharpen methods, but the problem stays: **make the numbers provably right and the autonomy provably
earned, and measure both**. Adding new surface area (more modules, more data) does not solve this problem.
