import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  link: text("link").notNull(),
  neighborhood: text("neighborhood").notNull().default(""),
  rent: text("rent").notNull().default(""),
  beds: text("beds").notNull().default(""),
  rooms: text("rooms").notNull().default(""),
  roomsDesc: text("rooms_desc").notNull().default(""),
  bath: text("bath").notNull().default(""),
  sqFt: text("sq_ft").notNull().default(""),
  pplxDist: text("pplx_dist").notNull().default(""),
  sevenTwoDist: text("seven_two_dist").notNull().default(""),
  datePosted: text("date_posted").notNull().default(""),
  amenities: text("amenities").notNull().default("[]"),
  hasInUnitLaundry: integer("has_in_unit_laundry", { mode: "boolean" }).notNull().default(false),
  hasInBuildingLaundry: integer("has_in_building_laundry", { mode: "boolean" }).notNull().default(false),
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

export const importUrlSchema = z.object({
  url: z.string().url().refine((value) => {
    try {
      return new URL(value).hostname.replace(/^www\./, "") === "streeteasy.com";
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
