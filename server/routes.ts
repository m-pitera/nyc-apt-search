import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { importUrlSchema, insertListingSchema, updateListingSchema } from "@shared/schema";
import type { InsertListing } from "@shared/schema";
import { storage } from "./storage";
import { ZodError } from "zod";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getByPath(root: unknown, wantedKeys: string[]): unknown[] {
  const results: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (wantedKeys.includes(normalized)) {
        results.push(value);
      }
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return results;
}

function firstStringFromJson(root: unknown, wantedKeys: string[]): string {
  for (const value of getByPath(root, wantedKeys)) {
    if (typeof value === "string" || typeof value === "number") {
      const cleaned = cleanText(value);
      if (cleaned) return cleaned;
    }
    if (Array.isArray(value)) {
      const joined = value.map(cleanText).filter(Boolean).join(", ");
      if (joined) return joined;
    }
  }
  return "";
}

function allStringsFromJson(root: unknown, wantedKeys: string[]): string[] {
  const values: string[] = [];
  for (const value of getByPath(root, wantedKeys)) {
    if (typeof value === "string" || typeof value === "number") {
      const cleaned = cleanText(value);
      if (cleaned) values.push(cleaned);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" || typeof item === "number") {
          const cleaned = cleanText(item);
          if (cleaned) values.push(cleaned);
        } else if (item && typeof item === "object") {
          const name = firstStringFromJson(item, ["name", "label", "title"]);
          if (name) values.push(name);
        }
      }
    }
  }
  return uniq(values);
}

function extractJsonLd(html: string): unknown[] {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  return Array.from(matches)
    .map((match) => safeJsonParse(match[1].trim()))
    .filter((value): value is JsonValue => value !== undefined);
}

function extractNextData(html: string): unknown[] {
  const values: unknown[] = [];
  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) values.push(safeJsonParse(nextData[1]));

  const reduxData = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/i);
  if (reduxData) values.push(safeJsonParse(reduxData[1]));

  return values.filter((value) => value !== undefined);
}

