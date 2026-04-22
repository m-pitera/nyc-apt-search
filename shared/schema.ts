import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  link: text("link").notNull(),
  canonicalLink: text("canonical_link").notNull().default(""),
  neighborhood: text("neighborhood").notNull().default(""),
  borough: text("borough").notNull().default(""),
  buildingTitle: text("building_title").notNull().default(""),
  rent: text("rent").notNull().default(""),
  beds: text("beds").notNull().default(""),
  rooms: text("rooms").notNull().default(""),
  roomsDesc: text("rooms_desc").notNull().default(""),
  bath: text("bath").notNull().default(""),
  sqFt: text("sq_ft").notNull().default(""),
  pplxDist: text("pplx_dist").notNull().default(""),
  sevenTwoDist: text("seven_two_dist").notNull().default(""),
  datePosted: text("date_posted").notNull().default(""),
  yearBuilt: text("year_built").notNull().default(""),
  openRentalsCount: text("open_rentals_count").notNull().default(""),
  listingStatus: text("listing_status").notNull().default(""),
  description: text("description").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  amenities: text("amenities").notNull().default("[]"),
  hasInUnitLaundry: integer("has_in_unit_laundry", { mode: "boolean" }).notNull().default(false),
  hasInBuildingLaundry: integer("has_in_building_laundry", { mode: "boolean" }).notNull().default(false),
  latitude: text("latitude").notNull().default(""),
  longitude: text("longitude").notNull().default(""),
  bbLizardRating: integer("bb_lizard_rating").notNull().default(0),
  bbLizardLocationRating: integer("bb_lizard_location_rating").notNull().default(0),
  bbLizardLayoutRating: integer("bb_lizard_layout_rating").notNull().default(0),
  bbLizardOverallRating: integer("bb_lizard_overall_rating").notNull().default(0),
  bbCrabRating: integer("bb_crab_rating").notNull().default(0),
  bbCrabLocationRating: integer("bb_crab_location_rating").notNull().default(0),
  bbCrabLayoutRating: integer("bb_crab_layout_rating").notNull().default(0),
  bbCrabOverallRating: integer("bb_crab_overall_rating").notNull().default(0),
  bbLizardComment: text("bb_lizard_comment").notNull().default(""),
  bbCrabComment: text("bb_crab_comment").notNull().default(""),
  rating: integer("rating").notNull().default(0),
  parseStatus: text("parse_status").notNull().default(""),
  availability: text("availability").notNull().default("active"),
  workflowStatus: text("workflow_status").notNull().default("new"),
  createdAt: text("created_at").notNull().default(""),
  lastScrapedAt: text("last_scraped_at").notNull().default(""),
  lastRefreshAttemptAt: text("last_refresh_attempt_at").notNull().default(""),
  lastRefreshStatus: text("last_refresh_status").notNull().default("never"),
  refreshError: text("refresh_error").notNull().default(""),
  lastSeenAvailableAt: text("last_seen_available_at").notNull().default(""),
});

export const listingEvents = sqliteTable("listing_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull(),
  type: text("type").notNull(),
  createdAt: text("created_at").notNull().default(""),
  payloadJson: text("payload_json").notNull().default("{}"),
});

export const LISTING_EVENT_TYPES = [
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
] as const;
export type ListingEventType = (typeof LISTING_EVENT_TYPES)[number];

export type ListingEvent = typeof listingEvents.$inferSelect;

export type ListingEventView = Omit<ListingEvent, "payloadJson"> & {
  payload: Record<string, unknown>;
};

export const listingEventsQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

export type ListingEventsQuery = z.infer<typeof listingEventsQuerySchema>;

export const AVAILABILITY_VALUES = ["active", "inactive", "stale"] as const;
export type Availability = (typeof AVAILABILITY_VALUES)[number];

export const REFRESH_STATUS_VALUES = ["never", "refreshed", "failed", "stale"] as const;
export type RefreshStatus = (typeof REFRESH_STATUS_VALUES)[number];

export const WORKFLOW_STATUS_VALUES = [
  "new",
  "contacted",
  "scheduled",
  "applied",
  "signed",
  "rejected",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUS_VALUES)[number];

export const USER_OWNED_LISTING_FIELDS = [
  "bbLizardRating",
  "bbLizardLocationRating",
  "bbLizardLayoutRating",
  "bbLizardOverallRating",
  "bbCrabRating",
  "bbCrabLocationRating",
  "bbCrabLayoutRating",
  "bbCrabOverallRating",
  "bbLizardComment",
  "bbCrabComment",
  "rating",
  "availability",
  "workflowStatus",
  "parseStatus",
] as const;
export type UserOwnedListingField = (typeof USER_OWNED_LISTING_FIELDS)[number];

const baseInsertListingSchema = createInsertSchema(listings).omit({
  id: true,
});

export const insertListingSchema = baseInsertListingSchema.extend({
  amenities: z.union([z.string(), z.array(z.string())]).default("[]"),
  availability: z.enum(AVAILABILITY_VALUES).default("active"),
  workflowStatus: z.enum(WORKFLOW_STATUS_VALUES).default("new"),
  lastRefreshStatus: z.enum(REFRESH_STATUS_VALUES).default("never"),
});

export const updateListingSchema = insertListingSchema.partial().extend({
  amenities: z.union([z.string(), z.array(z.string())]).optional(),
  availability: z.enum(AVAILABILITY_VALUES).optional(),
  workflowStatus: z.enum(WORKFLOW_STATUS_VALUES).optional(),
  lastRefreshStatus: z.enum(REFRESH_STATUS_VALUES).optional(),
});

export const refreshAllRequestSchema = z.object({
  minAverageRating: z.number().min(0).max(5).optional(),
  availability: z.array(z.enum(AVAILABILITY_VALUES)).optional(),
  limit: z.number().int().positive().max(500).optional(),
  listingIds: z.array(z.number().int().positive()).optional(),
});

export type RefreshAllRequest = z.infer<typeof refreshAllRequestSchema>;

const STREETEASY_HOSTS = new Set(["streeteasy.com", "www.streeteasy.com"]);

export function isStreetEasyHost(host: string): boolean {
  return STREETEASY_HOSTS.has(host.toLowerCase());
}

export function canonicalizeStreetEasyUrl(value: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return "";
  }
  const host = parsed.hostname.toLowerCase();
  if (!isStreetEasyHost(host)) return "";
  const normalizedHost = host === "www.streeteasy.com" ? "streeteasy.com" : host;
  let path = parsed.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }
  return `https://${normalizedHost}${path}`;
}

export const importUrlSchema = z.object({
  url: z.string().url().refine((value) => {
    try {
      return isStreetEasyHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }, "Paste a valid streeteasy.com URL"),
  pageText: z.string().optional(),
});

export type InsertListing = z.infer<typeof insertListingSchema>;
export type UpdateListing = z.infer<typeof updateListingSchema>;
export type Listing = typeof listings.$inferSelect;

export type ListingView = Omit<Listing, "amenities"> & {
  amenities: string[];
};
