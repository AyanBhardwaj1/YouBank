Merger documents for the Precedent Engine's parser tests (scripts/test-edge-next.ts). The companies are
fictional and the figures invented: these are constructed in the layouts real filings use, because the
build sandbox could not reach EDGAR. Replace or add real saved proxies (trimmed to their sections) when
working with network access; the tests read whatever files the list in the test names.

- proxy-workiva.html: a DEFM14A in the Workiva layout (contents in a table, bold paragraph headings, a summary
  whose cross-references name sections with page numbers, a projections table).
- proxy-caps.html: a DEFM14A with capitalised headings in <b> tags, a go-shop, and a stock-and-cash deal.
- sc14d9.html: a tender offer recommendation (SC 14D9) with "Background of the Offer and the Merger".
- efts-hits.json: EDGAR full-text search hits (a proxy with its exhibits, a joint proxy, an 8-K with its
  merger agreement and press release, an 8-K without Item 1.01, a 14D-9).
- labels.jsonl: fields from these documents checked by hand (deal, field, the right value), for the
  confidence calibration's first labelled set.
