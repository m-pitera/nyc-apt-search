import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpDown,
  Check,
  ExternalLink,
  Home,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ListingView } from "@shared/schema";

const formSchema = z.object({
  url: z.string().url("Paste a full StreetEasy URL").refine((value) => {
    try {
      return new URL(value).hostname.replace(/^www\./, "") === "streeteasy.com";
    } catch {
      return false;
    }
  }, "Only streeteasy.com URLs are supported"),
  pageText: z.string().optional(),
});

type ImportFormValues = z.infer<typeof formSchema>;

type EditableListing = Omit<ListingView, "amenities"> & {
  amenities: string;
};

type DisplayFieldKey = keyof EditableListing;
type FieldType = "text" | "textarea" | "boolean";
type SortKey =
  | "neighborhood"
  | "rent"
  | "pplxDist"
  | "sevenTwoDist"
  | "datePosted"
  | "yearBuilt"
  | "averageRating"
  | "hasInUnitLaundry"
  | "hasInBuildingLaundry";
type SortDirection = "asc" | "desc";
type LaundryFilter = "any" | "yes" | "no";

type FilterState = {
  neighborhood: string;
  rentMax: string;
  pplxMax: string;
  sevenTwoMax: string;
  inUnitLaundry: LaundryFilter;
  inBuildingLaundry: LaundryFilter;
};

const defaultFilters: FilterState = {
  neighborhood: "",
  rentMax: "",
  pplxMax: "",
  sevenTwoMax: "",
  inUnitLaundry: "any",
  inBuildingLaundry: "any",
};

const sampleUrl = "https://streeteasy.com/building/436-east-75-street-new_york/2re?from_map=1";

const fieldLabels: Array<[DisplayFieldKey, string, FieldType]> = [
  ["link", "Link", "text"],
  ["neighborhood", "Neighborhood", "text"],
  ["borough", "Borough", "text"],
  ["buildingTitle", "Building title", "text"],
  ["rent", "Rent", "text"],
  ["beds", "# Beds", "text"],
  ["rooms", "# Rooms", "text"],
  ["roomsDesc", "Rooms Desc", "textarea"],
  ["bath", "# Bath", "text"],
  ["sqFt", "Sq Ft.", "text"],
  ["pplxDist", "PPLX Dist", "text"],
  ["sevenTwoDist", ".72 Dist", "text"],
  ["datePosted", "Date Posted", "text"],
  ["yearBuilt", "Year built", "text"],
  ["openRentalsCount", "Open rentals count", "text"],
  ["listingStatus", "Listing status", "text"],
  ["description", "Description", "textarea"],
  ["amenities", "Amenities", "textarea"],
  ["hasInUnitLaundry", "Has in-unit laundry", "boolean"],
  ["hasInBuildingLaundry", "Has in-building laundry", "boolean"],
  ["contactName", "Contact name", "text"],
  ["contactEmail", "Contact email", "text"],
  ["contactPhone", "Contact phone", "text"],
];

const columnWidths: Partial<Record<DisplayFieldKey, string>> = {
  link: "w-[120px]",
  neighborhood: "w-[140px]",
  borough: "w-[120px]",
  buildingTitle: "w-[180px]",
  rent: "w-[100px]",
  beds: "w-[80px]",
  rooms: "w-[85px]",
  roomsDesc: "w-[220px]",
  bath: "w-[80px]",
  sqFt: "w-[90px]",
  pplxDist: "w-[120px]",
  sevenTwoDist: "w-[120px]",
  datePosted: "w-[180px]",
  yearBuilt: "w-[100px]",
  openRentalsCount: "w-[150px]",
  listingStatus: "w-[130px]",
  description: "w-[300px]",
  amenities: "w-[220px]",
  hasInUnitLaundry: "w-[130px]",
  hasInBuildingLaundry: "w-[150px]",
  contactName: "w-[160px]",
  contactEmail: "w-[180px]",
  contactPhone: "w-[150px]",
};

