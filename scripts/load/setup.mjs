/**
 * Create the load test's signed-in users against a LOCAL server (or a preview with its own database),
 * then give them realistic data volumes straight in the test database.
 *
 * 1. Users: sign up (or in) through the app's own Better Auth route, finish onboarding with a role, and
 *    give every third user a blank Studio document to follow. Against localhost each user signs up
 *    from its own address (x-real-ip), so the sign-up limit (50 an hour per address) is not the bottleneck.
 * 2. Data (--seed, on by default): with SQL against the test database (--db, else DATABASE_URL), per user:
 *    contacts, mail threads and messages, pipeline deals, drafts, Studio documents, Newsroom reads, saves
 *    and bell notifications, followed stories, algo strategies with decisions, 13F follows, calendar
 *    events, AI usage, and for some a paid plan or a team seat; shared: Newsroom stories and articles,
 *    deals, quant signals, 13F filers and filings, and company records for the tickers the load asks for.
 *    Re-running replaces the seeded rows (tagged as load-test data), never anything else.
 *
 * Writes the users and their session cookies to --out (keep it outside the repo: the cookies are live
 * sessions on the test database).
 *
 *   node scripts/load/setup.mjs --base http://localhost:3301 --users 300 --out /tmp/loadtest-users.json
 *
 * The database guard: localhost only, unless LOADTEST_DB_CONFIRM names the remote database's host
 * exactly (a Neon test branch's endpoint, typed on purpose). It also refuses a database whose users are
 * mostly not load-test users and that has more than 50 of them: that looks like production.
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { guardTarget, parseArgs } from "./common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://localhost:3301", users: "60", out: "", password: "LoadTest-2026-only!", seed: "true", db: "", concurrency: "8" });
if (!args.out) throw new Error("--out is required (a path outside the repo)");
const base = guardTarget(args.base);
const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname);
const ROLES = ["banker", "pe", "vc", "markets", "corpfin", "consultant", "accountant", "student"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jar = (res, prev = "") => {
  const cookies = new Map(prev.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]));
  for (const c of res.headers.getSetCookie?.() ?? []) { const pair = c.split(";")[0]; cookies.set(pair.split("=")[0], pair); }
  return [...cookies.values()].join("; ");
};

/** POST to the auth route, waiting out its rate limit. Locally each user comes from its own address. */
async function authPost(path, body, ip) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/auth/${path}`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/json", origin: base, ...(local ? { "x-real-ip": ip } : {}) },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 || attempt >= 8) return res;
    await sleep(5_000 * (attempt + 1));
  }
}

async function signIn(email, name, ip) {
  let res = await authPost("sign-up/email", { email, password: args.password, name }, ip);
  if (!res.ok) res = await authPost("sign-in/email", { email, password: args.password }, ip);
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return jar(res);
}

async function makeUser(i) {
  const email = `loadtest+${String(i).padStart(3, "0")}@youbank-loadtest.dev`;
  const role = ROLES[i % ROLES.length];
  const ip = `10.77.${Math.floor(i / 250)}.${(i % 250) + 1}`;
  let cookie = await signIn(email, `Load Test ${i}`, ip);
  const p = await fetch(`${base}/api/profile`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ role, sectors: ["energy", "tech"], firmName: "Load Test Capital", firmTicker: i % 4 === 0 ? "JPM" : "" }) });
  if (!p.ok) throw new Error(`onboarding failed for ${email}: ${p.status} ${(await p.text()).slice(0, 200)}`);
  cookie = jar(p, cookie);
  const user = { email, role, cookie };
  if (i % 3 === 0) {
    const d = await fetch(`${base}/api/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ template: "blank", title: `Load test ${i}` }) });
    if (!d.ok) throw new Error(`document failed for ${email}: ${d.status} ${(await d.text()).slice(0, 200)}`);
    const { id } = await d.json();
    const doc = await (await fetch(`${base}/api/studio/${id}`, { headers: { cookie } })).json();
    Object.assign(user, { docId: id, sheetId: doc.doc.workbook.order[0] });
  }
  return user;
}

const n = Number(args.users);
const users = new Array(n);
let next = 1, done = 0;
await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency)) }, async () => {
  while (next <= n) {
    const i = next++;
    users[i - 1] = await makeUser(i);
    if (++done % 25 === 0 || done === n) console.log(`${done}/${n} users ready`);
  }
}));
writeFileSync(args.out, JSON.stringify(users, null, 2));
console.log(`\nwrote ${users.length} users (${users.filter((u) => u.docId).length} with documents) to ${args.out}`);

if (args.seed !== "false") await seed();

