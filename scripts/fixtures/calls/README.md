Call Desk (E5) fixtures. `transcript-filed.txt` is a constructed earnings-call transcript in the style companies file as 8-K
exhibits (EX-99.2) on EDGAR; `transcript-diarized.json` is a constructed recording's speaker turns (Parakeet with names guessed
from the call, one speaker left unnamed); `release.txt` a constructed earnings release. The companies are fictional. The
build sandbox could not reach EDGAR, so these stand in for real filed transcripts until they are added. `qa-labels.jsonl` is
the labelled Q&A template set written by scripts/gen-calls-fixture.ts (see its header): a starting point, replaced as real
filed pairs are labelled.
