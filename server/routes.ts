import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { importUrlSchema, insertListingSchema, updateListingSchema } from "@shared/schema";
import type { InsertListing } from "@shared/schema";
import { storage } from "./storage";
import { ZodError } from "zod";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ApifyItem = Record<string, unknown>;
type PriceHistory = {
  date?: string;
  price?: number | string;
  description?: string;
  event?: string;
};

const DEFAULT_APIFY_ACTOR = "memo23/streeteasy-ppr";
const PPLX_OFFICE_ADDRESS = "853 Broadway, New York, NY 10003";
const SEVEN_TWO_ADDRESS = "55 Hudson Yards, New York, NY 10001";

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

function readString(item: ApifyItem, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const cleaned = cleanText(value);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

function readNumberLike(item: ApifyItem, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") {
      const cleaned = cleanText(value);
      if (cleaned && /[\d.]/.test(cleaned)) return cleaned;
    }
  }
  return "";
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function firstRecordFromJson(value: unknown): ApifyItem {
  if (Array.isArray(value)) {
    return (value.find((item) => item && typeof item === "object") as ApifyItem | undefined) || {};
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return (parsed.find((item) => item && typeof item === "object") as ApifyItem | undefined) || {};
    }
    return parsed && typeof parsed === "object" ? (parsed as ApifyItem) : {};
  } catch {
    return {};
  }
}

function formatMoney(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  if (typeof value === "string") {
    const cleaned = cleanText(value);
    if (!cleaned) return "";
    const money = cleaned.match(/\$[\d,]+/);
    if (money) return money[0];
    const numeric = cleaned.match(/\b\d{3,7}\b/);
    if (numeric) return `$${Number(numeric[0]).toLocaleString("en-US")}`;
    return cleaned;
  }
  return "";
}

function rentFromPriceHistory(value: unknown): { rent: string; datePosted: string } {
  const histories = parseJsonArray<PriceHistory>(value);
  const listed =
    histories.find((entry) => String(entry.event || "").toUpperCase() === "LISTED") ||
    histories.find((entry) => /listed/i.test(String(entry.description || ""))) ||
    histories[0];

  return {
    rent: formatMoney(listed?.price),
    datePosted: listed?.date ? cleanText(listed.date) : "",
  };
}

function extractAmenitiesFromApify(item: ApifyItem): string[] {
  const explicit = allStringsFromJson(item, [
    "amenities",
    "amenity",
    "buildingamenities",
    "unitamenities",
    "matchedamenities",
    "missingamenities",
  ]);
  const description = readString(item, [
    "combineData_rental_description",
    "listingDescription",
    "description",
    "buildingDescription",
  ]);
  const inferred = [
    /\blaundry room\b/i.test(description) && "Laundry room",
    /\bno broker fee\b/i.test(description) && "No broker fee",
    /\bfurnished\b/i.test(description) && "Furnished",
    item.combineData_rental_is_furnished === true && "Furnished",
  ].filter(Boolean) as string[];
  return uniq([...parseAmenities(description, [item]), ...explicit, ...inferred]);
}

function normalizedStreetEasyUrl(value: string, fallback: string): string {
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `https://streeteasy.com${value}`;
  return fallback;
}

function extractContactFromApify(item: ApifyItem): { contactName: string; contactEmail: string; contactPhone: string } {
  const contact = firstRecordFromJson(
    item.combineData_rental_contacts_json ||
      item.contacts ||
      item.contact ||
      item.combineData_rental_contact_json,
  );
  const contactName =
    readString(contact, ["name", "contactName", "agentName", "display_name", "fullName"]) ||
    readString(item, ["contactName", "agentName", "combineData_rental_contact_name"]);
  const contactEmail =
    readString(contact, ["email", "contactEmail", "agentEmail"]) ||
    readString(item, ["contactEmail", "agentEmail", "combineData_rental_contact_email"]);
  const contactPhone =
    readString(contact, ["phone", "phoneNumber", "primary_phone", "primaryPhone", "mobile_phone", "cell"]) ||
    readString(item, ["contactPhone", "agentPhone", "phone", "combineData_rental_contact_phone"]);

  return { contactName, contactEmail, contactPhone };
}

