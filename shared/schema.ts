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
  createdAt: text("created_at").notNull().default(""),
});

const baseInsertListingSchema = createInsertSchema(listings).omit({
  id: true,
});

export const insertListingSchema = baseInsertListingSchema.extend({
  amenities: z.union([z.string(), z.array(z.string())]).default("[]"),
});

export const updateListingSchema = insertListingSchema.partial().extend({
  amenities: z.union([z.string(), z.array(z.string())]).optional(),
});

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