/* ------------------------------------------------------------------------------------------------ */

function guardDb(url) {
  const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return;
  if (process.env.LOADTEST_DB_CONFIRM && process.env.LOADTEST_DB_CONFIRM === host) return;
  throw new Error(`Refusing to seed ${host}: only a local database, or a test branch named exactly in LOADTEST_DB_CONFIRM`);
}

async function seed() {
  const url = args.db || process.env.DATABASE_URL;
  if (!url) throw new Error("Seeding needs --db or DATABASE_URL (the test database)");
  guardDb(url);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const [{ others, total }] = await sql`select count(*) filter (where email not like '%@youbank-loadtest.dev')::int as others, count(*)::int as total from auth_users`;
    if (others > 50 && others > total / 2) throw new Error(`Refusing to seed: ${others} of ${total} users are not load-test users (this looks like production)`);
    await sql`set statement_timeout = 0`;
    const t0 = Date.now();
    const step = async (label, q) => { const s = Date.now(); await q; console.log(`  ${label.padEnd(28)} ${((Date.now() - s) / 1000).toFixed(1)}s`); };
    console.log("seeding data volumes:");
    await sql.begin(async (tx) => {
      // The load-test users, numbered.
      await tx`create temp table lt_users on commit drop as
        select u.id, u.email, row_number() over (order by u.email)::int as n from auth_users u where u.email like 'loadtest+%@youbank-loadtest.dev'`;
      // Clear what an earlier run seeded for them (and the shared rows tagged as load-test data).
      for (const t of ["crm_contacts", "crm_deals", "crm_drafts", "crm_signals", "news_user_items", "news_notifications", "news_follows", "copy_follows", "ai_usage", "edge_watches", "calendar_accounts", "algo_strategies", "algo_decisions", "manual_inputs", "peer_groups", "comps_sheets"]) {
        await tx.unsafe(`delete from ${t} where user_id in (select id from lt_users)`);
      }
      await tx`delete from crm_threads where user_id in (select id from lt_users)`;
      await tx`delete from studio_docs where owner_id in (select id from lt_users) and title like 'Seeded %'`;
      await tx`delete from seat_assignments where user_id in (select id from lt_users) or owner_user_id in (select id from lt_users)`;
      await tx`delete from subscriptions where user_id in (select id from lt_users)`;
      await tx`delete from teams where slug like 'loadtest-%'`;
      await tx`delete from news_deals where source_url like 'https://loadtest.invalid/%'`;
      await tx`delete from news_items where domain = 'loadtest.invalid'`;
      await tx`delete from news_clusters where headline like '[LT] %'`;
      await tx`delete from quant_signals where producer like 'loadtest.%'`;
      await tx`delete from copy_filings where doc_url like 'https://loadtest.invalid/%'`;
      await tx`delete from copy_filers where name like 'LT Fund %'`;

      await step("news stories and articles", tx`
        with c as (
          insert into news_clusters (headline, category, importance, desks, tickers, entities, summary, source_count, kinds, first_seen_at, updated_at)
          select '[LT] ' || (array['Acme','Globex','Initech','Umbrella','Stark','Wayne','Hooli','Soylent'])[1 + g % 8] || ' ' || (array['agrees to buy','raises','beats estimates at','cuts guidance at','files 8-K on','prices notes for'])[1 + g % 6] || ' story ' || g,
            (array['ma','earnings','capital_markets','macro','tech','energy','general'])[1 + g % 7], (g % 100) / 100.0,
            to_jsonb(array[(array['energy','tech','banking','pe','vc','markets'])[1 + g % 6], (array['ma','ecm','dcm','macro'])[1 + g % 4]]),
            to_jsonb(array[(array['AAPL','NVDA','XOM','JPM','KO','MSFT','CVX','GS'])[1 + g % 8]]),
            jsonb_build_array(jsonb_build_object('name', (array['Acme Corp','Globex Inc','Initech LLC','Umbrella plc'])[1 + g % 4], 'kind', 'company')),
            jsonb_build_object('bullets', jsonb_build_array('A seeded summary line for the load test, about one sentence long.', 'A second line with a number: revenue up 12%.'), 'numbers', '[]'::jsonb, 'why', 'Seeded'),
            1 + g % 5, '["article"]'::jsonb, now() - (g % 168) * interval '1 hour', now() - (g % 160) * interval '1 hour'
          from generate_series(1, 6000) g returning id
        )
        insert into news_items (key, url, title, snippet, source, domain, kind, published_at, desks, tickers, meta, cluster_id)
        select 'https://loadtest.invalid/a/' || c.id || '/' || k, 'https://loadtest.invalid/a/' || c.id || '/' || k, 'Seeded article ' || c.id || '-' || k,
          'A short snippet for the seeded article, a sentence or two of text.', (array['Reuters','Bloomberg','WSJ','FT','SEC'])[1 + (c.id + k) % 5], 'loadtest.invalid', 'article',
          now() - ((c.id + k) % 168) * interval '1 hour', '["energy"]'::jsonb, '["XOM"]'::jsonb, jsonb_build_object('tier', 1 + k % 3), c.id
        from c, generate_series(1, 3) k`);
      await step("news deals", tx`
        insert into news_deals (cluster_id, kind, acquirer, target, value_usd, sector, announced_at, source_url)
        select id, (array['acquisition','raise','ipo','merger'])[1 + id % 4], 'Acquirer ' || id, 'Target ' || id, (id % 50) * 1e8, 'tech', updated_at, 'https://loadtest.invalid/d/' || id
        from news_clusters where headline like '[LT] %' and id % 10 = 0 on conflict (cluster_id) do nothing`);

      await step("contacts (200/user)", tx`
        insert into crm_contacts (user_id, email, name, title, company, domain, kind, last_seen_at)
        select u.id, 'c' || g || '.u' || u.n || '@contacts.loadtest.invalid', 'Contact ' || g, 'VP', (array['Acme Corp','Globex Inc','Initech LLC','Umbrella plc','Hooli','Stark Industries'])[1 + g % 6] || case when g > 6 then ' ' || g else '' end,
          'contacts.loadtest.invalid', (array['founder','investor','banker','operator'])[1 + g % 4], now() - g * interval '1 day'
        from lt_users u, generate_series(1, 200) g`);
      await step("deals (40/user)", tx`
        insert into crm_deals (user_id, name, stage, sector, amount_usd, status, next_step, updated_at)
        select u.id, 'Deal ' || g || ' for ' || u.n, (array['inbox','screen','diligence','ic','closed'])[1 + g % 5], 'tech', g * 1e6, case when g % 7 = 0 then 'won' else 'open' end, 'Call back', now() - g * interval '6 hours'
        from lt_users u, generate_series(1, 40) g`);
      await step("threads (150/user) + msgs", tx`
        with t as (
          insert into crm_threads (user_id, provider_thread_id, subject, snippet, participants, category, priority, summary, needs_reply, triaged_at, last_message_at)
          select u.id, 'lt-' || u.n || '-' || g, 'Re: seeded thread ' || g, 'Snippet of the latest message in the seeded thread.', '[{"name":"Contact","address":"c1@contacts.loadtest.invalid"}]'::jsonb,
            (array['deal','intro','update','other'])[1 + g % 4], (array['high','medium','low'])[1 + g % 3], 'A seeded triage summary.', g % 5 = 0, now(), now() - g * interval '3 hours'
          from lt_users u, generate_series(1, 150) g returning id, last_message_at
        )
        insert into crm_messages (thread_id, provider_message_id, direction, from_name, from_address, subject, body, sent_at)
        select t.id, 'm' || t.id || '-' || k, case when k = 2 then 'outbound' else 'inbound' end, 'Contact', 'c1@contacts.loadtest.invalid', 'Re: seeded', repeat('Body text of a seeded email. ', 20), t.last_message_at - (3 - k) * interval '1 hour'
        from t, generate_series(1, 3) k`);
      await step("drafts (20/user)", tx`
        insert into crm_drafts (user_id, subject, body, status, kind, created_at)
        select u.id, 'Draft ' || g, 'A seeded draft body.', (array['pending','sent','discarded'])[1 + g % 3], 'reply', now() - g * interval '1 day'
        from lt_users u, generate_series(1, 20) g`);
      await step("studio docs (4/user)", tx`
        insert into studio_docs (owner_id, title, kind, workbook, deck, updated_at)
        select u.id, 'Seeded model ' || g, 'blank',
          jsonb_build_object('order', jsonb_build_array('s1'), 'sheets', jsonb_build_object('s1', jsonb_build_object('id', 's1', 'name', 'Sheet1', 'cells', (select jsonb_object_agg('A' || c, jsonb_build_object('v', c)) from generate_series(1, 200) c)))),
          '{"slides":[]}'::jsonb, now() - g * interval '1 day'
        from lt_users u, generate_series(1, 4) g`);
      await step("news reads/saves (120/user)", tx`
        insert into news_user_items (user_id, cluster_id, read_at, saved_at, hidden_at, updated_at)
        select u.id, c.id, now() - (c.id % 48) * interval '1 hour', case when c.id % 9 = 0 then now() end, case when c.id % 31 = 0 then now() end, now() - (c.id % 48) * interval '1 hour'
        from lt_users u cross join lateral (select id from news_clusters where headline like '[LT] %' order by id offset (u.n * 7) % 5000 limit 120) c`);
      await step("bell notifications (150/user)", tx`
        insert into news_notifications (user_id, key, kind, title, body, url, urgent, created_at, read_at)
        select u.id, 'lt:' || g, (array['alert','brief','system'])[1 + g % 3], 'Seeded alert ' || g, 'Something happened that matters to your desk.', '/app/news', g % 20 = 0, now() - g * interval '2 hours', case when g > 10 then now() end
        from lt_users u, generate_series(1, 150) g`);
      await step("followed stories (5/user)", tx`
        insert into news_follows (user_id, cluster_id) select u.id, c.id
        from lt_users u cross join lateral (select id from news_clusters where headline like '[LT] %' order by id offset (u.n * 13) % 5000 limit 5) c`);
      await step("13F filers, filings, follows", tx`
        with f as (
          insert into copy_filers (cik, name, latest_filed, latest_period, curated) select lpad((9000000 + g)::text, 10, '0'), 'LT Fund ' || g, current_date - (g % 90), date_trunc('quarter', current_date)::date - 1, g <= 40
          from generate_series(1, 200) g on conflict (cik) do update set name = excluded.name returning cik
        ), fl as (
          insert into copy_filings (accession, cik, form, filed_on, period, holdings, lines, doc_url)
          select f.cik || '-lt-' || q, f.cik, '13F-HR', current_date - q * 91, date_trunc('quarter', current_date)::date - 1 - q * 91,
            (select jsonb_agg(jsonb_build_object('cusip', lpad(h::text, 9, '0'), 'issuer', 'Issuer ' || h, 'value', h * 1000, 'shares', h * 10)) from generate_series(1, 60) h), 60, 'https://loadtest.invalid/13f/' || f.cik || '/' || q
          from f, generate_series(0, 2) q on conflict (accession) do nothing returning 1
        )
        insert into copy_follows (user_id, cik) select u.id, lpad((9000000 + 1 + (u.n * 3 + g) % 200)::text, 10, '0') from lt_users u, generate_series(1, 5) g on conflict do nothing`);
      await step("algo strategies + decisions", tx`
        with s as (
          insert into algo_strategies (user_id, name, spec, mode, status, next_tick_at)
          select u.id, 'Seeded strategy ' || g, '{"universe":["AAPL","MSFT"],"rule":"momentum"}'::jsonb, 'paper', 'active', now() + g * interval '5 minutes'
          from lt_users u, generate_series(1, 3) g returning id, user_id
        )
        insert into algo_decisions (strategy_id, user_id, mode, target, notes, created_at)
        select s.id, s.user_id, 'paper', '{"AAPL":0.5,"MSFT":0.5}'::jsonb, 'Seeded decision', now() - k * interval '1 day' from s, generate_series(1, 30) k`);
      await step("quant signals", tx`
        insert into quant_signals (id, producer, producer_version, symbol, as_of, valid_until, horizon_days, body)
        select 'lt-' || p || '-' || s || '-' || d, 'loadtest.' || p, '1', (array['AAPL','NVDA','XOM','JPM','KO','MSFT','CVX','GS','AMZN','META'])[1 + s % 10] || case when s >= 10 then s::text else '' end,
          now() - d * interval '1 day', now() - d * interval '1 day' + interval '2 days', 5, jsonb_build_object('score', (s % 7) / 7.0)
        from generate_series(1, 4) p, generate_series(0, 49) s, generate_series(0, 24) d`);
      await step("calendar events (200/user)", tx`
        with a as (
          insert into calendar_accounts (user_id, provider, address) select id, 'ics', 'cal-' || n || '@loadtest.invalid' from lt_users returning id, user_id
        ), c as (
          insert into calendar_calendars (account_id, user_id, remote_id, name, is_primary) select a.id, a.user_id, 'primary', 'Work', true from a returning id, user_id
        )
        insert into calendar_events (user_id, calendar_id, remote_id, title, starts_at, ends_at, attendees, external)
        select c.user_id, c.id, 'ev-' || g, 'Seeded meeting ' || g, date_trunc('hour', now()) + (g - 100) * interval '5 hours', date_trunc('hour', now()) + (g - 100) * interval '5 hours' + interval '30 minutes',
          '[{"email":"c1@contacts.loadtest.invalid","name":"Contact"}]'::jsonb, g % 2 = 0
        from c, generate_series(1, 200) g`);
      await step("ai usage (60/user)", tx`
        insert into ai_usage (user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, created_at)
        select u.id, 'chat', 'openai', 'gpt-5.6-luna', 1200, 90, 0.002, now() - g * interval '11 hours' from lt_users u, generate_series(1, 60) g`);
      await step("edge watches, peers, comps", tx`
        with w as (
          insert into edge_watches (user_id, kind, label, target) select u.id, 'company', 'Watch ' || g, jsonb_build_object('ticker', 'XOM', 'company', 'Exxon Mobil') from lt_users u, generate_series(1, 5) g returning 1
        ), pg as (
          insert into peer_groups (user_id, name) select u.id, 'Peers ' || g from lt_users u, generate_series(1, 3) g returning 1
        )
        insert into comps_sheets (user_id, name, target_ticker, members) select u.id, 'Comps ' || g, 'XOM', '[]'::jsonb from lt_users u, generate_series(1, 3) g`);
      await step("plans, teams and seats", tx`
        with owners as (select id, n from lt_users where n % 30 = 1), t as (
          insert into teams (name, slug, created_by) select 'LT Team ' || n, 'loadtest-' || n, id from owners returning id, created_by
        ), s as (
          insert into subscriptions (user_id, plan, status, seats, billing_anchor) select created_by, 'team', 'active', 5, now() - interval '10 days' from t returning user_id
        ), m as (
          insert into team_members (team_id, user_id, role) select t.id, u.id, case when u.id = t.created_by then 'owner' else 'member' end
          from t join lt_users o on o.id = t.created_by join lt_users u on u.n between o.n and o.n + 4 on conflict do nothing returning team_id, user_id
        )
        insert into seat_assignments (owner_user_id, user_id, team_id) select t.created_by, m.user_id, m.team_id from m join t on t.id = m.team_id where m.user_id <> t.created_by on conflict do nothing`);
      await tx`insert into subscriptions (user_id, plan, status, billing_anchor) select id, 'pro', 'active', now() - interval '3 days' from lt_users where n % 3 = 0 and n % 30 <> 1 on conflict (user_id) do nothing`;
      await step("company records", seedCompanies(tx));
    });
    await sql`analyze`;
    console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    await sql.end();
  }
}

