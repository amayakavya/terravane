# Terravane

[![ci](https://github.com/amayakavya/terravane/actions/workflows/ci.yml/badge.svg)](https://github.com/amayakavya/terravane/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-006947)](LICENSE)

A permissioned provenance ledger for agricultural produce, with the working
interface the people in that chain actually use. A lot is minted at the farm gate,
changes hands under countersigned custody transfers, splits and merges as it is
processed, carries certifications and inspection results, streams cold-chain
telemetry, and can be recalled through every descendant lot it ever became. A
shopper scans the QR code on the packet and gets the whole record.

Two Solidity contracts, an event indexer, a content-addressed document store, a
REST API, a role-based console in two languages, a public trace page and a
printable pack label. It runs against a local Hardhat chain and makes no requests
to anything outside itself: fonts, icons and map outlines are all served locally.

![Operator dashboard](docs/dashboard.png)

## Quick start

```bash
npm install
npm run stack        # compile contracts, build CSS, chain, deploy, seed, serve
```

Open <http://localhost:4300>, pick a role and an organisation, and you are in.
Add `--fresh` to wipe the previous index and deployment first.

```bash
npm test             # 58 contract tests
npm run size         # contract sizes against the 24,576 byte deployment limit
npm run smoke        # 52 end to end checks against a running stack
npm run checkui      # loads all 16 pages in a real browser and fails on any error
```

## The problem this shape solves

Food fraud and food recalls are both custody problems. A crate of mangoes passes
through five hands, and by the time somebody is ill nobody can say which farm,
which reefer, or which of the forty sub-lots that consignment became. Paper trails
get reconciled after the fact by the parties with the most to lose from an honest
answer.

Putting it on a permissioned chain does not make anyone honest. What it does is
make the record append-only, make every claim attributable to a licensed party,
and make the recall reach computable in seconds instead of days.

## What is on chain

Two contracts, no external dependencies.

**`AccessRegistry`** decides who may do what. Participants hold a role bitmask
(farmer, processor, distributor, retailer, certifier, inspector, oracle, admin),
because a co-operative is routinely two of those at once and a mapping per role
would cost a storage slot each. Admins enrol, grant, revoke and suspend.

**`ProduceRegistry`** is the ledger itself.

| Concern | How it works |
| --- | --- |
| Origination | Only an active farmer mints a lot: quantity, unit, variety, harvest time, origin geohash, and a digest of the off-chain record. |
| Custody | Two steps. The holder proposes, the recipient countersigns. Recipients must hold a role that can legally take produce. |
| Lifecycle | `Harvested → Processed → Packed → InTransit → AtRetail`, monotonic, each step gated on the custodian holding the role that step requires. Sale and destruction have their own entry points because they carry extra evidence. |
| Transformation | `splitBatch` requires the children to account for the parent exactly. `mergeBatches` refuses to mix produce types or units, and cannot count the same lot twice. |
| Cold chain | A lot may declare a permitted temperature band. The contract decides whether a reading is an excursion, and the breach latches. |
| Certification | Certifiers attach schemes to a lot or to a farm, with expiry, evidence URI and digest. Revocation is recorded with a reason, never deleted. |
| Inspection | Inspectors record a 0 to 100 grade, a pass flag, findings and a report digest. |
| Recall | Inspectors, admins or the originating farm can pull a lot. Propagation to derived lots is caller-supplied and contract-verified. |
| Consumer answer | `verify(batchId)` returns one flat struct: recalled, cold chain breached, custody intact, active certifications, failed inspections, chain length. |

### Seven decisions worth explaining

**Custody moves in two steps.** A one-step push would let a distributor dump a
spoiled lot onto a retailer who never agreed to take it, and liability would move
with it. The recipient countersigns or the lot stays where it is. An unsettled
handover shows up as a custody gap, which is exactly the state a regulator wants
to see.

**A split must account for its parent exactly, and a merge cannot double count.**
Unexplained shrinkage is the fraud this exists to stop, and inflation is the same
fraud pointing the other way. The merge consumes each input in the same pass that
counts it, so a lot id repeated in the input reads as zero on its second visit and
is rejected. Quantity is never created.

**The contract decides what an excursion is, not the reporter.** A gateway pushes a
temperature and the contract compares it against the band the lot declared at
harvest. Once breached, the flag latches. A later good reading cannot scrub the
record, and a merged lot inherits the worst history of its inputs.

**Recall propagation is proposed off chain and proved on chain.** Crawling a
descendant tree on chain is unbounded gas. Instead the indexer computes the
descendant closure and the contract re-proves that every lot in the call really
descends from the recalled root before marking it. An operator cannot freeze an
unrelated competitor's lot.

**Price and grade live off chain, but cannot be restated.** Commercial attributes
do not belong in contract storage: they are long strings and every byte is gas.
They also cannot simply live in a database, or a distributor could quietly change
the grade of a lot after a buyer had seen it. So they are written to a
content-addressed store and the lot commits to the hash. Reading a lot back
recomputes the hash and says plainly whether the attributes still match. Change a
price behind the ledger's back and the interface says so, in red, on the consumer
page.

**Lineage is stored in both directions.** A recall walks downward and an audit
walks upward. Deriving either direction from the other costs a scan nobody can
afford, so both edges are written at transformation time.

**The registry can never lose its last admin.** The count tracks admins that both
hold the role and are in good standing. Counting the role alone would let two
suspended admins stand in for a live one, and a chain with nobody able to enrol or
reinstate anyone is a dead chain.

### Tests

58 tests across the access model, origination, custody, lifecycle, telemetry,
certification, transformation, recall and pause. They assert the refusals as hard
as the happy paths: non-custodian transfers, unfit recipients, backwards stages,
unaccounted splits, duplicated merge inputs, non-descendant recall propagation,
out-of-range grades, and the last-admin lockout.

`ProduceRegistry` compiles to 23,888 bytes of deployed bytecode against the
24,576 byte limit, with the optimizer at `runs: 1` and `viaIR` enabled.
`npm run size` fails the build if that headroom is ever spent.

## Off chain

**Indexer.** Backfills and then polls contract logs into SQLite. The database is an
index and never the record: whenever an event touches a lot, that lot is re-read
straight from the contract rather than patched from the event payload, so the
index cannot drift into a lie. Delete `data/` and it rebuilds from the chain.

**Document store.** Content-addressed attributes, keyed by the keccak hash of their
canonical serialisation. `POST /api/documents` returns the address, the batch
commits to it, and `GET /api/batches/:id` returns the attributes with a verdict on
whether they still hash to what the chain recorded.

**API.**

```
GET  /api/health                    chain head, indexed block, readiness
GET  /api/stats                     counts by stage, produce and flag
GET  /api/batches?q=&stage=&flag=   flag: clean | recalled | breached | open
GET  /api/batches/:id               full dossier, read from chain
GET  /api/batches/:id/lineage       parents and children as a graph
GET  /api/batches/:id/descendants   what a recall would have to reach
GET  /api/notifications?as=         the ledger, filtered to one participant
GET  /api/documents/:hash           a committed attribute document
GET  /api/trace/:id                 the consumer answer, with a verdict
GET  /api/qr/:id                    SVG QR pointing at the trace page
```

Write endpoints live under `/api/actions/*` and cover harvest, transfer, accept,
cancel, stage, telemetry, certify, inspect, split, merge, sell, recall, destroy and
pause. Reverts are decoded back to the contract's error name, so a rejected action
reads `NotCustodian` rather than `execution reverted`.

**Signing.** The node holds the standard Hardhat development keys so the console
can act as any participant without a browser wallet. That is only defensible
against a local chain, so signing refuses outright unless the RPC endpoint is
loopback, and `TERRAVANE_SIGNING=off` disables it entirely. The sign-in page says
so rather than dressing it up as a login. Against any real network this path must
be replaced with signatures produced on the participant's own device.

## The interface

Sign in by choosing a role and an organisation enrolled on the chain. Every page is
available in English and Hindi.

![Sign in](docs/signin.png)

One dashboard adapts to whichever roles the signed-in participant holds, rather
than four near-identical pages that drift apart. It carries what they hold, what is
in transit, what needs attention, anything waiting on their signature, and the
whole network on a map.

The lot dossier is six tabs: overview with the committed attributes and their
verdict, the route, the timeline, the lineage graph, the cold chain, and the
actions this participant is actually allowed to take on this lot.

![Lot dossier](docs/lot.png)

The route tab puts a lot's custody trail on a map, with distance travelled, days
since harvest and every sensor reading in place. Excursions are the red points.

![Route of a lot with a cold chain breach](docs/route.png)

The lineage tab draws the transformation graph. Below, a tea harvest that failed a
residue test, recalled at the root and propagated through two generations.

![Lineage after a recall](docs/lineage.png)

Before signing a recall, the actions panel names every lot the recall will reach,
worked out from the index and re-proved by the contract when it is submitted.

The public trace page needs no sign-in, because the point is that the record is
public. Verdict first, then the warnings behind it, then provenance, the committed
attributes with their verification, where it travelled, certifications in force,
the journey, the temperature record and how the lot was made up from its parents.

<img src="docs/trace.png" alt="Consumer trace page" width="420">

There is also a printable pack label: lot number, origin, harvest date, storage
window, certifications and the QR code back to the full record.

![Printable pack label](docs/label.png)

### Nothing is loaded from a third party

Tailwind is compiled at build time, not pulled from a CDN. The four webfonts are
self-hosted. The icons ship as inline SVG path data rather than an icon font, so a
page with no network shows icons instead of the literal word "notifications" in
forty places. The map outlines are a simplified Natural Earth polygon set shipped
as a module, so there is no tile server. `npm run assets` and `npm run basemap`
regenerate those, and the output is committed.

A dashboard that renders unstyled when the connection drops is not a dashboard you
can run a recall from.

### Verifying the interface

`npm run checkui` drives Chrome over the DevTools Protocol using Node's built-in
WebSocket, with no added dependency. It loads all sixteen pages, seeds a session,
and fails on any console error, uncaught rejection, failed request, empty view or
horizontal overflow. `node scripts/checkui.js --shots docs` regenerates the images
in this README from the same run that proved the pages work.

## Seeded data

`npm run seed` drives five threads through the contracts so nothing in the console
is a placeholder:

1. Basmati from Karnal, milled at Panipat, split three ways, two lots retailed and partly sold.
2. Alphonso mangoes under an 8 to 13 degree band, with a reefer failure near Pune that latches a breach and a failed inspection at the far end.
3. Nilgiri tea that fails a residue test, is recalled at severity 3, propagates through two generations of descendants, and has one lot destroyed under supervision.
4. A co-operative that both grows and processes, merging two wheat lots and selling the blend out.
5. A handover offered and never countersigned, so the console has a live custody gap to show.

Each harvest also writes its commercial attributes through the document store, so
the verification path is exercised by the demo data and not only by the tests.

## Layout

```
contracts/   AccessRegistry, ProduceRegistry, IAccessRegistry
test/        58 mocha tests
scripts/     deploy, seed, stack runner, smoke suite, browser check, asset builds
server/      SQLite schema, event indexer, document store, read API, write actions
web/         console, public trace and pack label; vanilla ES modules, no framework
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `TERRAVANE_RPC` | `http://127.0.0.1:8545` | Chain endpoint |
| `TERRAVANE_MNEMONIC` | Hardhat dev phrase | Development signer derivation |
| `TERRAVANE_SIGNING` | on for loopback | Set `off` to make the API read only |
| `TERRAVANE_PUBLIC_URL` | request host | Base URL encoded into QR codes |
| `PORT` | `4300` | API and UI port |
| `CHROME_PATH` | autodetected | Browser used by `npm run checkui` |

## Limits

The contracts are unaudited, the document store proves integrity but not truth,
and telemetry is only as honest as the gateway that reports it.
[SECURITY.md](SECURITY.md) sets out the trust model, the known limitations and the
invariants that count as security bugs if they ever break.

## Credits

Map outlines from [Natural Earth](https://www.naturalearthdata.com/), public
domain. Icons from [Material Symbols](https://fonts.google.com/icons), Apache
License 2.0. Manrope, Work Sans, Petrona and JetBrains Mono under the SIL Open Font
License 1.1. The interface design and the Hindi localisation were merged in from
work by [@viraj-rgb](https://github.com/viraj-rgb).

## License

MIT. See [LICENSE](LICENSE).
