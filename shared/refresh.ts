import type { InsertListing, ListingView, UpdateListing } from "./schema";

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

export function pickRefreshUrl(
  listing: Pick<ListingView, "canonicalLink" | "link">,
): string {
  const canonical = typeof listing.canonicalLink === "string" ? listing.canonicalLink.trim() : "";
  if (canonical) return canonical;
  const raw = typeof listing.link === "string" ? listing.link.trim() : "";
  return raw;
}

export function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export type SingleRefreshStatus = "refreshed" | "failed" | "not_found";

export type SingleRefreshOutcome = {
  id: number;
  status: SingleRefreshStatus;
  error?: string;
  listing?: ListingView;
};

export type BulkRefreshItem = {
  id: number;
  status: "refreshed" | "failed" | "stale" | "skipped";
  error?: string;
};

export type BulkRefreshBuckets = {
  refreshed: number[];
  failed: number[];
  stale: number[];
  skipped: number[];
};

export type BulkRefreshCounts = {
  total: number;
  refreshed: number;
  failed: number;
  stale: number;
  skipped: number;
};

export type BulkRefreshResponse = {
  counts: BulkRefreshCounts;
  buckets: BulkRefreshBuckets;
  results: BulkRefreshItem[];
};

export function emptyBulkBuckets(): BulkRefreshBuckets {
  return { refreshed: [], failed: [], stale: [], skipped: [] };
}

export function summarizeBulkRefresh(results: BulkRefreshItem[]): BulkRefreshResponse {
  const buckets = emptyBulkBuckets();
  for (const result of results) {
    buckets[result.status].push(result.id);
  }
  const counts: BulkRefreshCounts = {
    total: results.length,
    refreshed: buckets.refreshed.length,
    failed: buckets.failed.length,
    stale: buckets.stale.length,
    skipped: buckets.skipped.length,
  };
  return { counts, buckets, results };
}

export type RefreshDeps = {
  getListing: (id: number) => Promise<ListingView | undefined>;
  scrape: (url: string) => Promise<Partial<InsertListing>>;
  applyRefreshedFields: (
    id: number,
    scraped: Partial<InsertListing>,
    metadata: Partial<UpdateListing>,
  ) => Promise<ListingView | undefined>;
  updateListing: (id: number, update: Partial<UpdateListing>) => Promise<ListingView | undefined>;
  now?: () => string;
};

export async function refreshListing(
  id: number,
  deps: RefreshDeps,
): Promise<SingleRefreshOutcome> {
  const existing = await deps.getListing(id);
  if (!existing) return { id, status: "not_found" };

  const now = deps.now ? deps.now() : new Date().toISOString();
  const url = pickRefreshUrl(existing);

  if (!isValidHttpUrl(url)) {
    const updated = await deps.updateListing(id, {
      lastRefreshAttemptAt: now,
      lastRefreshStatus: "failed",
      refreshError: url
        ? "Listing has an invalid refresh URL"
        : "Listing has no link to refresh from",
    });
    return {
      id,
      status: "failed",
      listing: updated,
      error: url ? "Listing has an invalid refresh URL" : "Listing has no link to refresh from",
    };
  }

  try {
    const scraped = await deps.scrape(url);
    const updated = await deps.applyRefreshedFields(id, scraped, {
      lastScrapedAt: now,
      lastRefreshAttemptAt: now,
      lastRefreshStatus: "refreshed",
      refreshError: "",
      lastSeenAvailableAt: now,
    });
    return { id, status: "refreshed", listing: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown refresh failure";
    const updated = await deps.updateListing(id, {
      lastRefreshAttemptAt: now,
      lastRefreshStatus: "failed",
      refreshError: message.slice(0, 500),
    });
    return { id, status: "failed", listing: updated, error: message };
  }
}
