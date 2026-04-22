import {
  USER_OWNED_LISTING_FIELDS,
  REFRESH_STATUS_VALUES,
  refreshAllRequestSchema,
  type InsertListing,
  type ListingView,
} from "../shared/schema";
import { stripUserOwnedFields } from "../server/storage";
import {
  computeAverageOverallRating,
  isRefreshEligible,
  filterRefreshEligible,
  DEFAULT_REFRESH_MIN_AVERAGE_RATING,
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

// stripUserOwnedFields preserves ratings/comments/workflow/availability/parseStatus
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

// computeAverageOverallRating
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

// isRefreshEligible: default requires avg >= 3 and availability=active
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

// filterRefreshEligible
const mixed: ListingView[] = [
  baseListing({ id: 1, bbLizardOverallRating: 4, bbCrabOverallRating: 4 }),
  baseListing({ id: 2, bbLizardOverallRating: 2, bbCrabOverallRating: 2 }),
  baseListing({ id: 3, availability: "inactive", bbLizardOverallRating: 5, bbCrabOverallRating: 5 }),
];
const eligible = filterRefreshEligible(mixed);
assert(eligible.length === 1 && eligible[0].id === 1, "filterRefreshEligible keeps only qualifying listings");

// REFRESH_STATUS_VALUES
for (const expected of ["never", "refreshed", "failed", "stale"]) {
  assert(
    (REFRESH_STATUS_VALUES as readonly string[]).includes(expected),
    `REFRESH_STATUS_VALUES includes "${expected}"`,
  );
}

// refreshAllRequestSchema
const okParse = refreshAllRequestSchema.safeParse({ minAverageRating: 4, availability: ["active"], limit: 10 });
assert(okParse.success, "valid refresh request parses");
const badParse = refreshAllRequestSchema.safeParse({ minAverageRating: 99 });
assert(!badParse.success, "refresh request with out-of-range rating is rejected");
const emptyParse = refreshAllRequestSchema.safeParse({});
assert(emptyParse.success, "empty refresh request is valid (defaults applied)");
const idsParse = refreshAllRequestSchema.safeParse({ listingIds: [1, 2, 3] });
assert(idsParse.success, "refresh request with listingIds is valid");

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed`);
