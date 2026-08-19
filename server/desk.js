// What one desk actually needs told, in figures, before anything is written
// about it. Every number here comes out of a query against the index; nothing
// in this file estimates, rounds or guesses. The language model downstream is
// handed these and told to write them up — it is never the thing that counts.
//
// Keeping the counting here, separate from the writing, is what makes the AI
// switchable. With the model off the same figures render as a plain list, and
// the desk is no worse informed, only less conversational.

const CUSTODY_ROLES = ["farmer", "processor", "distributor", "retailer"];

const DAY = 86400;

/** A single line of the briefing: a label, its figure, and how alarming it is. */
const fact = (label, value, tone = "neutral", detail = null) => ({ label, value, tone, detail });

export function deskBriefing(db, participant) {
  const roles = participant.roles ?? [];
  const address = participant.address;
  const one = (sql, params = {}) => db.prepare(sql).get(params)?.n ?? 0;
  const rows = (sql, params = {}) => db.prepare(sql).all(params);

  // Sold, destroyed, and lots consumed by a split have nothing left to do with
  // them; counting them would pad every figure here with settled history.
  const LIVE = "stage < 5 AND NOT (CAST(quantity AS INTEGER) = 0 AND children != '[]')";

  const facts = [];
  const holdsCustody = roles.some((r) => CUSTODY_ROLES.includes(r));

  if (holdsCustody) {
    const held = one(`SELECT COUNT(*) AS n FROM batches WHERE LOWER(custodian) = @a AND ${LIVE}`, { a: address.toLowerCase() });
    facts.push(fact("Lots you hold", held));

    const inTransit = one(`SELECT COUNT(*) AS n FROM batches WHERE LOWER(custodian) = @a AND stage = 3`, { a: address.toLowerCase() });
    if (inTransit) facts.push(fact("Moving now", inTransit));

    // The handshake, from this desk's side. These two are different jobs: one
    // is work you owe someone, the other is work you are owed.
    const yours = rows(
      `SELECT id, produce_type, variety, pending_round FROM batches WHERE LOWER(pending_awaiting) = @a ORDER BY id`,
      { a: address.toLowerCase() }
    );
    if (yours.length) {
      facts.push(
        fact("Deals waiting on your signature", yours.length, "warn", yours.map((r) => `#${r.id} ${r.produce_type}${Number(r.pending_round) > 1 ? ` (countered, round ${r.pending_round})` : ""}`).join(", "))
      );
    }

    const theirs = rows(
      `SELECT id, produce_type, pending_awaiting FROM batches
       WHERE pending_custodian IS NOT NULL AND LOWER(pending_awaiting) != @a
         AND (LOWER(custodian) = @a OR LOWER(pending_custodian) = @a)
       ORDER BY id`,
      { a: address.toLowerCase() }
    );
    if (theirs.length) facts.push(fact("Offers you are waiting on", theirs.length, "neutral", theirs.map((r) => `#${r.id}`).join(", ")));

    // Reported even at zero, deliberately. A model handed only the problems it
    // has will happily write "and nothing else is wrong" off its own bat, which
    // is an inference, not a reading. Stating the absence makes it a reading.
    const trouble = rows(
      `SELECT id, produce_type, recalled, cold_chain_breached FROM batches
       WHERE LOWER(custodian) = @a AND ${LIVE} AND (recalled = 1 OR cold_chain_breached = 1)`,
      { a: address.toLowerCase() }
    );
    facts.push(
      fact("Lots you hold that are recalled or have a broken cold chain", trouble.length, trouble.length ? "bad" : "good",
        trouble.length ? trouble.map((r) => `#${r.id} ${r.recalled ? "recalled" : "cold chain broken"}`).join(", ") : null)
    );
  }

  if (roles.includes("farmer")) {
    const grown = one("SELECT COUNT(*) AS n FROM batches WHERE LOWER(origin_farm) = @a", { a: address.toLowerCase() });
    facts.push(fact("Lots you have registered", grown));
    const downstream = rows(
      `SELECT id FROM batches WHERE LOWER(origin_farm) = @a AND recalled = 1`,
      { a: address.toLowerCase() }
    );
    facts.push(
      fact("Your produce under recall anywhere on the chain", downstream.length, downstream.length ? "bad" : "good",
        downstream.length ? downstream.map((r) => `#${r.id}`).join(", ") : null)
    );
  }

  if (roles.includes("retailer")) {
    const shelf = rows(
      `SELECT id, produce_type, CAST(quantity AS INTEGER) - CAST(sold_quantity AS INTEGER) AS left_over
       FROM batches WHERE LOWER(custodian) = @a AND stage = 4 AND recalled = 0`,
      { a: address.toLowerCase() }
    );
    if (shelf.length) {
      facts.push(fact("On your shelves", shelf.length, "neutral", `${shelf.reduce((sum, r) => sum + r.left_over, 0).toLocaleString()} units unsold`));
    }
    const dangerous = one(
      `SELECT COUNT(*) AS n FROM batches WHERE LOWER(custodian) = @a AND recalled = 1 AND stage < 5`,
      { a: address.toLowerCase() }
    );
    if (dangerous) facts.push(fact("Recalled stock still with you", dangerous, "bad", "must not be sold"));
  }

  if (roles.includes("certifier")) {
    facts.push(fact("Lots on the ledger with no certification yet", one(`SELECT COUNT(*) AS n FROM batches WHERE cert_count = 0 AND recalled = 0 AND ${LIVE}`)));
    facts.push(fact("Certifications you have issued", one("SELECT COUNT(*) AS n FROM events WHERE name = 'BatchCertified' AND LOWER(actor) = @a", { a: address.toLowerCase() })));
    const expiring = rows(
      `SELECT batch_id, args FROM events WHERE name = 'BatchCertified' AND LOWER(actor) = @a`,
      { a: address.toLowerCase() }
    ).filter((e) => {
      const expiresAt = Number(JSON.parse(e.args).expiresAt ?? 0);
      return expiresAt > 0 && expiresAt < Math.floor(Date.now() / 1000) + 30 * DAY;
    });
    if (expiring.length) facts.push(fact("Your certifications expiring within 30 days", expiring.length, "warn", expiring.map((e) => `#${e.batch_id}`).join(", ")));
  }

  if (roles.includes("inspector")) {
    facts.push(fact("Lots on the ledger nobody has inspected yet", one(`SELECT COUNT(*) AS n FROM batches WHERE inspection_count = 0 AND recalled = 0 AND ${LIVE}`)));
    const flagged = rows(`SELECT id, recalled, cold_chain_breached, failed_inspections FROM batches WHERE ${LIVE} AND (recalled = 1 OR cold_chain_breached = 1 OR failed_inspections > 0) ORDER BY id`);
    if (flagged.length) facts.push(fact("Lots on the ledger carrying a flag", flagged.length, "warn", flagged.map((r) => `#${r.id}`).join(", ")));
    facts.push(fact("Recalls you have opened", one("SELECT COUNT(*) AS n FROM events WHERE name = 'RecallInitiated' AND LOWER(actor) = @a", { a: address.toLowerCase() })));
  }

  if (roles.includes("oracle")) {
    facts.push(fact("Lots on the ledger under a cold-chain requirement", one(`SELECT COUNT(*) AS n FROM batches WHERE cold_chain_required = 1 AND ${LIVE}`)));
    const silent = rows(`SELECT id, produce_type FROM batches WHERE cold_chain_required = 1 AND telemetry_count = 0 AND ${LIVE} ORDER BY id`);
    if (silent.length) facts.push(fact("Cold-chain lots on the ledger with no reading at all", silent.length, "warn", silent.map((r) => `#${r.id}`).join(", ")));
    facts.push(fact("Lots on the ledger with a breach on record", one("SELECT COUNT(*) AS n FROM batches WHERE cold_chain_breached = 1"), "bad"));
  }

  if (roles.includes("admin")) {
    facts.push(fact("Lots on the ledger", one("SELECT COUNT(*) AS n FROM batches")));
    facts.push(fact("Lots under recall", one("SELECT COUNT(*) AS n FROM batches WHERE recalled = 1"), "bad"));
    facts.push(fact("Lots with a broken cold chain", one("SELECT COUNT(*) AS n FROM batches WHERE cold_chain_breached = 1"), "warn"));
    facts.push(fact("Lots whose handover was never signed off", one("SELECT COUNT(*) AS n FROM batches WHERE custody_intact = 0"), "warn"));
    facts.push(fact("Participants enrolled", one("SELECT COUNT(*) AS n FROM participants WHERE active = 1")));
  }

  // Anything that happened on this desk's lots since yesterday, so the briefing
  // can lead with movement rather than with standing totals.
  const since = Math.floor(Date.now() / 1000) - DAY;
  const recent = db
    .prepare(`
      SELECT e.name, e.batch_id FROM events e LEFT JOIN batches b ON b.id = e.batch_id
      WHERE e.ts >= @since AND (LOWER(e.actor) = @a OR LOWER(b.custodian) = @a OR LOWER(b.origin_farm) = @a)
    `)
    .all({ since, a: address.toLowerCase() });
  facts.push(fact("Ledger entries touching you in the last 24 hours", recent.length));

  return {
    participant: { name: participant.name, roles, location: participant.location },
    facts
  };
}

/** The briefing as plain lines, which is also exactly what the model is given. */
export function briefingLines(briefing) {
  return briefing.facts.map((f) => `${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ""}`);
}
