import type { ListingView } from "./schema";

export const NEEDS_REVIEW_REASONS = [
  "workflow_status_new",
  "missing_lizard_overall_rating",
  "missing_crab_overall_rating",
  "availability_not_active",
  "missing_rent",
  "missing_commute",
  "refresh_failed",
] as const;

export type NeedsReviewReason = (typeof NEEDS_REVIEW_REASONS)[number];

export type ListingNeedsReviewInput = Pick<
  ListingView,
  | "workflowStatus"
  | "availability"
  | "rent"
  | "pplxDist"
  | "sevenTwoDist"
  | "bbLizardOverallRating"
  | "bbCrabOverallRating"
> & {
  lastRefreshStatus?: string | null;
};

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

export function computeNeedsReviewReasons(
  listing: ListingNeedsReviewInput,
): NeedsReviewReason[] {
  const reasons: NeedsReviewReason[] = [];

  if (listing.workflowStatus === "new") {
    reasons.push("workflow_status_new");
  }

  if (!listing.bbLizardOverallRating || listing.bbLizardOverallRating <= 0) {
    reasons.push("missing_lizard_overall_rating");
  }

  if (!listing.bbCrabOverallRating || listing.bbCrabOverallRating <= 0) {
    reasons.push("missing_crab_overall_rating");
  }

  if (listing.availability && listing.availability !== "active") {
    reasons.push("availability_not_active");
  }

  if (isBlank(listing.rent)) {
    reasons.push("missing_rent");
  }

  if (isBlank(listing.pplxDist) && isBlank(listing.sevenTwoDist)) {
    reasons.push("missing_commute");
  }

  const refreshStatus = listing.lastRefreshStatus;
  if (typeof refreshStatus === "string" && refreshStatus.trim().toLowerCase() === "failed") {
    reasons.push("refresh_failed");
  }

  return reasons;
}

export function needsReview(listing: ListingNeedsReviewInput): boolean {
  return computeNeedsReviewReasons(listing).length > 0;
}

export type ListingWithNeedsReview<T extends ListingNeedsReviewInput> = T & {
  needsReviewReasons: NeedsReviewReason[];
};

export function annotateNeedsReview<T extends ListingNeedsReviewInput>(
  listing: T,
): ListingWithNeedsReview<T> {
  return { ...listing, needsReviewReasons: computeNeedsReviewReasons(listing) };
}
