# Terravane — SIH Idea Presentation Content

## Slide 2: Proposed Solution

### Detailed explanation
Terravane — permissioned blockchain ledger tracking produce farm to consumer. Two Solidity contracts: `AccessRegistry` (role enrollment: farmer/processor/distributor/retailer/certifier/inspector/oracle/admin) + `ProduceRegistry` (harvest, custody transfer, split/merge, telemetry, certify, inspect, recall). Custody moves only via two-step signed handover (propose then countersign) — no unilateral dump of bad lot onto next holder. Off-chain: SQLite indexer (never source of truth, always re-reads chain), content-addressed document store for price/grade (hash committed on-chain, tampering visible). Consumer scans QR, gets full trace, no login needed.

### How it addresses the problem
Food fraud/recall = custody problem. Paper trail reconciled after the fact by the party with the most to lose from an honest answer. Chain makes record append-only, every claim attributable to a licensed party, recall reach computable in seconds not days. Cold-chain breach latches permanently once flagged — can't scrub a bad reading later.

### Innovation and uniqueness
Automatic multi-hop recall — one root lot recalled, propagates through every split/merge descendant automatically (proved on-chain, not manually chased). Split must account for parent quantity exactly, merge can't double-count — kills quantity fraud both directions. Price/grade off-chain but hash-committed — change data behind the ledger's back, interface flags it red. Already a working prototype, not a concept: 58 contract tests, seeded 61 transactions across 14 batches, full console + public trace page live.

---

## Slide 3: Technical Approach

### Technologies used
- Solidity (smart contracts) + Hardhat (dev/test/deploy chain)
- ethers.js (chain interaction)
- Node.js + Express (REST API, indexer)
- SQLite (event index/cache layer, never source of truth)
- Vanilla JS + Tailwind CSS (web console, no framework)
- QR code generation (`qrcode` lib) for consumer trace page

### Methodology / process flow
1. Farmer harvest → mint lot on `ProduceRegistry` (qty, variety, origin, harvest time)
2. Custody hop: holder proposes transfer → recipient countersigns accept (two-step signed handover)
3. Lifecycle stage gate: Harvested → Processed → Packed → InTransit → AtRetail, each gated by role
4. Parallel attach: Certifier certifies, Inspector grades/pass-fails, Sensor gateway pushes cold-chain telemetry
5. Split/merge lot as processed — lineage recorded both directions (parent↔child)
6. Event emitted on-chain → indexer backfills/polls into SQLite → API serves read side
7. If inspection fails → recall root → indexer computes descendant closure → contract re-verifies + propagates through every derived lot
8. Consumer scans QR → public trace page → live-reads straight from chain (verdict, recall status, cold-chain, certs)

Flowchart shape: `Farmer → Processor → Distributor → Retailer → Consumer` left-right, with Certifier/Inspector/Sensor Gateway branching in at each stage, "propose → accept" callout between hops.

---

## Slide 4: Feasibility and Viability

### Feasibility analysis
Not a concept — working prototype today. 58 passing contract tests, deployed local permissioned chain, seeded full season data (61 transactions, 14 batches: rice split scenario, mango cold-chain breach, tea recall propagating through 4 descendants, wheat co-op merge). Full operator console + public consumer trace page both functional end-to-end, not mockups. Contract size stays under Ethereum's 24,576-byte deploy limit, checked automatically in build.

### Challenges and risks
1. Onboarding real farmers/processors — no prior crypto experience, wallet/key management scary
2. Off-chain index trustworthy — cache could drift from chain truth
3. Garbage-in-garbage-out — certifier/inspector could falsify a claim, telemetry gateway could lie
4. Permissioned chain needs trusted admin to enroll participants — single point of gatekeeping

### Mitigation strategies
1. Identity = registered chain address only. Node signs for user with enrolled key — feels like picking org from a list, not managing a crypto wallet
2. Index never trusted as truth — every lot view re-reads straight from the contract, index is just a cache/search layer
3. Every certification/inspection tied to a specific enrolled, named organization — false claim is attributable and revocable, even if system can't independently verify physical truth
4. Admin role bitmask model — co-op can hold multiple roles, last-admin lockout protection built into contract (can't strand chain with zero live admin)

---

## Slide 5: Impact and Benefits

### Impact on target audience
- Farmers: provable provenance + certification → command trust/price premium, protected against counterfeit cert undercutting them
- Distributors/retailers: instant verifiable custody record, no manual paperwork reconciliation
- Consumers: scan QR, see exact farm, cold-chain history, cert status, any active recall/breach warning before buying
- Regulators: network-wide recall-by-region + cold-chain-breach-by-region view, live from chain (Admin Regulator View, already built)

### Benefits
**Social** — faster targeted recall (down to exact sub-lot) instead of blanket withdrawal punishing innocent batches. Consumer trust restored through transparency, not paperwork promise.

**Economic** — reduces fraud + counterfeit certification undercutting honest farmers. Distributor/retailer save reconciliation cost/time.

**Environmental** — cold-chain telemetry catches temperature breach before spoiled produce reaches shelf, cuts waste. Per-lot food-miles CO2e estimate on Route tab, computed from actual custody-hop distance (already working, not roadmap).

**Forward-looking (roadmap bullet)**: eNAM marketplace integration, Agristack/Farmer ID mapping, FPO co-operative account support — scope narrow today by design, API already shaped for these.

---

## Slide 6: Research and References

- Working open-source prototype: github.com/amayakavya/terravane
- Documented architecture in repo README.md — on-chain/off-chain data boundary, recall propagation logic, cold-chain telemetry model
- Security/trust model: SECURITY.md
- Solidity contracts: contracts/ — `AccessRegistry`, `ProduceRegistry`, `IAccessRegistry`
- Test suite (58 tests): test/
- Standards referenced for roadmap integration — eNAM (National Agriculture Market), Agristack/Farmer ID (Digital Agriculture Mission, Govt of India)

Note: no external academic paper cited — project is a self-contained working prototype, repo itself is the primary reference.
