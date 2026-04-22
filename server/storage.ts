import { listings } from "@shared/schema";
import type { InsertListing, Listing, ListingView, UpdateListing } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link TEXT NOT NULL,
    neighborhood TEXT NOT NULL DEFAULT '',
    borough TEXT NOT NULL DEFAULT '',
    building_title TEXT NOT NULL DEFAULT '',
    rent TEXT NOT NULL DEFAULT '',
    beds TEXT NOT NULL DEFAULT '',
    rooms TEXT NOT NULL DEFAULT '',
    rooms_desc TEXT NOT NULL DEFAULT '',
    bath TEXT NOT NULL DEFAULT '',
    sq_ft TEXT NOT NULL DEFAULT '',
    pplx_dist TEXT NOT NULL DEFAULT '',
    seven_two_dist TEXT NOT NULL DEFAULT '',
    date_posted TEXT NOT NULL DEFAULT '',
    year_built TEXT NOT NULL DEFAULT '',
    open_rentals_count TEXT NOT NULL DEFAULT '',
    listing_status TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    amenities TEXT NOT NULL DEFAULT '[]',
    has_in_unit_laundry INTEGER NOT NULL DEFAULT 0,
    has_in_building_laundry INTEGER NOT NULL DEFAULT 0,
    latitude TEXT NOT NULL DEFAULT '',
    longitude TEXT NOT NULL DEFAULT '',
    bb_lizard_rating INTEGER NOT NULL DEFAULT 0,
    bb_crab_rating INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 0,
    parse_status TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  );
`);

const existingColumns = sqlite.prepare("PRAGMA table_info(listings)").all() as Array<{ name: string }>;
function addMissingColumn(name: string, definition: string) {
  if (!existingColumns.some((column) => column.name === name)) {
    sqlite.exec(`ALTER TABLE listings ADD COLUMN ${definition};`);
  }
}

addMissingColumn("borough", "borough TEXT NOT NULL DEFAULT ''");
addMissingColumn("building_title", "building_title TEXT NOT NULL DEFAULT ''");
addMissingColumn("year_built", "year_built TEXT NOT NULL DEFAULT ''");
addMissingColumn("open_rentals_count", "open_rentals_count TEXT NOT NULL DEFAULT ''");
addMissingColumn("listing_status", "listing_status TEXT NOT NULL DEFAULT ''");
addMissingColumn("description", "description TEXT NOT NULL DEFAULT ''");
addMissingColumn("contact_name", "contact_name TEXT NOT NULL DEFAULT ''");
addMissingColumn("contact_email", "contact_email TEXT NOT NULL DEFAULT ''");
addMissingColumn("contact_phone", "contact_phone TEXT NOT NULL DEFAULT ''");
addMissingColumn("latitude", "latitude TEXT NOT NULL DEFAULT ''");
addMissingColumn("longitude", "longitude TEXT NOT NULL DEFAULT ''");
addMissingColumn("bb_lizard_rating", "bb_lizard_rating INTEGER NOT NULL DEFAULT 0");
addMissingColumn("bb_crab_rating", "bb_crab_rating INTEGER NOT NULL DEFAULT 0");
addMissingColumn("rating", "rating INTEGER NOT NULL DEFAULT 0");

function normalizeAmenities(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => String(item).trim()).filter(Boolean));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed.map((item) => String(item).trim()).filter(Boolean));
      }
    } catch {
      return JSON.stringify(
        value
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
  }

  return "[]";
}

function toView(listing: Listing): ListingView {
  let amenities: string[] = [];
  try {
    const parsed = JSON.parse(listing.amenities);
    amenities = Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    amenities = listing.amenities ? [listing.amenities] : [];
  }

  return {
    ...listing,
    amenities,
  };
}

type DbInsertListing = typeof listings.$inferInsert;

function toDbValues(input: InsertListing | UpdateListing): Partial<DbInsertListing> {
  const values: Record<string, unknown> = { ...input };

  if ("amenities" in values) {
    values.amenities = normalizeAmenities(values.amenities);
  }

  if ("createdAt" in values && !values.createdAt) {
    values.createdAt = new Date().toISOString();
  }

  return values as Partial<DbInsertListing>;
}

export interface IStorage {
  listListings(): Promise<ListingView[]>;
  createListing(listing: InsertListing): Promise<ListingView>;
  updateListing(id: number, listing: UpdateListing): Promise<ListingView | undefined>;
  deleteListing(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async listListings(): Promise<ListingView[]> {
    return db.select().from(listings).orderBy(desc(listings.id)).all().map(toView);
  }

  async createListing(insertListing: InsertListing): Promise<ListingView> {
    const values = toDbValues({
      ...insertListing,
      createdAt: insertListing.createdAt || new Date().toISOString(),
    }) as DbInsertListing;
    return toView(db.insert(listings).values(values).returning().get());
  }

  async updateListing(id: number, updateListing: UpdateListing): Promise<ListingView | undefined> {
    const values = toDbValues(updateListing);
    const row = db.update(listings).set(values).where(eq(listings.id, id)).returning().get();
    return row ? toView(row) : undefined;
  }

  async deleteListing(id: number): Promise<boolean> {
    const result = db.delete(listings).where(eq(listings.id, id)).run();
    return result.changes > 0;
  }
}

export const storage = new DatabaseStorage();