function originFromApify(item: ApifyItem): { origin: string; latitude: string; longitude: string } {
  const latitude = readNumberLike(item, [
    "combineData_rental_address_latitude",
    "combineData_building_address_latitude",
    "address_latitude",
    "latitude",
    "lat",
  ]);
  const longitude = readNumberLike(item, [
    "combineData_rental_address_longitude",
    "combineData_building_address_longitude",
    "address_longitude",
    "longitude",
    "lng",
    "lon",
  ]);

  if (latitude && longitude) return { origin: `${latitude},${longitude}`, latitude, longitude };

  const address = [
    readString(item, ["combineData_rental_building_title", "buildingTitle", "building_title"]),
    readString(item, ["combineData_rental_address_address", "address", "streetAddress", "street_address"]),
    readString(item, ["combineData_rental_address_city", "city"]),
    readString(item, ["combineData_rental_address_state", "state"]),
    readString(item, ["combineData_rental_address_zipcode", "zipcode", "zip", "postalCode"]),
  ]
    .filter(Boolean)
    .join(", ");

  return { origin: address, latitude, longitude };
}

function waypointFor(value: string): Record<string, unknown> {
  const coordinateMatch = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordinateMatch) {
    return {
      location: {
        latLng: {
          latitude: Number(coordinateMatch[1]),
          longitude: Number(coordinateMatch[2]),
        },
      },
    };
  }

  return { address: value };
}

function formatRouteDuration(value: string | undefined): string {
  const seconds = Number(value?.replace(/s$/, ""));
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${totalMinutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

async function getTransitCommute(origin: string, destination: string): Promise<string> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !origin) return "";

  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.legs.duration",
      },
      body: JSON.stringify({
        origin: waypointFor(origin),
        destination: waypointFor(destination),
        travelMode: "TRANSIT",
        departureTime: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { routes?: Array<{ duration?: string; legs?: Array<{ duration?: string }> }> };
    const route = payload.routes?.[0];
    return formatRouteDuration(route?.duration || route?.legs?.[0]?.duration);
  } catch {
    return "";
  }
}

