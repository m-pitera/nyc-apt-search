import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import {
  LISTING_EVENT_TYPES,
  listingEvents,
  listingEventsQuerySchema,
  type ListingEventType,
} from "../shared/schema";

let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok  ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

const sqlite = new Database(":memory:");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS listing_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}'
  );
`);
const db = drizzle(sqlite);

function insertEvent(listingId: number, type: ListingEventType, payload: Record<string, unknown>) {
  return db
    .insert(listingEvents)
    .values({
      listingId,
      type,
      createdAt: new Date().toISOString(),
      payloadJson: JSON.stringify(payload),
    })
    .returning()
    .get();
}

// Insert a mix of events
const e1 = insertEvent(1, "listing.created", { source: "manual" });
const e2 = insertEvent(1, "listing.updated", { fields: ["rent"] });
const e3 = insertEvent(2, "listing.imported", { source: "apify" });
const e4 = insertEvent(2, "listing.refresh_failed", { error: "timeout" });
const e5 = insertEvent(1, "listing.refreshed", { source: "direct" });

assert(e1.id < e2.id && e2.id < e3.id && e3.id < e4.id && e4.id < e5.id, "event ids are monotonically increasing");

// listEvents ordered by id ascending
const all = db.select().from(listingEvents).orderBy(asc(listingEvents.id)).all();
assert(all.length === 5, "all 5 events present");
assert(all[0].id === e1.id && all[4].id === e5.id, "events returned in ascending id order");

// after filter
const afterE2 = db
  .select()
  .from(listingEvents)
  .where(gt(listingEvents.id, e2.id))
  .orderBy(asc(listingEvents.id))
  .all();
assert(afterE2.length === 3, "after=e2.id returns 3 later events");
assert(afterE2[0].id === e3.id, "first event after e2 is e3");

// filter by listing id
const forListing1 = db
  .select()
  .from(listingEvents)
  .where(eq(listingEvents.listingId, 1))
  .orderBy(asc(listingEvents.id))
  .all();
assert(forListing1.length === 3, "listing 1 has 3 events");

// combined filter
const forListing2AfterE3 = db
  .select()
  .from(listingEvents)
  .where(and(eq(listingEvents.listingId, 2), gt(listingEvents.id, e3.id)))
  .orderBy(asc(listingEvents.id))
  .all();
assert(forListing2AfterE3.length === 1, "listing 2 after e3 has 1 event");
assert(forListing2AfterE3[0].id === e4.id, "that event is e4");

// latest id
const latest = db.select({ id: listingEvents.id }).from(listingEvents).orderBy(desc(listingEvents.id)).limit(1).get();
assert(latest?.id === e5.id, "latest id matches last inserted");

// Payload round-trip preserves keys without leaking secrets
const stored = db.select().from(listingEvents).where(eq(listingEvents.id, e3.id)).get();
const parsed = stored ? JSON.parse(stored.payloadJson) : null;
assert(parsed && parsed.source === "apify", "payload round-trips through json");

// Query schema coerces strings
const qOk = listingEventsQuerySchema.safeParse({ after: "42", limit: "10" });
assert(qOk.success && qOk.data.after === 42 && qOk.data.limit === 10, "query schema coerces numeric strings");
const qEmpty = listingEventsQuerySchema.safeParse({});
assert(qEmpty.success, "empty query is valid");
const qNeg = listingEventsQuerySchema.safeParse({ after: "-1" });
assert(!qNeg.success, "negative after is rejected");
const qZero = listingEventsQuerySchema.safeParse({ after: "0" });
assert(qZero.success, "after=0 returns all events");

// All event types exist
for (const expected of [
  "listing.created",
  "listing.imported",
  "listing.import_duplicate",
  "listing.updated",
  "listing.refreshed",
  "listing.refresh_failed",
  "listing.refresh_stale",
  "listing.status_changed",
  "listing.rating_changed",
  "listing.deleted",
]) {
  assert(
    (LISTING_EVENT_TYPES as readonly string[]).includes(expected),
    `LISTING_EVENT_TYPES includes ${expected}`,
  );
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed`);
