import {
  computeNeedsReviewReasons,
  needsReview,
  annotateNeedsReview,
} from "../shared/needs-review";
import type { ListingNeedsReviewInput } from "../shared/needs-review";

let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok  ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function baseListing(
  overrides: Partial<ListingNeedsReviewInput> = {},
): ListingNeedsReviewInput {
  return {
    workflowStatus: "contacted",
    availability: "active",
    rent: "$3,500",
    pplxDist: "10 min",
    sevenTwoDist: "15 min",
    bbLizardOverallRating: 4,
    bbCrabOverallRating: 5,
    ...overrides,
  };
}

const clean = baseListing();
assert(computeNeedsReviewReasons(clean).length === 0, "fully populated listing has no reasons");
assert(!needsReview(clean), "fully populated listing does not need review");

const newListing = baseListing({ workflowStatus: "new" });
assert(
  computeNeedsReviewReasons(newListing).includes("workflow_status_new"),
  "workflow_status=new flags workflow_status_new",
);

const missingLizard = baseListing({ bbLizardOverallRating: 0 });
assert(
  computeNeedsReviewReasons(missingLizard).includes("missing_lizard_overall_rating"),
  "missing lizard overall rating is flagged",
);

const missingCrab = baseListing({ bbCrabOverallRating: 0 });
assert(
  computeNeedsReviewReasons(missingCrab).includes("missing_crab_overall_rating"),
  "missing crab overall rating is flagged",
);

const inactive = baseListing({ availability: "inactive" });
assert(
  computeNeedsReviewReasons(inactive).includes("availability_not_active"),
  "availability=inactive is flagged",
);

const stale = baseListing({ availability: "stale" });
assert(
  computeNeedsReviewReasons(stale).includes("availability_not_active"),
  "availability=stale is flagged",
);

const missingRent = baseListing({ rent: "" });
assert(
  computeNeedsReviewReasons(missingRent).includes("missing_rent"),
  "empty rent is flagged",
);

const whitespaceRent = baseListing({ rent: "   " });
assert(
  computeNeedsReviewReasons(whitespaceRent).includes("missing_rent"),
  "whitespace-only rent is flagged",
);

const missingCommute = baseListing({ pplxDist: "", sevenTwoDist: "" });
assert(
  computeNeedsReviewReasons(missingCommute).includes("missing_commute"),
  "missing both commute fields is flagged",
);

const partialCommute = baseListing({ pplxDist: "", sevenTwoDist: "10 min" });
assert(
  !computeNeedsReviewReasons(partialCommute).includes("missing_commute"),
  "one commute field present avoids missing_commute",
);

const refreshFailed = baseListing({ lastRefreshStatus: "failed" });
assert(
  computeNeedsReviewReasons(refreshFailed).includes("refresh_failed"),
  "lastRefreshStatus=failed is flagged",
);

const refreshOk = baseListing({ lastRefreshStatus: "ok" });
assert(
  !computeNeedsReviewReasons(refreshOk).includes("refresh_failed"),
  "lastRefreshStatus=ok is not flagged",
);

const refreshAbsent = baseListing();
assert(
  !computeNeedsReviewReasons(refreshAbsent).includes("refresh_failed"),
  "absent lastRefreshStatus tolerated (not flagged)",
);

const multi = baseListing({
  workflowStatus: "new",
  availability: "inactive",
  rent: "",
  bbLizardOverallRating: 0,
});
const multiReasons = computeNeedsReviewReasons(multi);
assert(multiReasons.includes("workflow_status_new"), "multi-reason: workflow_status_new");
assert(multiReasons.includes("availability_not_active"), "multi-reason: availability_not_active");
assert(multiReasons.includes("missing_rent"), "multi-reason: missing_rent");
assert(multiReasons.includes("missing_lizard_overall_rating"), "multi-reason: missing_lizard_overall_rating");
assert(needsReview(multi), "multi-issue listing needs review");

const annotated = annotateNeedsReview(baseListing({ workflowStatus: "new" }));
assert(Array.isArray(annotated.needsReviewReasons), "annotate attaches needsReviewReasons array");
assert(
  annotated.needsReviewReasons.includes("workflow_status_new"),
  "annotate preserves computed reasons",
);
assert(annotated.workflowStatus === "new", "annotate preserves original fields");

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed`);
