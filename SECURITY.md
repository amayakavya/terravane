# Security

The contracts in this repository have not been audited. Treat them as a reference
implementation, not as production food-safety infrastructure.

## Reporting

Open a private security advisory through the GitHub Security tab. Please do not
file a public issue for anything exploitable.

## Trust model

The chain is permissioned. `AccessRegistry` is the sole source of authority, and
`ProduceRegistry` treats it as trusted: it never validates the registry's answers,
only asks. Whoever controls an admin key controls enrolment, suspension and the
emergency pause. That is the intended shape for a consortium chain run by a
regulator or a trade body, and it is the wrong shape for a permissionless network.

`ProduceRegistry` holds no funds and makes no external calls other than view calls
into the registry it was constructed with, so there is no reentrancy surface.

## Known limitations

**Off-chain payloads are unverified.** Agronomy records, certificates, bills of
lading and sensor payloads are referenced by URI and digest. The contracts cannot
check that the digest matches anything real, and they do not try. A consumer of
this data must fetch the payload and hash it themselves.

**Telemetry is only as honest as its reporter.** The contract decides whether a
reading counts as an excursion, but it cannot know whether the reading was taken
from the pallet or from somebody's desk. Cold-chain integrity here means the
gateway's claims were recorded immutably, not that they were true.

**Geohash precision is the writer's choice.** A seven-character geohash locates a
farm to roughly 150 metres. Anyone who needs to disclose a region without
disclosing a gate must truncate before writing, because nothing on chain can be
retracted afterwards.

**Recall propagation is operator-driven.** The contract proves that each lot in a
propagation call really descends from the recalled root, so no unrelated lot can be
frozen. It cannot force an operator to submit the complete set. A partial recall is
possible if the caller supplies a partial list, which is why the API computes the
full descendant closure from the index rather than trusting an operator to type it.

**Unbounded views.** `verify()` and the certification and telemetry getters iterate
whole arrays. They are `view` and free over RPC, but a lot with thousands of sensor
readings will eventually exceed a node's gas cap for `eth_call`. Reading telemetry
in pages is the fix if that day arrives.

**Development keys.** The server signs with the standard Hardhat mnemonic so the
console can act as any participant without a browser wallet. Signing refuses
outright unless the RPC endpoint is loopback, and `TERRAVANE_SIGNING=off` disables
it entirely. Against any real network this path must be replaced with signatures
produced on the participant's own device.

## Invariants worth keeping

These are enforced by the contracts and covered by the test suite. Breaking one is
a security bug, not a behaviour change.

- A split accounts for its parent exactly, and a merge cannot count the same lot
  twice. Quantity is never created.
- Custody only moves when the recipient countersigns, and only to a participant
  holding a role that can legally hold produce.
- A cold-chain breach latches. No later reading clears it.
- Stages only move forward, and only for a custodian holding the role that stage
  requires.
- The registry always retains at least one admin that is both role-holding and in
  good standing.
- A recalled lot cannot move, split, merge or be sold.