async function mapApifyItemToListing(url: string, item: ApifyItem): Promise<InsertListing> {
  const priceHistory = rentFromPriceHistory(item.combineData_rental_price_histories_json);
  const description = readString(item, [
    "combineData_rental_description",
    "listingDescription",
    "description",
    "buildingDescription",
  ]);
  const amenities = extractAmenitiesFromApify(item);
  const laundry = parseLaundry(amenities, description);
  const link = normalizedStreetEasyUrl(
    readString(item, ["combineData_rental_quick_url", "url", "urlPath", "combineData_rental_url_path", "originalUrl"]),
    url,
  );
  const beds = readNumberLike(item, [
    "combineData_rental_bedroom_count",
    "combineData_rental_bedrooms",
    "bedroomCount",
    "bedroom_count",
    "beds",
  ]);
  const rooms = readNumberLike(item, [
    "combineData_rental_anyrooms",
    "anyrooms",
    "rooms",
    "roomCount",
    "room_count",
  ]);
  const fullBaths = readNumberLike(item, [
    "combineData_rental_full_bathroom_count",
    "fullBathroomCount",
    "full_bathroom_count",
    "baths",
    "bathrooms",
  ]);
  const halfBaths = readNumberLike(item, [
    "combineData_rental_half_bathroom_count",
    "halfBathroomCount",
    "half_bathroom_count",
  ]);
  const bath =
    fullBaths && halfBaths
      ? String(Number(fullBaths) + Number(halfBaths) / 2).replace(/\.0$/, "")
      : fullBaths || halfBaths;
  const sqFt = readNumberLike(item, [
    "combineData_rental_living_area_size",
    "livingAreaSize",
    "living_area_size",
    "sqft",
    "squareFeet",
  ]);
  const rent = formatMoney(readString(item, ["combineData_rental_price", "price", "rent"])) || priceHistory.rent;
  const listedAt = readString(item, ["combineData_rental_listed_at", "listedAt", "listed_at"]);
  const datePosted =
    priceHistory.datePosted ||
    (listedAt && !Number.isNaN(new Date(listedAt).valueOf()) ? new Date(listedAt).toISOString().slice(0, 10) : listedAt);
  const daysOnMarket = readNumberLike(item, ["combineData_rental_days_on_market", "daysOnMarket", "days_on_market"]);
  const dateWithDays = datePosted && daysOnMarket ? `${datePosted} (${daysOnMarket} days on market)` : datePosted;
  const borough = readString(item, [
    "combineData_rental_area_borough_name",
    "combineData_area_borough_name",
    "boroughName",
    "borough",
  ]);
  const buildingTitle = readString(item, [
    "combineData_rental_building_title",
    "combineData_building_title",
    "buildingTitle",
    "building_title",
    "title",
  ]);
  const yearBuilt = readNumberLike(item, [
    "combineData_rental_building_year_built",
    "combineData_building_year_built",
    "buildingYearBuilt",
    "yearBuilt",
    "year_built",
  ]);
  const openRentalsCount = readNumberLike(item, [
    "combineData_rental_building_open_rentals_count",
    "combineData_building_open_rentals_count",
    "openRentalsCount",
    "open_rentals_count",
  ]);
  const listingStatus = readString(item, [
    "combineData_rental_status_title",
    "combineData_rental_status",
    "statusTitle",
    "listingStatus",
    "status",
  ]);
  const contact = extractContactFromApify(item);
  const { origin, latitude, longitude } = originFromApify(item);
  const [pplxDist, sevenTwoDist] = await Promise.all([
    getTransitCommute(origin, PPLX_OFFICE_ADDRESS),
    getTransitCommute(origin, SEVEN_TWO_ADDRESS),
  ]);
  const missing = [
    ["rent", rent],
    ["beds", beds],
    ["bath", bath],
    ["sq ft", sqFt],
  ].filter(([, value]) => !value);
  const commuteStatus = process.env.GOOGLE_MAPS_API_KEY ? "" : " Transit times require GOOGLE_MAPS_API_KEY.";

  return {
    link,
    neighborhood: readString(item, [
      "combineData_rental_area_name",
      "areaName",
      "area_name",
      "neighborhood",
      "address_addressLocality",
    ]),
    borough,
    buildingTitle,
    rent,
    beds,
    rooms,
    roomsDesc: deriveRoomsDesc(beds, rooms, bath, sqFt, description).slice(0, 700),
    bath,
    sqFt,
    pplxDist,
    sevenTwoDist,
    datePosted: dateWithDays,
    yearBuilt,
    openRentalsCount,
    listingStatus,
    description: description.slice(0, 4000),
    contactName: contact.contactName,
    contactEmail: contact.contactEmail,
    contactPhone: contact.contactPhone,
    amenities: JSON.stringify(amenities),
    hasInUnitLaundry: laundry.hasInUnitLaundry,
    hasInBuildingLaundry: laundry.hasInBuildingLaundry,
    latitude,
    longitude,
    bbLizardRating: 0,
    bbCrabRating: 0,
    rating: 0,
    parseStatus: missing.length
      ? `Imported via Apify (${missing.map(([field]) => field).join(", ")} unresolved).${commuteStatus}`
      : `Imported via Apify.${commuteStatus}`.trim(),
    createdAt: new Date().toISOString(),
  };
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
    borough: firstStringFromJson(jsonRoots, ["borough", "boroughname"]) || "",
    buildingTitle: cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").split("|")[0]?.trim() || "",
    rent: parseRent(text, jsonRoots),
    beds,
    rooms,
    roomsDesc,
    bath,
    sqFt,
    pplxDist: "",
    sevenTwoDist: "",
    datePosted: parseDatePosted(text, publishedDate),
    yearBuilt: firstStringFromJson(jsonRoots, ["yearbuilt", "buildingyearbuilt"]) || "",
    openRentalsCount: "",
    listingStatus: "",
    description: parseRoomsDesc(text),
    contactName: firstStringFromJson(jsonRoots, ["contactname", "agentname", "name"]) || "",
    contactEmail: firstStringFromJson(jsonRoots, ["email", "contactemail", "agentemail"]) || "",
    contactPhone: firstStringFromJson(jsonRoots, ["telephone", "phone", "contactphone", "agentphone"]) || "",
    amenities: JSON.stringify(amenities),
    hasInUnitLaundry: laundry.hasInUnitLaundry,
    hasInBuildingLaundry: laundry.hasInBuildingLaundry,
    latitude: "",
    longitude: "",
    bbLizardRating: 0,
    bbCrabRating: 0,
    rating: 0,
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

function apifyActorIdForUrl(actor: string): string {
  return actor.replace("/", "~");
}

function buildApifyInput(actor: string, url: string): Record<string, unknown> {
  if (actor === "memo23/streeteasy-ppr" || actor === "memo23/apify-streeteasy-cheerio") {
    return {
      startUrls: [{ url }],
      maxItems: 1,
      maxConcurrency: 1,
      minConcurrency: 1,
      maxRequestRetries: 3,
      monitoringMode: false,
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    };
  }

  if (actor === "shahidirfan/streeteasy-scraper") {
    return {
      start_url: url,
      listing_type: "for-rent",
      results_wanted: 1,
      max_pages: 1,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    };
  }

  if (actor === "kawsar/streeteasy-scraper-it-work" || actor === "kawsar/streeteasy-scraper") {
    return {
      searchUrl: url,
      listingType: "for-rent",
      maxResults: 1,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    };
  }

  return {
    startUrls: [{ url }],
    maxItems: 1,
    maxResults: 1,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  };
}

async function importWithApify(url: string): Promise<InsertListing> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN is not configured.");
  }

  const actor = process.env.APIFY_ACTOR || DEFAULT_APIFY_ACTOR;
  const endpoint = `https://api.apify.com/v2/acts/${apifyActorIdForUrl(actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(
    token,
  )}&timeout=240`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildApifyInput(actor, url)),
  });
  const bodyText = await response.text();

  if (!response.ok) {
    let detail = bodyText.slice(0, 500);
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: string; type?: string } };
      detail = parsed.error?.message || parsed.error?.type || detail;
    } catch {
      // Keep raw detail.
    }
    throw new Error(`Apify actor ${actor} failed: ${detail}`);
  }

  let items: ApifyItem[];
  try {
    const parsed = JSON.parse(bodyText);
    items = Array.isArray(parsed) ? (parsed as ApifyItem[]) : [];
  } catch {
    throw new Error(`Apify actor ${actor} returned unreadable JSON.`);
  }

  const item = items.find((candidate) => !candidate.error && Object.keys(candidate).length > 0);
  if (!item) {
    throw new Error(`Apify actor ${actor} returned no listing data for this URL.`);
  }

  return mapApifyItemToListing(url, item);
}

