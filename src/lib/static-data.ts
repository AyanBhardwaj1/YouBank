/** Static configuration: default watchlist, saved peer groups, and sample precedents (until a deal database exists). */

export const DEFAULT_WATCHLIST = ["SNOW", "MDB", "DDOG", "ESTC", "NET", "GTLB", "PLTR", "CRWD"];

export type PeerMember = { ticker: string; tier: "core" | "adjacent"; rationale: string };
export type PeerGroup = { id: string; name: string; description: string; members: PeerMember[] };

export const PEER_GROUPS: PeerGroup[] = [
  {
    id: "cloud-data",
    name: "Cloud data platforms",
    description: "Consumption or hybrid-priced data infrastructure sold to developers and data teams.",
    members: [
      { ticker: "SNOW", tier: "core", rationale: "Cloud data warehouse / AI data cloud, consumption pricing" },
      { ticker: "MDB", tier: "core", rationale: "Developer database, Atlas consumption model" },
      { ticker: "DDOG", tier: "core", rationale: "Observability on the same cloud workloads; usage-based pricing" },
      { ticker: "ESTC", tier: "adjacent", rationale: "Search and analytics infrastructure" },
      { ticker: "PLTR", tier: "adjacent", rationale: "Data integration and AI platform; different go-to-market" },
      { ticker: "TDC", tier: "adjacent", rationale: "Legacy data warehouse migrating to cloud; valuation floor reference" },
    ],
  },
  {
    id: "infra-software",
    name: "Infrastructure software (broad)",
    description: "Developer and infrastructure software with usage or seat-based models.",
    members: [
      { ticker: "DDOG", tier: "core", rationale: "Observability" },
      { ticker: "NET", tier: "core", rationale: "Network and security services" },
      { ticker: "GTLB", tier: "core", rationale: "DevSecOps" },
      { ticker: "MDB", tier: "adjacent", rationale: "Database" },
      { ticker: "SNOW", tier: "adjacent", rationale: "Data warehouse" },
    ],
  },
  {
    id: "security",
    name: "Cybersecurity platforms",
    description: "Cloud-delivered security platforms.",
    members: [
      { ticker: "CRWD", tier: "core", rationale: "Endpoint and cloud security platform" },
      { ticker: "ZS", tier: "core", rationale: "Zero trust network security" },
      { ticker: "PANW", tier: "core", rationale: "Broad security platform" },
      { ticker: "NET", tier: "adjacent", rationale: "Network services with a growing security mix" },
      { ticker: "S", tier: "adjacent", rationale: "AI-driven endpoint security" },
    ],
  },
];

export type Precedent = { announced: string; target: string; acquirer: string; ev: number; evLtmRevenue: number | null; status: string; note: string };

/** Sample precedents with approximate values. To be replaced by a deal database seeded from 8-K and merger proxy filings. */
export const PRECEDENTS: Precedent[] = [
  { announced: "2025-03-18", target: "Wiz", acquirer: "Alphabet (Google)", ev: 32000, evLtmRevenue: 46, status: "Closed", note: "Cloud security; private target, ARR-based multiple" },
  { announced: "2025-05-27", target: "Informatica", acquirer: "Salesforce", ev: 8000, evLtmRevenue: 4.8, status: "Closed", note: "Data management" },
  { announced: "2024-04-24", target: "HashiCorp", acquirer: "IBM", ev: 6400, evLtmRevenue: 9.5, status: "Closed", note: "Infrastructure automation" },
  { announced: "2024-04-26", target: "Darktrace", acquirer: "Thoma Bravo", ev: 5300, evLtmRevenue: 7.8, status: "Closed", note: "AI cybersecurity; UK listed" },
  { announced: "2023-09-21", target: "Splunk", acquirer: "Cisco", ev: 28000, evLtmRevenue: 7.0, status: "Closed", note: "Observability and security" },
  { announced: "2022-05-26", target: "VMware", acquirer: "Broadcom", ev: 69000, evLtmRevenue: 5.2, status: "Closed", note: "Virtualization; mixed cash and stock" },
  { announced: "2022-09-15", target: "Figma", acquirer: "Adobe", ev: 20000, evLtmRevenue: 50, status: "Terminated", note: "Blocked on antitrust grounds; later IPO" },
  { announced: "2020-12-01", target: "Slack", acquirer: "Salesforce", ev: 27700, evLtmRevenue: 26, status: "Closed", note: "Collaboration software" },
];
