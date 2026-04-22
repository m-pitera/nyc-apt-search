import type { ListingView } from "./schema";

export const NEEDS_REVIEW_REASONS = [
  "workflow_status_new",
  "missing_lizard_overall_rating",
  "missing_crab_overall_rating",
  "refresh_failed",
] as const;

export type NeedsReviewReason = (typeof NEEDS_REVIEW_REASONS)[number];

export type ListingNeedsReviewInput = Pick<
  ListingView,
  "workflowStatus" | "bbLizardOverallRating" | "bbCrabOverallRating"
> & {
  lastRefreshStatus?: string | null;
};

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

  const refreshStatus = listing.lastRefreshStatus;
  if (typeof refreshStatus === "string" && refreshStatus === "failed") {
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