function formatZodError(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function isAuthenticated(password: unknown): boolean {
  if (!process.env.APP_PASSWORD_SHA256 || typeof password !== "string") return false;
  return timingSafeEqual(sha256(password), process.env.APP_PASSWORD_SHA256);
}

function authToken(): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update("nyc-apt-search").digest("hex");
}

function isValidToken(token: unknown): boolean {
  const expected = authToken();
  return typeof token === "string" && Boolean(expected) && timingSafeEqual(token, expected);
}

function hasAccess(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return isAuthenticated(req.headers["x-app-password"]) || isValidToken(req.headers["x-app-token"]);
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/auth/status", async (req, res) => {
    res.json({ authenticated: hasAccess(req) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const expectedHash = process.env.APP_PASSWORD_SHA256;

    if (!expectedHash || !process.env.APP_SESSION_SECRET) {
      res.status(503).json({ message: "App password is not configured" });
      return;
    }

    if (!timingSafeEqual(sha256(password), expectedHash)) {
      res.status(401).json({ message: "Incorrect password" });
      return;
    }

    res.json({ token: authToken() });
  });

  app.use("/api/listings", (req, res, next) => {
    if (hasAccess(req)) {
      next();
      return;
    }
    res.status(401).json({ message: "Password required" });
  });

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

      if (process.env.APIFY_TOKEN) {
        const parsed = await importWithApify(url);
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

      res.status(409).json({
        message:
          error instanceof Error
            ? `${error.message} Paste the visible StreetEasy listing text into the fallback box and import again.`
            : "StreetEasy/Apify import failed. Paste the visible listing text into the fallback box and import again.",
      });
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

  return httpServer;
}