function parseNeighborhood(html: string, text: string, url: URL, jsonRoots: unknown[]): string {
  const fromJson = firstStringFromJson(jsonRoots, ["neighborhood", "neighbourhood", "area"]);
  if (fromJson) return fromJson;

  const visibleTextMatch = text.match(/\bin\s+([A-Z][A-Za-z\s'-]+?),\s*(?:Manhattan|Brooklyn|Queens|Bronx|Staten Island|New York)\b/);
  if (visibleTextMatch) return cleanText(visibleTextMatch[1]);

  const rentalUnitMatch = text.match(/Rental unit in\s+([A-Z][A-Za-z\s'-]+?)(?:\s|$)/);
  if (rentalUnitMatch) return cleanText(rentalUnitMatch[1]);

  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const titleMatch = title.match(/\bin\s+([^,|]+),\s*(?:Manhattan|Brooklyn|Queens|Bronx|Staten Island|New York)/i);
  if (titleMatch) return cleanText(titleMatch[1]);

  const exploreMatch = text.match(/Explore\s+([A-Z][A-Za-z\s'-]+?)(?:\s+Transit|\s+Similar|\s*$)/);
  if (exploreMatch) return cleanText(exploreMatch[1]);

  return url.pathname.split("/").filter(Boolean)[0]?.replace(/-/g, " ") || "";
}

function parseRent(text: string, jsonRoots: unknown[]): string {
  const fromJson = firstStringFromJson(jsonRoots, ["price", "rent", "amount"]);
  if (fromJson) {
    const money = fromJson.match(/\$[\d,]+/);
    return money?.[0] || fromJson;
  }

  const patterns = [
    /\$[\d,]+\s*(?:\/mo|per month|monthly)?/i,
    /rent(?:al)?\s*(?:price)?\s*[:\-]?\s*(\$[\d,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return cleanText(match[1] || match[0]);
  }
  return "";
}

function parseMetric(text: string, jsonRoots: unknown[], jsonKeys: string[], regexes: RegExp[]): string {
  const fromJson = firstStringFromJson(jsonRoots, jsonKeys);
  if (fromJson) return fromJson;
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) return cleanText(match[1] || match[0]);
  }
  return "";
}

function parseRoomsDesc(text: string): string {
  const descriptionStart = text.match(/(?:Description|About this home|This is|Welcome to)([\s\S]{0,700}?)(?:Amenities|Building|Policies|Home Services|Explore|Listed By|Report listing)/i);
  if (descriptionStart) return cleanText(descriptionStart[0]).slice(0, 360);
  const standalone = text.match(/This\s+(?:is|home|unit|apartment)[^.]{20,360}\./i);
  return standalone ? cleanText(standalone[0]) : "";
}

function parseDatePosted(text: string, publishedDate?: string): string {
  const listed = text.match(/(?:Listed|Date Posted|Posted)\s*(?:on|:)?\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (listed) return cleanText(listed[1]);

  const days = text.match(/Days on market\s*(\d+\s+days?)/i);
  if (days) return `${cleanText(days[1])} on market`;

  if (publishedDate) {
    const date = new Date(publishedDate);
    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return "";
}

function parseAmenities(text: string, jsonRoots: unknown[]): string[] {
  const fromJson = allStringsFromJson(jsonRoots, ["amenities", "amenity", "features", "buildingamenities", "unitamenities"]);
  const known = [
    "Dishwasher",
    "Doorman",
    "Elevator",
    "Laundry in Unit",
    "In-unit Laundry",
    "Washer/Dryer",
    "Laundry in Building",
    "Live-in Super",
    "Hardwood Floors",
    "Gym",
    "Fitness Center",
    "Bike Room",
    "Storage",
    "Pets Allowed",
    "Cats and Dogs Allowed",
    "Central Air",
  ].filter((amenity) => new RegExp(`\\b${amenity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

  const amenitiesBlock = text.match(/Amenities\s*([\s\S]{0,1000}?)(?:Policies|Home Services|Explore|Transit|Listed By|Report listing)/i);
  const blockItems = amenitiesBlock
    ? amenitiesBlock[1]
        .split(/\s{2,}|•|\n|,/)
        .map(cleanText)
        .filter((item) => item.length > 2 && item.length < 80 && !/days on market|listed by|base rent/i.test(item))
    : [];

  return uniq([...fromJson, ...known, ...blockItems]).slice(0, 30);
}

function parseLaundry(amenities: string[], text: string): { hasInUnitLaundry: boolean; hasInBuildingLaundry: boolean } {
  const haystack = `${amenities.join(" ")} ${text}`.toLowerCase();
  const hasInUnitLaundry =
    /\bin[-\s]?unit laundry\b/.test(haystack) ||
    /\blaundry in unit\b/.test(haystack) ||
    /\bwasher\s*\/\s*dryer\b/.test(haystack) ||
    /\bwasher and dryer\b/.test(haystack);
  const hasInBuildingLaundry =
    /\bin[-\s]?building laundry\b/.test(haystack) ||
    /\blaundry in building\b/.test(haystack) ||
    /\blaundry room\b/.test(haystack) ||
    /\blaundry facilities\b/.test(haystack);

  return { hasInUnitLaundry, hasInBuildingLaundry };
}

function deriveRoomsDesc(beds: string, rooms: string, bath: string, sqFt: string, textDesc: string): string {
  const parts = [beds && `${beds} bed`, rooms && `${rooms} rooms`, bath && `${bath} bath`, sqFt && `${sqFt} sq ft`].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return textDesc;
}

function parseListingFromHtml(url: string, html: string, publishedDate?: string): InsertListing {
  const parsedUrl = new URL(url);
  const text = cleanText(html);
  const jsonRoots = [...extractJsonLd(html), ...extractNextData(html)];

  const amenities = parseAmenities(text, jsonRoots);
  const beds = parseMetric(text, jsonRoots, ["bedrooms", "beds", "numberofbedrooms"], [
    /(\d+(?:\.\d+)?)\s*(?:bed|beds|br)\b/i,
    /\b(studio)\b/i,
  ]);
  const rooms = parseMetric(text, jsonRoots, ["rooms", "totalrooms", "numberofrooms"], [
    /(\d+(?:\.\d+)?)\s*(?:room|rooms)\b/i,
  ]);
  const sqFt = parseMetric(text, jsonRoots, ["sqft", "squarefeet", "floorSize", "floorarea", "size"], [
    /([\d,]+)\s*(?:ft²|sq\.?\s*ft\.?|square feet)\b/i,
  ]);
  const bath = parseMetric(text, jsonRoots, ["bathrooms", "baths", "numberofbathrooms"], [
    /(\d+(?:\.\d+)?)\s*(?:bath|baths|ba)\b/i,
  ]);
  const roomsDesc = deriveRoomsDesc(beds, rooms, bath, sqFt, parseRoomsDesc(text));
  const laundry = parseLaundry(amenities, text);

  const missing = [
    ["rent", parseRent(text, jsonRoots)],
    ["beds", beds],
    ["bath", bath],
    ["sq ft", sqFt],
  ].filter(([, value]) => !value);

  return {
    link: url,
    neighborhood: parseNeighborhood(html, text, parsedUrl, jsonRoots),
    rent: parseRent(text, jsonRoots),
    beds,
    rooms,
    roomsDesc,
    bath,
    sqFt,
    pplxDist: "",
    sevenTwoDist: "",
    datePosted: parseDatePosted(text, publishedDate),
    amenities: JSON.stringify(amenities),
    hasInUnitLaundry: laundry.hasInUnitLaundry,
    hasInBuildingLaundry: laundry.hasInBuildingLaundry,
    parseStatus: missing.length
      ? `Imported with ${missing.map(([field]) => field).join(", ")} unresolved. Edit the row if StreetEasy hid those fields.`
      : "Imported",
    createdAt: new Date().toISOString(),
  };
}

function parseListingFromText(url: string, pageText: string): InsertListing {
  const escapedText = pageText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return {
    ...parseListingFromHtml(url, escapedText),
    parseStatus: "Imported from pasted page text",
  };
}

async function fetchStreetEasy(url: string): Promise<{ html: string; source: string; publishedDate?: string }> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  const html = await response.text();

  if (response.ok && html.length > 500 && !/captcha|access denied|just a moment/i.test(html)) {
    return { html, source: "direct" };
  }

  throw new Error(`StreetEasy returned ${response.status}. The app could not fetch enough page content directly.`);
}

function formatZodError(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/listings", async (_req, res) => {
    res.json(await storage.listListings());
  });

  app.post("/api/listings", async (req, res) => {
    try {
      const listing = insertListingSchema.parse(req.body);
      res.status(201).json(await storage.createListing(listing));
    } catch (error) {
      res.status(400).json({ message: error instanceof ZodError ? formatZodError(error) : "Invalid listing" });
    }
  });

  app.post("/api/listings/import", async (req, res) => {
    try {
      const { url, pageText } = importUrlSchema.parse(req.body);
      if (pageText?.trim()) {
        const parsed = parseListingFromText(url, pageText);
        const saved = await storage.createListing(parsed);
        res.status(201).json(saved);
        return;
      }

      const { html, source, publishedDate } = await fetchStreetEasy(url);
      const parsed = parseListingFromHtml(url, html, publishedDate);
      const saved = await storage.createListing({
        ...parsed,
        parseStatus: `${parsed.parseStatus}${source === "direct" ? "" : ` via ${source}`}`,
      });
      res.status(201).json(saved);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: formatZodError(error) });
        return;
      }
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      const placeholder = await storage.createListing({
        link: url,
        neighborhood: "",
        rent: "",
        beds: "",
        rooms: "",
        roomsDesc: "",
        bath: "",
        sqFt: "",
        pplxDist: "",
        sevenTwoDist: "",
        datePosted: "",
        amenities: "[]",
        hasInUnitLaundry: false,
        hasInBuildingLaundry: false,
        parseStatus:
          error instanceof Error
            ? `Fetch failed: ${error.message}. Row created for manual editing.`
            : "Fetch failed. Row created for manual editing.",
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(placeholder);
    }
  });

  app.patch("/api/listings/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ message: "Invalid listing id" });
        return;
      }

      const listing = updateListingSchema.parse(req.body);
      const updated = await storage.updateListing(id, listing);
      if (!updated) {
        res.status(404).json({ message: "Listing not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(400).json({ message: error instanceof ZodError ? formatZodError(error) : "Invalid listing update" });
    }
  });

  app.delete("/api/listings/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ message: "Invalid listing id" });
      return;
    }
    const deleted = await storage.deleteListing(id);
    res.status(deleted ? 204 : 404).end();
  });

  app.delete("/api/listings", async (_req, res) => {
    await storage.clearListings();
    res.status(204).end();
  });

  return httpServer;
}
