import {
  computeNeedsReviewReasons,
  needsReview,
  annotateNeedsReview,
  NEEDS_REVIEW_REASONS,
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
    bbLizardOverallRating: 4,
    bbCrabOverallRating: 5,
    ...overrides,
  };
}

assert(
  JSON.stringify([...NEEDS_REVIEW_REASONS].sort()) ===
    JSON.stringify(
      [
        "workflow_status_new",
        "missing_lizard_overall_rating",
        "missing_crab_overall_rating",
        "refresh_failed",
      ].sort(),
    ),
  "canonical reasons are exactly the final four",
);

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

const refreshNull = baseListing({ lastRefreshStatus: null });
assert(
  !computeNeedsReviewReasons(refreshNull).includes("refresh_failed"),
  "null lastRefreshStatus tolerated (not flagged)",
);

const removedReasons = [
  "availability_not_active",
  "missing_rent",
  "missing_commute",
];
for (const removed of removedReasons) {
  assert(
    !(NEEDS_REVIEW_REASONS as readonly string[]).includes(removed),
    `legacy reason "${removed}" is not in canonical list`,
  );
}

const inactiveIsIgnored = baseListing();
(inactiveIsIgnored as unknown as { availability: string }).availability = "inactive";
(inactiveIsIgnored as unknown as { rent: string }).rent = "";
(inactiveIsIgnored as unknown as { pplxDist: string }).pplxDist = "";
(inactiveIsIgnored as unknown as { sevenTwoDist: string }).sevenTwoDist = "";
assert(
  computeNeedsReviewReasons(inactiveIsIgnored).length === 0,
  "removed signals (availability/rent/commute) no longer trigger reasons",
);

const multi = baseListing({
  workflowStatus: "new",
  bbLizardOverallRating: 0,
  bbCrabOverallRating: 0,
  lastRefreshStatus: "failed",
});
const multiReasons = computeNeedsReviewReasons(multi);
assert(multiReasons.includes("workflow_status_new"), "multi-reason: workflow_status_new");
assert(multiReasons.includes("missing_lizard_overall_rating"), "multi-reason: missing_lizard_overall_rating");
assert(multiReasons.includes("missing_crab_overall_rating"), "multi-reason: missing_crab_overall_rating");
assert(multiReasons.includes("refresh_failed"), "multi-reason: refresh_failed");
assert(multiReasons.length === 4, "multi-reason: exactly four canonical reasons");
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
