import {
  USER_OWNED_LISTING_FIELDS,
  REFRESH_STATUS_VALUES,
  refreshAllRequestSchema,
  type InsertListing,
  type ListingView,
  type UpdateListing,
} from "../shared/schema";
import { stripUserOwnedFields } from "../server/storage";
import {
  computeAverageOverallRating,
  isRefreshEligible,
  filterRefreshEligible,
  pickRefreshUrl,
  isValidHttpUrl,
  refreshListing,
  summarizeBulkRefresh,
  DEFAULT_REFRESH_MIN_AVERAGE_RATING,
  type BulkRefreshItem,
  type RefreshDeps,
} from "../shared/refresh";

let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok  ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`ok  ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function baseListing(overrides: Partial<ListingView> = {}): ListingView {
  return {
    id: 1,
    link: "https://streeteasy.com/rental/123",
    canonicalLink: "https://streeteasy.com/rental/123",
    neighborhood: "Chelsea",
    borough: "Manhattan",
    buildingTitle: "Test Building",
    rent: "$3,500",
    beds: "1",
    rooms: "3",
    roomsDesc: "1 bed · 1 bath",
    bath: "1",
    sqFt: "700",
    pplxDist: "10 min",
    sevenTwoDist: "12 min",
    datePosted: "2026-04-01",
    yearBuilt: "1990",
    openRentalsCount: "5",
    listingStatus: "",
    description: "Nice apartment",
    contactName: "Agent",
    contactEmail: "agent@example.com",
    contactPhone: "555-1234",
    amenities: ["Dishwasher"],
    hasInUnitLaundry: false,
    hasInBuildingLaundry: true,
    latitude: "40.7",
    longitude: "-74.0",
    bbLizardRating: 4,
    bbLizardLocationRating: 4,
    bbLizardLayoutRating: 4,
    bbLizardOverallRating: 4,
    bbCrabRating: 5,
    bbCrabLocationRating: 5,
    bbCrabLayoutRating: 5,
    bbCrabOverallRating: 5,
    bbLizardComment: "Great",
    bbCrabComment: "Love it",
    rating: 4,
    parseStatus: "Imported",
    availability: "active",
    workflowStatus: "contacted",
    createdAt: "2026-04-01T00:00:00.000Z",
    lastScrapedAt: "",
    lastRefreshAttemptAt: "",
    lastRefreshStatus: "never",
    refreshError: "",
    lastSeenAvailableAt: "",
    ...overrides,
  };
}

// ============================================================
// stripUserOwnedFields: removes user-owned keys
// ============================================================
const scraped: Partial<InsertListing> = {
  link: "https://streeteasy.com/rental/123",
  rent: "$4,000",
  neighborhood: "Chelsea",
  bbLizardOverallRating: 1,
  bbCrabOverallRating: 1,
  bbLizardComment: "OVERWRITE",
  bbCrabComment: "OVERWRITE",
  rating: 0,
  availability: "inactive",
  workflowStatus: "new",
  parseStatus: "Imported via Apify.",
};

const stripped = stripUserOwnedFields(scraped);
for (const field of USER_OWNED_LISTING_FIELDS) {
  assert(!(field in stripped), `stripUserOwnedFields removes ${field}`);
}
assert((stripped as Record<string, unknown>).rent === "$4,000", "stripUserOwnedFields keeps scraped rent");
assert((stripped as Record<string, unknown>).neighborhood === "Chelsea", "stripUserOwnedFields keeps scraped neighborhood");

// ============================================================
// computeAverageOverallRating
// ============================================================
assert(
  computeAverageOverallRating(baseListing({ bbLizardOverallRating: 4, bbCrabOverallRating: 2 })) === 3,
  "average of 4 and 2 is 3",
);
assert(
  computeAverageOverallRating(baseListing({ bbLizardOverallRating: 0, bbCrabOverallRating: 4 })) === 4,
  "average ignores zero values",
);
assert(
  computeAverageOverallRating(baseListing({ bbLizardOverallRating: 0, bbCrabOverallRating: 0 })) === 0,
  "average of no ratings is 0",
);

// ============================================================
// isRefreshEligible: default requires avg >= 3 and availability=active
// ============================================================
assert(
  isRefreshEligible(baseListing({ bbLizardOverallRating: 4, bbCrabOverallRating: 4 })),
  "active with avg 4 is eligible by default",
);
assert(
  !isRefreshEligible(baseListing({ bbLizardOverallRating: 2, bbCrabOverallRating: 2 })),
  "avg below 3 is not eligible by default",
);
assert(
  !isRefreshEligible(baseListing({ availability: "inactive", bbLizardOverallRating: 5, bbCrabOverallRating: 5 })),
  "inactive listing is not eligible by default",
);
assert(
  isRefreshEligible(
    baseListing({ availability: "stale", bbLizardOverallRating: 5, bbCrabOverallRating: 5 }),
    { availability: ["active", "stale"] },
  ),
  "stale listing is eligible when explicitly allowed",
);
assert(
  isRefreshEligible(
    baseListing({ bbLizardOverallRating: 2, bbCrabOverallRating: 2 }),
    { minAverageRating: 0 },
  ),
  "zero minAverageRating admits low-rated listing",
);
assert(DEFAULT_REFRESH_MIN_AVERAGE_RATING === 3, "default min average rating is 3");

// ============================================================
// Bulk eligibility: default selection only includes active listings with avg >= 3
// ============================================================
const bulkPool: ListingView[] = [
  // Included: active + avg 4
  baseListing({ id: 1, bbLizardOverallRating: 4, bbCrabOverallRating: 4, availability: "active" }),
  // Excluded by rating: active + avg 2
  baseListing({ id: 2, bbLizardOverallRating: 2, bbCrabOverallRating: 2, availability: "active" }),
  // Excluded by availability: inactive + avg 5
  baseListing({ id: 3, availability: "inactive", bbLizardOverallRating: 5, bbCrabOverallRating: 5 }),
  // Excluded by availability: stale + avg 5
  baseListing({ id: 4, availability: "stale", bbLizardOverallRating: 5, bbCrabOverallRating: 5 }),
  // Included: active + avg exactly 3 (boundary)
  baseListing({ id: 5, bbLizardOverallRating: 3, bbCrabOverallRating: 3, availability: "active" }),
  // Excluded: active but no ratings (avg 0)
  baseListing({ id: 6, bbLizardOverallRating: 0, bbCrabOverallRating: 0, availability: "active" }),
];
const eligibleDefault = filterRefreshEligible(bulkPool);
assertEqual(
  eligibleDefault.map((l) => l.id).sort(),
  [1, 5],
  "default bulk eligibility keeps only active listings with avg overall rating >= 3",
);

const eligibleCustomMin = filterRefreshEligible(bulkPool, { minAverageRating: 4 });
assertEqual(
  eligibleCustomMin.map((l) => l.id).sort(),
  [1],
  "bulk eligibility with minAverageRating=4 excludes boundary avg 3",
);

const eligibleAllAvailability = filterRefreshEligible(bulkPool, {
  availability: ["active", "stale", "inactive"],
});
assertEqual(
  eligibleAllAvailability.map((l) => l.id).sort(),
  [1, 3, 4, 5],
  "bulk eligibility with expanded availability includes stale and inactive when rated",
);

// ============================================================
// REFRESH_STATUS_VALUES
// ============================================================
for (const expected of ["never", "refreshed", "failed", "stale"]) {
  assert(
    (REFRESH_STATUS_VALUES as readonly string[]).includes(expected),
    `REFRESH_STATUS_VALUES includes "${expected}"`,
  );
}

// ============================================================
// refreshAllRequestSchema
// ============================================================
const okParse = refreshAllRequestSchema.safeParse({ minAverageRating: 4, availability: ["active"], limit: 10 });
assert(okParse.success, "valid refresh request parses");
const badParse = refreshAllRequestSchema.safeParse({ minAverageRating: 99 });
assert(!badParse.success, "refresh request with out-of-range rating is rejected");
const emptyParse = refreshAllRequestSchema.safeParse({});
assert(emptyParse.success, "empty refresh request is valid (defaults applied)");
const idsParse = refreshAllRequestSchema.safeParse({ listingIds: [1, 2, 3] });
assert(idsParse.success, "refresh request with listingIds is valid");

// ============================================================
// pickRefreshUrl: canonicalLink preferred over link
// ============================================================
assert(
  pickRefreshUrl({
    canonicalLink: "https://streeteasy.com/rental/abc",
    link: "https://streeteasy.com/rental/abc?utm=x",
  }) === "https://streeteasy.com/rental/abc",
  "pickRefreshUrl prefers canonicalLink when present",
);
assert(
  pickRefreshUrl({
    canonicalLink: "",
    link: "https://streeteasy.com/rental/abc?utm=x",
  }) === "https://streeteasy.com/rental/abc?utm=x",
  "pickRefreshUrl falls back to raw link when canonicalLink empty",
);
assert(
  pickRefreshUrl({ canonicalLink: "   ", link: "https://streeteasy.com/rental/abc" }) ===
    "https://streeteasy.com/rental/abc",
  "pickRefreshUrl treats whitespace canonicalLink as empty",
);
assert(pickRefreshUrl({ canonicalLink: "", link: "" }) === "", "pickRefreshUrl returns empty when both missing");

// ============================================================
// isValidHttpUrl
// ============================================================
assert(isValidHttpUrl("https://streeteasy.com/rental/123"), "isValidHttpUrl accepts https");
assert(isValidHttpUrl("http://example.com"), "isValidHttpUrl accepts http");
assert(!isValidHttpUrl(""), "isValidHttpUrl rejects empty");
assert(!isValidHttpUrl("not a url"), "isValidHttpUrl rejects garbage");
assert(!isValidHttpUrl("ftp://example.com"), "isValidHttpUrl rejects non-http protocol");
assert(!isValidHttpUrl("javascript:alert(1)"), "isValidHttpUrl rejects javascript:");

// ============================================================
// refreshListing: success path preserves user-owned fields, updates scraped + metadata
// ============================================================
{
  const before = baseListing({
    id: 42,
    rent: "$3,500",
    neighborhood: "Chelsea",
    bbLizardOverallRating: 5,
    bbCrabOverallRating: 4,
    bbLizardComment: "Amazing",
    bbCrabComment: "Solid",
    rating: 5,
    availability: "active",
    workflowStatus: "contacted",
    parseStatus: "Imported",
    lastRefreshStatus: "never",
    refreshError: "",
  });
  const store = new Map<number, ListingView>([[42, before]]);
  const scrapedPayload: Partial<InsertListing> = {
    link: before.link,
    rent: "$4,200",
    neighborhood: "Chelsea",
    beds: "2",
    bbLizardOverallRating: 1,
    bbCrabOverallRating: 1,
    bbLizardComment: "SCRAPER SHOULD NOT OVERWRITE",
    bbCrabComment: "SCRAPER SHOULD NOT OVERWRITE",
    rating: 0,
    availability: "inactive",
    workflowStatus: "new",
    parseStatus: "Imported via Apify.",
  };
  let scrapeCalledWith = "";
  const deps: RefreshDeps = {
    getListing: async (id) => store.get(id),
    scrape: async (url) => {
      scrapeCalledWith = url;
      return scrapedPayload;
    },
    applyRefreshedFields: async (id, scraped, metadata) => {
      const current = store.get(id)!;
      const safe = stripUserOwnedFields(scraped);
      const amenities = "amenities" in safe
        ? (safe.amenities as unknown as string[] | string)
        : current.amenities;
      const updated: ListingView = {
        ...current,
        ...(safe as Partial<ListingView>),
        amenities: Array.isArray(amenities)
          ? amenities
          : typeof amenities === "string"
          ? JSON.parse(amenities || "[]")
          : current.amenities,
        ...(metadata as Partial<ListingView>),
      };
      store.set(id, updated);
      return updated;
    },
    updateListing: async (id, update) => {
      const current = store.get(id)!;
      const updated: ListingView = { ...current, ...(update as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
    now: () => "2026-04-22T00:00:00.000Z",
  };

  const outcome = await refreshListing(42, deps);
  assert(outcome.status === "refreshed", "successful refresh returns status=refreshed");
  assert(scrapeCalledWith === before.canonicalLink, "scrape is called with canonicalLink");

  const after = store.get(42)!;
  // User-owned fields preserved
  assert(after.bbLizardOverallRating === 5, "refresh preserves bbLizardOverallRating");
  assert(after.bbCrabOverallRating === 4, "refresh preserves bbCrabOverallRating");
  assert(after.bbLizardComment === "Amazing", "refresh preserves bbLizardComment");
  assert(after.bbCrabComment === "Solid", "refresh preserves bbCrabComment");
  assert(after.rating === 5, "refresh preserves rating");
  assert(after.availability === "active", "refresh preserves availability");
  assert(after.workflowStatus === "contacted", "refresh preserves workflowStatus");
  assert(after.parseStatus === "Imported", "refresh preserves parseStatus");
  // Scraped fields updated
  assert(after.rent === "$4,200", "refresh updates scraped rent");
  assert(after.beds === "2", "refresh updates scraped beds");
  // Metadata updated
  assert(after.lastRefreshStatus === "refreshed", "refresh sets lastRefreshStatus=refreshed");
  assert(after.lastScrapedAt === "2026-04-22T00:00:00.000Z", "refresh sets lastScrapedAt");
  assert(after.lastRefreshAttemptAt === "2026-04-22T00:00:00.000Z", "refresh sets lastRefreshAttemptAt");
  assert(after.lastSeenAvailableAt === "2026-04-22T00:00:00.000Z", "refresh sets lastSeenAvailableAt");
  assert(after.refreshError === "", "successful refresh clears refreshError");
}

// ============================================================
// refreshListing: failure path preserves listing data, sets failed + error
// ============================================================
{
  const before = baseListing({
    id: 7,
    rent: "$3,500",
    neighborhood: "Chelsea",
    bbLizardOverallRating: 5,
    bbCrabOverallRating: 5,
    bbLizardComment: "Amazing",
    bbCrabComment: "Solid",
    rating: 5,
    availability: "active",
    workflowStatus: "contacted",
    lastScrapedAt: "2026-04-01T00:00:00.000Z",
    lastRefreshStatus: "refreshed",
    refreshError: "",
    lastSeenAvailableAt: "2026-04-01T00:00:00.000Z",
  });
  const store = new Map<number, ListingView>([[7, { ...before }]]);
  const deps: RefreshDeps = {
    getListing: async (id) => store.get(id),
    scrape: async () => {
      throw new Error("Apify actor failed: proxy error");
    },
    applyRefreshedFields: async (id, _scraped, metadata) => {
      const current = store.get(id)!;
      const updated: ListingView = { ...current, ...(metadata as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
    updateListing: async (id, update) => {
      const current = store.get(id)!;
      const updated: ListingView = { ...current, ...(update as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
    now: () => "2026-04-22T01:00:00.000Z",
  };

  const outcome = await refreshListing(7, deps);
  assert(outcome.status === "failed", "failed scrape returns status=failed");
  assert(outcome.error === "Apify actor failed: proxy error", "failed outcome carries scraper error");

  const after = store.get(7)!;
  // All listing data preserved
  assert(after.rent === "$3,500", "failure preserves rent");
  assert(after.neighborhood === "Chelsea", "failure preserves neighborhood");
  assert(after.bbLizardOverallRating === 5, "failure preserves bbLizardOverallRating");
  assert(after.bbCrabOverallRating === 5, "failure preserves bbCrabOverallRating");
  assert(after.bbLizardComment === "Amazing", "failure preserves bbLizardComment");
  assert(after.bbCrabComment === "Solid", "failure preserves bbCrabComment");
  assert(after.rating === 5, "failure preserves rating");
  assert(after.availability === "active", "failure preserves availability");
  assert(after.workflowStatus === "contacted", "failure preserves workflowStatus");
  assert(after.lastScrapedAt === "2026-04-01T00:00:00.000Z", "failure does NOT touch lastScrapedAt");
  assert(
    after.lastSeenAvailableAt === "2026-04-01T00:00:00.000Z",
    "failure does NOT touch lastSeenAvailableAt",
  );
  // Metadata updated
  assert(after.lastRefreshStatus === "failed", "failure sets lastRefreshStatus=failed");
  assert(after.lastRefreshAttemptAt === "2026-04-22T01:00:00.000Z", "failure sets lastRefreshAttemptAt");
  assert(after.refreshError === "Apify actor failed: proxy error", "failure sets refreshError");
}

// ============================================================
// refreshListing: uses canonicalLink when both canonical and raw link present
// ============================================================
{
  const before = baseListing({
    id: 9,
    canonicalLink: "https://streeteasy.com/rental/canonical",
    link: "https://streeteasy.com/rental/raw?utm_source=x",
  });
  const store = new Map<number, ListingView>([[9, before]]);
  let urlSeen = "";
  const deps: RefreshDeps = {
    getListing: async (id) => store.get(id),
    scrape: async (url) => {
      urlSeen = url;
      return { link: url, rent: "$1" };
    },
    applyRefreshedFields: async (id, _scraped, metadata) => {
      const current = store.get(id)!;
      const updated = { ...current, ...(metadata as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
    updateListing: async (id, update) => {
      const current = store.get(id)!;
      const updated = { ...current, ...(update as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
  };
  const outcome = await refreshListing(9, deps);
  assert(outcome.status === "refreshed", "refresh with canonicalLink succeeds");
  assert(urlSeen === "https://streeteasy.com/rental/canonical", "refresh prefers canonicalLink over link");
}

// ============================================================
// refreshListing: falls back to link when canonicalLink is empty
// ============================================================
{
  const before = baseListing({
    id: 10,
    canonicalLink: "",
    link: "https://streeteasy.com/rental/raw",
  });
  const store = new Map<number, ListingView>([[10, before]]);
  let urlSeen = "";
  const deps: RefreshDeps = {
    getListing: async (id) => store.get(id),
    scrape: async (url) => {
      urlSeen = url;
      return { link: url, rent: "$1" };
    },
    applyRefreshedFields: async (id, _scraped, metadata) => {
      const current = store.get(id)!;
      const updated = { ...current, ...(metadata as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
    updateListing: async (id, update) => {
      const current = store.get(id)!;
      const updated = { ...current, ...(update as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
  };
  const outcome = await refreshListing(10, deps);
  assert(outcome.status === "refreshed", "refresh with fallback link succeeds");
  assert(urlSeen === "https://streeteasy.com/rental/raw", "refresh falls back to raw link");
}

// ============================================================
// refreshListing: invalid URL fails without calling scrape
// ============================================================
{
  const before = baseListing({
    id: 11,
    canonicalLink: "",
    link: "not-a-valid-url",
    rent: "$2,000",
    bbLizardOverallRating: 5,
    bbCrabOverallRating: 5,
  });
  const store = new Map<number, ListingView>([[11, before]]);
  let scrapeCalls = 0;
  const deps: RefreshDeps = {
    getListing: async (id) => store.get(id),
    scrape: async (url) => {
      scrapeCalls++;
      return { link: url };
    },
    applyRefreshedFields: async (id) => store.get(id),
    updateListing: async (id, update) => {
      const current = store.get(id)!;
      const updated = { ...current, ...(update as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
    now: () => "2026-04-22T02:00:00.000Z",
  };

  const outcome = await refreshListing(11, deps);
  assert(outcome.status === "failed", "invalid URL yields failed outcome");
  assert(scrapeCalls === 0, "invalid URL does not call scraper");
  const after = store.get(11)!;
  assert(after.rent === "$2,000", "invalid URL preserves listing data");
  assert(after.bbLizardOverallRating === 5, "invalid URL preserves user ratings");
  assert(after.lastRefreshStatus === "failed", "invalid URL sets lastRefreshStatus=failed");
  assert(
    after.refreshError === "Listing has an invalid refresh URL",
    "invalid URL sets descriptive refreshError",
  );
}

// ============================================================
// refreshListing: no URL at all fails
// ============================================================
{
  const before = baseListing({ id: 12, canonicalLink: "", link: "" });
  const store = new Map<number, ListingView>([[12, before]]);
  const deps: RefreshDeps = {
    getListing: async (id) => store.get(id),
    scrape: async () => {
      throw new Error("should not be called");
    },
    applyRefreshedFields: async (id) => store.get(id),
    updateListing: async (id, update) => {
      const current = store.get(id)!;
      const updated = { ...current, ...(update as Partial<ListingView>) };
      store.set(id, updated);
      return updated;
    },
  };
  const outcome = await refreshListing(12, deps);
  assert(outcome.status === "failed", "missing URL yields failed outcome");
  assert(
    store.get(12)!.refreshError === "Listing has no link to refresh from",
    "missing URL sets no-link refreshError",
  );
}

// ============================================================
// refreshListing: not_found when listing does not exist
// ============================================================
{
  const deps: RefreshDeps = {
    getListing: async () => undefined,
    scrape: async () => ({}),
    applyRefreshedFields: async () => undefined,
    updateListing: async () => undefined,
  };
  const outcome = await refreshListing(999, deps);
  assert(outcome.status === "not_found", "missing listing yields not_found");
}

// ============================================================
// summarizeBulkRefresh: produces explicit buckets and counts
// ============================================================
{
  const results: BulkRefreshItem[] = [
    { id: 1, status: "refreshed" },
    { id: 2, status: "failed", error: "bad" },
    { id: 3, status: "stale" },
    { id: 4, status: "skipped", error: "Listing not found" },
    { id: 5, status: "refreshed" },
  ];
  const response = summarizeBulkRefresh(results);
  assertEqual(response.counts, { total: 5, refreshed: 2, failed: 1, stale: 1, skipped: 1 }, "bulk counts");
  assertEqual(response.buckets.refreshed, [1, 5], "bulk refreshed bucket contains ids 1 and 5");
  assertEqual(response.buckets.failed, [2], "bulk failed bucket contains id 2");
  assertEqual(response.buckets.stale, [3], "bulk stale bucket contains id 3");
  assertEqual(response.buckets.skipped, [4], "bulk skipped bucket contains id 4");
  assert(response.results.length === 5, "bulk response exposes full results array");
  assert(
    response.counts.total ===
      response.counts.refreshed + response.counts.failed + response.counts.stale + response.counts.skipped,
    "total equals sum of bucket counts",
  );
}

// Empty results
{
  const response = summarizeBulkRefresh([]);
  assertEqual(response.counts, { total: 0, refreshed: 0, failed: 0, stale: 0, skipped: 0 }, "empty bulk counts");
  assertEqual(response.buckets, { refreshed: [], failed: [], stale: [], skipped: [] }, "empty bulk buckets");
}

// ============================================================
// Exit
// ============================================================
if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed`);