function averageRating(listing: Pick<ListingView, "bbLizardRating" | "bbCrabRating">): string {
  const ratings = [Number(listing.bbLizardRating) || 0, Number(listing.bbCrabRating) || 0].filter((value) => value > 0);
  if (!ratings.length) return "";
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return Number.isInteger(average) ? String(average) : average.toFixed(1);
}

function parseNumber(value: string): number {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  if (!cleaned) return Number.NaN;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function parseDateValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function sortableValue(listing: ListingView, key: SortKey): number | string {
  if (key === "neighborhood") return `${listing.neighborhood || ""} ${listing.borough || ""}`.trim().toLowerCase();
  if (key === "hasInUnitLaundry" || key === "hasInBuildingLaundry") return Number(listing[key]);
  if (key === "averageRating") return parseNumber(averageRating(listing));
  if (key === "datePosted") return parseDateValue(listing.datePosted);
  return parseNumber(String(listing[key] ?? ""));
}

function truncateText(value: string, maxLength = 140): string {
  const cleaned = value.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}

function matchesLaundryFilter(value: boolean, filter: LaundryFilter): boolean {
  if (filter === "any") return true;
  return filter === "yes" ? value : !value;
}

function listingToEditable(listing: ListingView): EditableListing {
  return {
    ...listing,
    amenities: listing.amenities.join(", "),
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function createCsv(listings: ListingView[]): string {
  const ratingHeaders = ["bb-lizard rating", "bb-lizard comment", "bb-crab rating", "bb-crab comment", "Average rating"];
  const headers = [...fieldLabels.map(([, label]) => label), ...ratingHeaders];
  const rows = listings.map((listing) =>
    [
      ...fieldLabels.map(([key, , type]) => {
      if (key === "amenities") return listing.amenities.join("; ");
      if (type === "boolean") return listing[key] ? "TRUE" : "FALSE";
      return String(listing[key] ?? "");
      }),
      Number(listing.bbLizardRating) ? String(listing.bbLizardRating) : "",
      listing.bbLizardComment || "",
      Number(listing.bbCrabRating) ? String(listing.bbCrabRating) : "",
      listing.bbCrabComment || "",
      averageRating(listing),
    ],
  );

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function downloadCsv(listings: ListingView[]) {
  const csv = createCsv(listings);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "streeteasy-listings.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (/failed|unresolved|manual/i.test(status)) return "secondary";
  if (/imported/i.test(status)) return "default";
  return "outline";
}

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="button-theme"
      onClick={() => setDark((value) => !value)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function ImportPanel({ count, onImported }: { count: number; onImported: () => void }) {
  const { toast } = useToast();
  const form = useForm<ImportFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "", pageText: "" },
  });

  const importMutation = useMutation({
    mutationFn: async (values: ImportFormValues) => {
      const response = await apiRequest("POST", "/api/listings/import", values);
      return (await response.json()) as ListingView;
    },
    onSuccess: (listing) => {
      queryClient.setQueryData<ListingView[]>(["/api/listings"], (current = []) => [
        listing,
        ...current.filter((row) => row.id !== listing.id),
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      onImported();
      form.reset({ url: "", pageText: "" });
      toast({
        title: "Listing added",
        description: "Added to the table and cleared filters so the new row is visible.",
      });
    },
    onError: (error) => {
      toast({
        title: "Import needs review",
        description: error instanceof Error ? error.message : "Please check the URL and try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="border-card-border shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl tracking-tight">StreetEasy table builder</CardTitle>
            <CardDescription>
              Paste a listing URL, import through Apify when configured, then polish the row directly in the table.
            </CardDescription>
          </div>
          <Badge variant="outline" data-testid="text-listing-count">
            {count} {count === 1 ? "row" : "rows"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => importMutation.mutate(values))}
          >
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>StreetEasy URL</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          {...field}
                          className="pl-9"
                          placeholder={sampleUrl}
                          autoComplete="off"
                          data-testid="input-url"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-sample-url"
                  onClick={() => form.setValue("url", sampleUrl, { shouldValidate: true })}
                >
                  Use sample
                </Button>
                <Button type="submit" disabled={importMutation.isPending} data-testid="button-import">
                  {importMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                  Import
                </Button>
              </div>
            </div>
            <FormField
              control={form.control}
              name="pageText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Optional page text fallback</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      className="resize-y text-sm"
                      placeholder="If StreetEasy blocks server-side fetch, copy the visible listing text from your browser and paste it here. The importer will parse rent, beds, baths, sq ft, neighborhood, date, amenities, and laundry flags from the text."
                      data-testid="input-page-text"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function EditableCell({
  value,
  type,
  onChange,
  testId,
}: {
  value: string | number | boolean;
  type: "text" | "textarea" | "boolean" | "rating";
  onChange: (value: string | number | boolean) => void;
  testId: string;
}) {
  if (type === "boolean") {
    return (
      <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked === true)} data-testid={testId} />
    );
  }

  if (type === "textarea") {
    return (
      <Textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="min-w-48 resize-y text-sm"
        data-testid={testId}
      />
    );
  }

  if (type === "rating") {
    return (
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={5}
        value={Number(value) || ""}
        onChange={(event) => {
          const next = event.target.value === "" ? 0 : Math.max(1, Math.min(5, Number(event.target.value)));
          onChange(next);
        }}
        className="min-w-16 text-sm"
        placeholder="1-5"
        data-testid={testId}
      />
    );
  }

  return (
    <Input
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-24 text-sm"
      data-testid={testId}
    />
  );
}

function DescriptionCell({ listing }: { listing: ListingView }) {
  const description = listing.description?.trim();
  if (!description) {
    return (
      <span className="block text-xs leading-tight text-muted-foreground" data-testid={`text-description-${listing.id}`}>
        —
      </span>
    );
  }

  return (
    <div className="space-y-2" data-testid={`text-description-${listing.id}`}>
      <p className="line-clamp-3 text-xs leading-tight">{truncateText(description)}</p>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" className="h-auto p-0 text-xs text-primary hover:bg-transparent hover:underline" data-testid={`button-description-${listing.id}`}>
            View full description
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{listing.buildingTitle || "Listing description"}</DialogTitle>
            <DialogDescription>
              {listing.neighborhood || "Unknown neighborhood"}
              {listing.rent ? ` · ${listing.rent}` : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{description}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RatingPicker({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label} data-testid={testId}>
        {[1, 2, 3, 4, 5].map((rating) => {
          const selected = Number(value) === rating;
          return (
            <Button
              key={rating}
              type="button"
              size="icon"
              variant={selected ? "default" : "outline"}
              className="size-7 text-xs"
              aria-pressed={selected}
              onClick={() => onChange(selected ? 0 : rating)}
              data-testid={`${testId}-${rating}`}
            >
              {rating}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function RatingCell({
  listing,
  disabled,
  onChange,
}: {
  listing: ListingView;
  disabled: boolean;
  onChange: (
    id: number,
    values: {
      bbLizardRating: number;
      bbCrabRating: number;
      bbLizardComment?: string;
      bbCrabComment?: string;
    },
  ) => void;
}) {
  const lizard = Number(listing.bbLizardRating) || 0;
  const crab = Number(listing.bbCrabRating) || 0;
  const average = averageRating(listing);
  const [lizardComment, setLizardComment] = useState(listing.bbLizardComment || "");
  const [crabComment, setCrabComment] = useState(listing.bbCrabComment || "");

  useEffect(() => {
    setLizardComment(listing.bbLizardComment || "");
    setCrabComment(listing.bbCrabComment || "");
  }, [listing.bbCrabComment, listing.bbLizardComment]);

  return (
    <div className={`space-y-3 ${disabled ? "pointer-events-none opacity-60" : ""}`} data-testid={`cell-rating-${listing.id}`}>
      <div className="rounded-md border border-border bg-primary/5 px-2 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Average</p>
        <p className="text-lg font-semibold tabular-nums" data-testid={`text-average-rating-${listing.id}`}>
          {average || "—"}
        </p>
      </div>
      <RatingPicker
        label="bb-lizard"
        value={lizard}
        onChange={(value) => onChange(listing.id, { bbLizardRating: value, bbCrabRating: crab })}
        testId={`rating-lizard-${listing.id}`}
      />
      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">bb-lizard comment</p>
        <Textarea
          value={lizardComment}
          onChange={(event) => setLizardComment(event.target.value)}
          rows={2}
          className="min-h-16 resize-y text-xs"
          placeholder="Add bb-lizard notes..."
          data-testid={`textarea-lizard-comment-${listing.id}`}
        />
      </div>
      <RatingPicker
        label="bb-crab"
        value={crab}
        onChange={(value) => onChange(listing.id, { bbLizardRating: lizard, bbCrabRating: value })}
        testId={`rating-crab-${listing.id}`}
      />
      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">bb-crab comment</p>
        <Textarea
          value={crabComment}
          onChange={(event) => setCrabComment(event.target.value)}
          rows={2}
          className="min-h-16 resize-y text-xs"
          placeholder="Add bb-crab notes..."
          data-testid={`textarea-crab-comment-${listing.id}`}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() =>
          onChange(listing.id, {
            bbLizardRating: lizard,
            bbCrabRating: crab,
            bbLizardComment: lizardComment,
            bbCrabComment: crabComment,
          })
        }
        data-testid={`button-save-rating-comments-${listing.id}`}
      >
        Save comments
      </Button>
    </div>
  );
}

function LaundryFilterButton({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: LaundryFilter;
  onChange: (value: LaundryFilter) => void;
  testId: string;
}) {
  const cycle = () => {
    onChange(value === "any" ? "yes" : value === "yes" ? "no" : "any");
  };

  return (
    <Button type="button" variant="outline" className="justify-start" onClick={cycle} data-testid={testId}>
      {label}: {value === "any" ? "Any" : value === "yes" ? "Yes" : "No"}
    </Button>
  );
}

function ListingTable({
  listings,
  isLoading,
  importVersion,
}: {
  listings: ListingView[];
  isLoading: boolean;
  importVersion: number;
}) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableListing | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "averageRating",
    direction: "desc",
  });

  useEffect(() => {
    if (importVersion > 0) {
      setFilters(defaultFilters);
    }
  }, [importVersion]);

  const visibleListings = useMemo(() => {
    const neighborhoodNeedle = filters.neighborhood.trim().toLowerCase();
    const rentMax = parseNumber(filters.rentMax);
    const pplxMax = parseNumber(filters.pplxMax);
    const sevenTwoMax = parseNumber(filters.sevenTwoMax);

    const filtered = listings.filter((listing) => {
      const neighborhoodMatch =
        !neighborhoodNeedle || `${listing.neighborhood} ${listing.borough}`.toLowerCase().includes(neighborhoodNeedle);
      const rentMatch = Number.isNaN(rentMax) || parseNumber(listing.rent) <= rentMax;
      const pplxMatch = Number.isNaN(pplxMax) || parseNumber(listing.pplxDist) <= pplxMax;
      const sevenTwoMatch = Number.isNaN(sevenTwoMax) || parseNumber(listing.sevenTwoDist) <= sevenTwoMax;
      return (
        neighborhoodMatch &&
        rentMatch &&
        pplxMatch &&
        sevenTwoMatch &&
        matchesLaundryFilter(listing.hasInUnitLaundry, filters.inUnitLaundry) &&
        matchesLaundryFilter(listing.hasInBuildingLaundry, filters.inBuildingLaundry)
      );
    });

    return [...filtered].sort((a, b) => {
      const multiplier = sort.direction === "asc" ? 1 : -1;
      const aValue = sortableValue(a, sort.key);
      const bValue = sortableValue(b, sort.key);

      if (typeof aValue === "string" || typeof bValue === "string") {
        return String(aValue).localeCompare(String(bValue)) * multiplier;
      }

      if (Number.isNaN(aValue) && Number.isNaN(bValue)) return 0;
      if (Number.isNaN(aValue)) return 1;
      if (Number.isNaN(bValue)) return -1;
      return (aValue - bValue) * multiplier;
    });
  }, [filters, listings, sort]);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (filters.neighborhood.trim()) labels.push(`Neighborhood/borough contains "${filters.neighborhood.trim()}"`);
    if (filters.rentMax.trim()) labels.push(`Rent ≤ ${filters.rentMax.trim()}`);
    if (filters.pplxMax.trim()) labels.push(`PPLX commute ≤ ${filters.pplxMax.trim()} min`);
    if (filters.sevenTwoMax.trim()) labels.push(`.72 commute ≤ ${filters.sevenTwoMax.trim()} min`);
    if (filters.inUnitLaundry !== "any") labels.push(`In-unit laundry is ${filters.inUnitLaundry}`);
    if (filters.inBuildingLaundry !== "any") labels.push(`In-building laundry is ${filters.inBuildingLaundry}`);
    return labels;
  }, [filters]);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" },
    );
  };

  const updateMutation = useMutation({
    mutationFn: async (values: EditableListing) => {
      const response = await apiRequest("PATCH", `/api/listings/${values.id}`, {
        ...values,
        bbLizardRating: Number(values.bbLizardRating) || 0,
        bbCrabRating: Number(values.bbCrabRating) || 0,
        amenities: values.amenities
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
      return (await response.json()) as ListingView;
    },
    onSuccess: () => {
      setEditingId(null);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Row saved", description: "Listing fields are updated." });
    },
  });

  const ratingMutation = useMutation({
    mutationFn: async ({
      id,
      bbLizardRating,
      bbCrabRating,
      bbLizardComment,
      bbCrabComment,
    }: {
      id: number;
      bbLizardRating: number;
      bbCrabRating: number;
      bbLizardComment?: string;
      bbCrabComment?: string;
    }) => {
      const response = await apiRequest("PATCH", `/api/listings/${id}`, {
        bbLizardRating,
        bbCrabRating,
        ...(bbLizardComment !== undefined ? { bbLizardComment } : {}),
        ...(bbCrabComment !== undefined ? { bbCrabComment } : {}),
      });
      return (await response.json()) as ListingView;
    },
    onMutate: async ({ id, bbLizardRating, bbCrabRating, bbLizardComment, bbCrabComment }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/listings"] });
      const previous = queryClient.getQueryData<ListingView[]>(["/api/listings"]);
      queryClient.setQueryData<ListingView[]>(["/api/listings"], (current = []) =>
        current.map((listing) =>
          listing.id === id
            ? {
                ...listing,
                bbLizardRating,
                bbCrabRating,
                ...(bbLizardComment !== undefined ? { bbLizardComment } : {}),
                ...(bbCrabComment !== undefined ? { bbCrabComment } : {}),
              }
            : listing,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/listings"], context.previous);
      }
      toast({ title: "Rating not saved", description: "Try updating the rating again.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/listings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Row deleted", description: "The listing was removed from the table." });
    },
  });

  const startEditing = (listing: ListingView) => {
    setEditingId(listing.id);
    setDraft(listingToEditable(listing));
  };

  const setDraftField = (key: keyof EditableListing, value: string | number | boolean) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Card className="border-card-border shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Listing rows</CardTitle>
            <CardDescription>
              Showing {visibleListings.length} of {listings.length} rows. Fields are editable because StreetEasy and third-party scrapers can omit listing-specific values.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!visibleListings.length}
              onClick={() => downloadCsv(visibleListings)}
              data-testid="button-export"
            >
              <ArrowDownToLine className="mr-2 size-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 lg:grid-cols-[1.4fr_repeat(3,0.8fr)_repeat(2,1fr)_auto]">
          <Input
            value={filters.neighborhood}
            onChange={(event) => updateFilter("neighborhood", event.target.value)}
            placeholder="Filter neighborhood / borough"
            className="text-sm"
            data-testid="input-filter-neighborhood"
          />
          <Input
            value={filters.rentMax}
            onChange={(event) => updateFilter("rentMax", event.target.value)}
            placeholder="Max rent"
            inputMode="numeric"
            className="text-sm"
            data-testid="input-filter-rent"
          />
          <Input
            value={filters.pplxMax}
            onChange={(event) => updateFilter("pplxMax", event.target.value)}
            placeholder="Max PPLX min"
            inputMode="numeric"
            className="text-sm"
            data-testid="input-filter-pplx"
          />
          <Input
            value={filters.sevenTwoMax}
            onChange={(event) => updateFilter("sevenTwoMax", event.target.value)}
            placeholder="Max .72 min"
            inputMode="numeric"
            className="text-sm"
            data-testid="input-filter-seven-two"
          />
          <LaundryFilterButton
            label="In-unit"
            value={filters.inUnitLaundry}
            onChange={(value) => updateFilter("inUnitLaundry", value)}
            testId="button-filter-in-unit"
          />
          <LaundryFilterButton
            label="In-building"
            value={filters.inBuildingLaundry}
            onChange={(value) => updateFilter("inBuildingLaundry", value)}
            testId="button-filter-in-building"
          />
          <Button type="button" variant="ghost" onClick={() => setFilters(defaultFilters)} data-testid="button-clear-filters">
            Clear filters
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-3" data-testid="state-loading">
            <div className="h-9 rounded-md bg-muted" />
            <div className="h-24 rounded-md bg-muted" />
          </div>
        ) : listings.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-border px-6 py-14 text-center" data-testid="state-empty">
            <div className="mb-4 rounded-full bg-primary/10 p-3 text-primary">
              <Home className="size-6" />
            </div>
            <h2 className="text-lg font-semibold">No listings yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Import the sample listing or paste another StreetEasy listing URL to create the first table row.
            </p>
          </div>
        ) : visibleListings.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-border px-6 py-14 text-center" data-testid="state-filtered-empty">
            <h2 className="text-lg font-semibold">No rows match these filters</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {listings.length} {listings.length === 1 ? "row exists" : "rows exist"}, but the current filters hide all of them.
            </p>
            {activeFilterLabels.length ? (
              <div className="mt-4 flex max-w-xl flex-wrap justify-center gap-2" data-testid="text-active-filters">
                {activeFilterLabels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            ) : null}
            <Button type="button" className="mt-5" variant="outline" onClick={() => setFilters(defaultFilters)} data-testid="button-reset-hidden-filters">
              Show all rows
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table className="min-w-[3480px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[320px] bg-muted/40 px-2 py-2 text-[10px] font-semibold uppercase leading-tight tracking-wide">
                    Ratings
                  </TableHead>
                  {fieldLabels.map(([key, label]) => (
                    <TableHead key={label} className={`${columnWidths[key] || ""} bg-muted/40 px-2 py-2 text-[10px] font-semibold uppercase leading-tight tracking-wide`}>
                      {(["neighborhood", "rent", "pplxDist", "sevenTwoDist", "datePosted", "yearBuilt", "hasInUnitLaundry", "hasInBuildingLaundry"] as DisplayFieldKey[]).includes(key) ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-left uppercase"
                          onClick={() => toggleSort(key as SortKey)}
                          data-testid={`button-sort-${String(key)}`}
                        >
                          {label}
                          <ArrowUpDown className="size-3" />
                          {sort.key === key ? <span>{sort.direction === "asc" ? "↑" : "↓"}</span> : null}
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  ))}
                  <TableHead className="w-[120px] bg-muted/40 px-2 py-2 text-[10px] font-semibold uppercase leading-tight tracking-wide">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-left uppercase"
                      onClick={() => toggleSort("averageRating")}
                      data-testid="button-sort-averageRating"
                    >
                      Avg rating
                      <ArrowUpDown className="size-3" />
                      {sort.key === "averageRating" ? <span>{sort.direction === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </TableHead>
                  <TableHead className="w-[180px] bg-muted/40 px-2 py-2 text-[10px] font-semibold uppercase leading-tight tracking-wide">
                    Status
                  </TableHead>
                  <TableHead className="w-[110px] bg-muted/40 px-2 py-2 text-[10px] font-semibold uppercase leading-tight tracking-wide">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleListings.map((listing) => {
                  const isEditing = editingId === listing.id && draft;
                  const row = isEditing ? draft : listingToEditable(listing);
                  return (
                    <TableRow key={listing.id} data-testid={`row-listing-${listing.id}`}>
                      <TableCell className="bg-card px-2 py-3 align-top">
                        <RatingCell
                          listing={listing}
                          disabled={ratingMutation.isPending}
                          onChange={(id, values) => ratingMutation.mutate({ id, ...values })}
                        />
                      </TableCell>
                      {fieldLabels.map(([key, label, type]) => (
                        <TableCell key={key} className="px-2 py-3 align-top">
                          {isEditing ? (
                            <EditableCell
                              value={row[key as keyof EditableListing] as string | number | boolean}
                              type={type}
                              testId={`input-${String(key)}-${listing.id}`}
                              onChange={(value) => setDraftField(key as keyof EditableListing, value)}
                            />
                          ) : key === "link" ? (
                            <a
                              href={listing.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-1 truncate text-xs text-primary underline-offset-4 hover:underline"
                              data-testid={`link-listing-${listing.id}`}
                              title={listing.link}
                            >
                              StreetEasy <ExternalLink className="size-3" />
                            </a>
                          ) : type === "boolean" ? (
                            <Checkbox
                              checked={Boolean(row[key as keyof EditableListing])}
                              disabled
                              aria-label={`${label} ${Boolean(row[key as keyof EditableListing]) ? "yes" : "no"}`}
                              data-testid={`checkbox-${String(key)}-${listing.id}`}
                            />
                          ) : key === "description" ? (
                            <DescriptionCell listing={listing} />
                          ) : (
                            <span
                              className="block break-words text-xs leading-tight"
                              data-testid={`text-${String(key)}-${listing.id}`}
                            >
                              {String(row[key as keyof EditableListing] || "—")}
                            </span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="bg-card px-2 py-3 align-top">
                        <span className="block text-xs font-semibold tabular-nums leading-tight" data-testid={`text-average-rating-column-${listing.id}`}>
                          {averageRating(listing) || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="bg-card px-2 py-3 align-top">
                        <Badge variant={statusVariant(listing.parseStatus)} className="whitespace-normal px-1.5 text-left text-[10px] leading-tight" data-testid={`status-${listing.id}`}>
                          {listing.parseStatus || "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="bg-card px-2 py-3 align-top">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="icon"
                              className="size-8"
                              aria-label={`Save listing ${listing.id}`}
                              disabled={updateMutation.isPending}
                              onClick={() => draft && updateMutation.mutate(draft)}
                              data-testid={`button-save-${listing.id}`}
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="size-8"
                              aria-label={`Cancel editing listing ${listing.id}`}
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                              }}
                              data-testid={`button-cancel-${listing.id}`}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="size-8"
                              aria-label={`Edit listing ${listing.id}`}
                              onClick={() => startEditing(listing)}
                              data-testid={`button-edit-${listing.id}`}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="size-8"
                              aria-label={`Delete listing ${listing.id}`}
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(listing.id)}
                              data-testid={`button-delete-${listing.id}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const [importVersion, setImportVersion] = useState(0);
  const { data: listings = [], isLoading, isFetching, refetch } = useQuery<ListingView[]>({
    queryKey: ["/api/listings"],
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-sm" aria-label="Rent table logo">
              <svg viewBox="0 0 32 32" className="size-6" fill="none" aria-hidden="true">
                <path d="M7 26V11.5L16 6l9 5.5V26" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M11 26v-9h10v9M7 13h18" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M13 21h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Apartment scrape sheet</p>
              <h1 className="text-xl font-semibold tracking-tight">StreetEasy Listing Table</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-listings"
            >
              <RefreshCw className={`mr-2 size-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <ImportPanel count={listings.length} onImported={() => setImportVersion((value) => value + 1)} />

        <ListingTable listings={listings} isLoading={isLoading} importVersion={importVersion} />
      </div>
    </main>
  );
}