/** Company records for the tickers the load asks for, as the app caches them (six hours, refreshed by the seed). */
function seedCompanies(tx) {
  const tickers = { AAPL: "Apple Inc.", NVDA: "NVIDIA Corp", XOM: "Exxon Mobil Corp", JPM: "JPMorgan Chase & Co", KO: "Coca-Cola Co", MSFT: "Microsoft Corp" };
  const rows = Object.entries(tickers).map(([ticker, name], i) => ({
    ticker,
    data: {
      ticker, name, cik: String(320193 + i).padStart(10, "0"), sic: "3571", sicLabel: "Seeded industry", exchange: "NASDAQ", hq: "Somewhere, CA", fye: "Sep 30", fyeMMDD: "0930",
      description: "A seeded company record for the load test. ".repeat(10), industry: "Seeded", website: "https://loadtest.invalid",
      price: { last: 100 + i, change: 1, changePct: 1, marketCap: 1e6, low52: 80, high52: 140, asOf: new Date().toISOString() },
      ltm: { periodEnd: "2026-06-30", revenue: 100000, priorRevenue: 90000, grossProfit: 45000, operatingIncome: 30000, da: 3000, sbc: 2000, ebitda: 33000, adjEbitda: 35000, operatingCashFlow: 32000, capex: 4000, netIncome: 25000 },
      balance: { asOf: "2026-06-30", cash: 50000, debt: 40000, sharesOut: 15000 },
      estimates: { ntmRevenue: null, ntmEbitda: null, source: null },
      quarters: Array.from({ length: 8 }, (_, q) => ({ end: `2026-0${(q % 4) + 1}-30`, revenue: 25000 + q, label: `Q${(q % 4) + 1}` })),
      filings: Array.from({ length: 40 }, (_, f) => ({ form: f % 4 ? "8-K" : "10-Q", filed: "2026-05-01", accession: `0000320193-26-${String(f).padStart(6, "0")}`, url: "https://loadtest.invalid/filing", description: "Seeded filing" })),
      sources: { concepts: {}, notes: ["Seeded for the load test."], factsUrl: "https://loadtest.invalid", submissionsUrl: "https://loadtest.invalid" },
    },
  }));
  return Promise.all(rows.map((r) => tx`insert into company_cache (ticker, data, fetched_at) values (${r.ticker}, ${tx.json(r.data)}, now() + interval '30 days')
    on conflict (ticker) do update set data = excluded.data, fetched_at = excluded.fetched_at`));
}
