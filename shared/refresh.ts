import type { ListingView } from "./schema";

export const DEFAULT_REFRESH_MIN_AVERAGE_RATING = 3;
export const DEFAULT_REFRESH_AVAILABILITY: ListingView["availability"][] = ["active"];

export type RefreshEligibilityOptions = {
  minAverageRating?: number;
  availability?: ListingView["availability"][];
};

export function computeAverageOverallRating(
  listing: Pick<ListingView, "bbLizardOverallRating" | "bbCrabOverallRating">,
): number {
  const values = [listing.bbLizardOverallRating, listing.bbCrabOverallRating].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  if (!values.length) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

export function isRefreshEligible(
  listing: ListingView,
  options: RefreshEligibilityOptions = {},
): boolean {
  const minAverage = options.minAverageRating ?? DEFAULT_REFRESH_MIN_AVERAGE_RATING;
  const allowedAvailability = options.availability ?? DEFAULT_REFRESH_AVAILABILITY;

  if (!allowedAvailability.includes(listing.availability as ListingView["availability"])) {
    return false;
  }

  const average = computeAverageOverallRating(listing);
  if (average < minAverage) return false;

  return true;
}

export function filterRefreshEligible(
  listings: ListingView[],
  options: RefreshEligibilityOptions = {},
): ListingView[] {
  return listings.filter((listing) => isRefreshEligible(listing, options));
}
