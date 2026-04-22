import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Availability, ListingView, WorkflowStatus } from "@shared/schema";
import { AVAILABILITY_VALUES, WORKFLOW_STATUS_VALUES } from "@shared/schema";

const availabilityLabels: Record<Availability, string> = {
  active: "Active",
  inactive: "Inactive",
  stale: "Stale",
};

const workflowStatusLabels: Record<WorkflowStatus, string> = {
  new: "New",
  contacted: "Contacted",
  scheduled: "Scheduled",
  applied: "Applied",
  signed: "Signed",
  rejected: "Rejected",
};

function normalizeAvailability(value: string | null | undefined): Availability {
  return (AVAILABILITY_VALUES as readonly string[]).includes(value || "")
    ? (value as Availability)
    : "active";
}

function normalizeWorkflowStatus(value: string | null | undefined): WorkflowStatus {
  return (WORKFLOW_STATUS_VALUES as readonly string[]).includes(value || "")
    ? (value as WorkflowStatus)
    : "new";
}

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
type RatingPatch = {
  bbLizardRating: number;
  bbLizardLocationRating: number;
  bbLizardLayoutRating: number;
  bbLizardOverallRating: number;
  bbCrabRating: number;
  bbCrabLocationRating: number;
  bbCrabLayoutRating: number;
  bbCrabOverallRating: number;
  bbLizardComment?: string;
  bbCrabComment?: string;
};

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

const sortOptions: Array<{ key: SortKey; direction: SortDirection; label: string }> = [
  { key: "averageRating", direction: "desc", label: "Avg rating ↓" },
  { key: "averageRating", direction: "asc", label: "Avg rating ↑" },
  { key: "rent", direction: "asc", label: "Rent ↑" },
  { key: "rent", direction: "desc", label: "Rent ↓" },
  { key: "pplxDist", direction: "asc", label: "PPLX commute ↑" },
  { key: "sevenTwoDist", direction: "asc", label: "P72 commute ↑" },
  { key: "hasInUnitLaundry", direction: "desc", label: "In-unit laundry first" },
  { key: "hasInBuildingLaundry", direction: "desc", label: "Building laundry first" },
  { key: "datePosted", direction: "desc", label: "Date posted ↓" },
  { key: "yearBuilt", direction: "desc", label: "Year built ↓" },
  { key: "neighborhood", direction: "asc", label: "Neighborhood A-Z" },
];

function formatAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function averageFromNumbers(values: number[]): number {
  const ratings = values.map((value) => Number(value) || 0).filter((value) => value > 0);
  if (!ratings.length) return 0;
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return average;
}

function personAverageRating(
  listing: Pick<
    ListingView,
    | "bbLizardRating"
    | "bbLizardLocationRating"
    | "bbLizardLayoutRating"
    | "bbLizardOverallRating"
    | "bbCrabRating"
    | "bbCrabLocationRating"
    | "bbCrabLayoutRating"
    | "bbCrabOverallRating"
  >,
  person: "lizard" | "crab",
): number {
  const categoryAverage =
    person === "lizard"
      ? averageFromNumbers([
          listing.bbLizardLocationRating,
          listing.bbLizardLayoutRating,
          listing.bbLizardOverallRating,
        ])
      : averageFromNumbers([
          listing.bbCrabLocationRating,
          listing.bbCrabLayoutRating,
          listing.bbCrabOverallRating,
        ]);
  if (categoryAverage) return categoryAverage;
  return Number(person === "lizard" ? listing.bbLizardRating : listing.bbCrabRating) || 0;
}

function averageRating(
  listing: Pick<
    ListingView,
    | "bbLizardRating"
    | "bbLizardLocationRating"
    | "bbLizardLayoutRating"
    | "bbLizardOverallRating"
    | "bbCrabRating"
    | "bbCrabLocationRating"
    | "bbCrabLayoutRating"
    | "bbCrabOverallRating"
  >,
): string {
  const average = averageFromNumbers([personAverageRating(listing, "lizard"), personAverageRating(listing, "crab")]);
  return average ? formatAverage(average) : "";
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
  const ratingHeaders = [
    "bb-lizard location rating",
    "bb-lizard layout rating",
    "bb-lizard overall rating",
    "bb-lizard average rating",
    "bb-lizard comment",
    "bb-crab location rating",
    "bb-crab layout rating",
    "bb-crab overall rating",
    "bb-crab average rating",
    "bb-crab comment",
    "Average rating",
  ];
  const headers = [...fieldLabels.map(([, label]) => label), ...ratingHeaders];
  const rows = listings.map((listing) =>
    [
      ...fieldLabels.map(([key, , type]) => {
      if (key === "amenities") return listing.amenities.join("; ");
      if (type === "boolean") return listing[key] ? "TRUE" : "FALSE";
      return String(listing[key] ?? "");
      }),
      Number(listing.bbLizardLocationRating) ? String(listing.bbLizardLocationRating) : "",
      Number(listing.bbLizardLayoutRating) ? String(listing.bbLizardLayoutRating) : "",
      Number(listing.bbLizardOverallRating) ? String(listing.bbLizardOverallRating) : "",
      personAverageRating(listing, "lizard") ? formatAverage(personAverageRating(listing, "lizard")) : "",
      listing.bbLizardComment || "",
      Number(listing.bbCrabLocationRating) ? String(listing.bbCrabLocationRating) : "",
      Number(listing.bbCrabLayoutRating) ? String(listing.bbCrabLayoutRating) : "",
      Number(listing.bbCrabOverallRating) ? String(listing.bbCrabOverallRating) : "",
      personAverageRating(listing, "crab") ? formatAverage(personAverageRating(listing, "crab")) : "",
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
      return (await response.json()) as ListingView & { duplicate?: boolean };
    },
    onSuccess: (result) => {
      const { duplicate, listing: _nested, ...listing } = result as ListingView & {
        duplicate?: boolean;
        listing?: ListingView;
      };
      void _nested;
      queryClient.setQueryData<ListingView[]>(["/api/listings"], (current = []) => [
        listing as ListingView,
        ...current.filter((row) => row.id !== listing.id),
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      onImported();
      form.reset({ url: "", pageText: "" });
      toast({
        title: duplicate ? "Listing already imported" : "Listing added",
        description: duplicate
          ? "Showing the existing row — no new scrape was performed."
          : "Added to the table and cleared filters so the new row is visible.",
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
    <div className="grid items-center gap-2 sm:grid-cols-[80px_auto]">
      <p className="text-xs font-medium leading-tight text-foreground">{label}</p>
      <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={label} data-testid={testId}>
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

function PersonRatingEditor({
  label,
  person,
  values,
  comment,
  onValuesChange,
  onCommentChange,
  commentTestId,
  placeholder,
}: {
  label: string;
  person: "lizard" | "crab";
  values: {
    location: number;
    layout: number;
    overall: number;
  };
  comment: string;
  onValuesChange: (values: { location: number; layout: number; overall: number }) => void;
  onCommentChange: (value: string) => void;
  commentTestId: string;
  placeholder: string;
}) {
  const personAverage = averageFromNumbers([values.location, values.layout, values.overall]);
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3" data-testid={`panel-rating-${person}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">
          Avg <span className="font-semibold tabular-nums text-foreground">{personAverage ? formatAverage(personAverage) : "—"}</span>
        </p>
      </div>
      <div className="grid gap-2">
        <RatingPicker
          label="Location"
          value={values.location}
          onChange={(location) => onValuesChange({ ...values, location })}
          testId={`rating-${person}-location`}
        />
        <RatingPicker
          label="Layout"
          value={values.layout}
          onChange={(layout) => onValuesChange({ ...values, layout })}
          testId={`rating-${person}-layout`}
        />
        <RatingPicker
          label="Overall"
          value={values.overall}
          onChange={(overall) => onValuesChange({ ...values, overall })}
          testId={`rating-${person}-overall`}
        />
      </div>
      <Textarea
        value={comment}
        onChange={(event) => onCommentChange(event.target.value)}
        rows={2}
        className="mt-3 min-h-16 resize-y text-sm"
        placeholder={placeholder}
        data-testid={commentTestId}
      />
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
  onChange: (id: number, values: RatingPatch) => Promise<unknown> | unknown;
}) {
  const average = averageRating(listing);
  const lizardAverage = personAverageRating(listing, "lizard");
  const crabAverage = personAverageRating(listing, "crab");
  const [lizardRatings, setLizardRatings] = useState({
    location: Number(listing.bbLizardLocationRating) || 0,
    layout: Number(listing.bbLizardLayoutRating) || 0,
    overall: Number(listing.bbLizardOverallRating) || Number(listing.bbLizardRating) || 0,
  });
  const [crabRatings, setCrabRatings] = useState({
    location: Number(listing.bbCrabLocationRating) || 0,
    layout: Number(listing.bbCrabLayoutRating) || 0,
    overall: Number(listing.bbCrabOverallRating) || Number(listing.bbCrabRating) || 0,
  });
  const [lizardComment, setLizardComment] = useState(listing.bbLizardComment || "");
  const [crabComment, setCrabComment] = useState(listing.bbCrabComment || "");
  const [isSavingRatings, setIsSavingRatings] = useState(false);
  const [ratingsSaved, setRatingsSaved] = useState(false);
  const isSaving = disabled || isSavingRatings;

  useEffect(() => {
    setLizardRatings({
      location: Number(listing.bbLizardLocationRating) || 0,
      layout: Number(listing.bbLizardLayoutRating) || 0,
      overall: Number(listing.bbLizardOverallRating) || Number(listing.bbLizardRating) || 0,
    });
    setCrabRatings({
      location: Number(listing.bbCrabLocationRating) || 0,
      layout: Number(listing.bbCrabLayoutRating) || 0,
      overall: Number(listing.bbCrabOverallRating) || Number(listing.bbCrabRating) || 0,
    });
    setLizardComment(listing.bbLizardComment || "");
    setCrabComment(listing.bbCrabComment || "");
    setRatingsSaved(false);
  }, [
    listing.bbCrabComment,
    listing.bbCrabLayoutRating,
    listing.bbCrabLocationRating,
    listing.bbCrabOverallRating,
    listing.bbCrabRating,
    listing.bbLizardComment,
    listing.bbLizardLayoutRating,
    listing.bbLizardLocationRating,
    listing.bbLizardOverallRating,
    listing.bbLizardRating,
  ]);

  const saveRatings = async () => {
    setIsSavingRatings(true);
    setRatingsSaved(false);
    try {
      await onChange(listing.id, {
        bbLizardRating: lizardRatings.overall,
        bbLizardLocationRating: lizardRatings.location,
        bbLizardLayoutRating: lizardRatings.layout,
        bbLizardOverallRating: lizardRatings.overall,
        bbCrabRating: crabRatings.overall,
        bbCrabLocationRating: crabRatings.location,
        bbCrabLayoutRating: crabRatings.layout,
        bbCrabOverallRating: crabRatings.overall,
        bbLizardComment: lizardComment,
        bbCrabComment: crabComment,
      });
      setRatingsSaved(true);
    } finally {
      setIsSavingRatings(false);
    }
  };

  return (
    <div className={disabled ? "opacity-60" : ""} data-testid={`cell-rating-${listing.id}`}>
      <div className="rounded-md border border-border bg-primary/5 px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Avg</p>
          <p className="text-base font-semibold tabular-nums" data-testid={`text-average-rating-${listing.id}`}>
            {average || "—"}
          </p>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
          <span>Lizard {lizardAverage ? formatAverage(lizardAverage) : "—"}</span>
          <span>Crab {crabAverage ? formatAverage(crabAverage) : "—"}</span>
        </div>
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" data-testid={`button-rate-${listing.id}`}>
            Rate
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rate apartment</DialogTitle>
            <DialogDescription>
              {listing.buildingTitle || listing.neighborhood || "Listing"}
              {listing.rent ? ` · ${listing.rent}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-primary/5 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Combined average</p>
              <p className="text-lg font-semibold tabular-nums">{average || "—"}</p>
            </div>
            <PersonRatingEditor
              label="bb-lizard"
              person="lizard"
              values={lizardRatings}
              onValuesChange={setLizardRatings}
              comment={lizardComment}
              onCommentChange={setLizardComment}
              commentTestId={`textarea-lizard-comment-${listing.id}`}
              placeholder="bb-lizard notes..."
            />
            <PersonRatingEditor
              label="bb-crab"
              person="crab"
              values={crabRatings}
              onValuesChange={setCrabRatings}
              comment={crabComment}
              onCommentChange={setCrabComment}
              commentTestId={`textarea-crab-comment-${listing.id}`}
              placeholder="bb-crab notes..."
            />
            <Button
              type="button"
              className="w-full"
              disabled={isSaving}
              onClick={saveRatings}
              data-testid={`button-save-ratings-${listing.id}`}
            >
              {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {isSaving ? "Saving ratings..." : "Save ratings"}
            </Button>
            {ratingsSaved ? (
              <p className="flex items-center justify-center gap-1 text-sm font-medium text-primary" data-testid={`text-ratings-saved-${listing.id}`}>
                <Check className="size-4" />
                Ratings saved
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-sm" data-testid={testId}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value || "—"}</p>
      {detail ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function ExpandableComment({
  comment,
  testId,
}: {
  comment: string;
  testId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const trimmed = comment?.trim() || "";
  const shouldCollapse = trimmed.length > 140;

  if (!trimmed) {
    return <p className="mt-3 text-xs leading-5 text-muted-foreground">No comment yet.</p>;
  }

  return (
    <div className="mt-3 text-xs leading-5 text-muted-foreground" data-testid={testId}>
      <p className={`whitespace-pre-wrap ${isExpanded || !shouldCollapse ? "" : "line-clamp-2"}`}>
        “{trimmed}”
      </p>
      {shouldCollapse ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-auto px-0 py-0 text-xs font-semibold text-primary hover:bg-transparent hover:text-primary"
          onClick={() => setIsExpanded((value) => !value)}
          data-testid={`${testId}-toggle`}
        >
          {isExpanded ? "Less" : "More"}
        </Button>
      ) : null}
    </div>
  );
}

function RatingBreakdown({
  label,
  average,
  location,
  layout,
  overall,
  comment,
  testId,
}: {
  label: string;
  average: number;
  location: number;
  layout: number;
  overall: number;
  comment: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <Badge variant={average ? "default" : "outline"} className="tabular-nums">
          {average ? formatAverage(average) : "—"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md bg-background px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Location</p>
          <p className="font-semibold tabular-nums">{location || "—"}</p>
        </div>
        <div className="rounded-md bg-background px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Layout</p>
          <p className="font-semibold tabular-nums">{layout || "—"}</p>
        </div>
        <div className="rounded-md bg-background px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Overall</p>
          <p className="font-semibold tabular-nums">{overall || "—"}</p>
        </div>
      </div>
      <ExpandableComment comment={comment} testId={`${testId}-comment`} />
    </div>
  );
}

function ListingEditDialog({
  listing,
  open,
  draft,
  isSaving,
  onOpenChange,
  onDraftChange,
  onSave,
}: {
  listing: ListingView;
  open: boolean;
  draft: EditableListing | null;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (key: keyof EditableListing, value: string | number | boolean) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit apartment details</DialogTitle>
          <DialogDescription>
            {listing.buildingTitle || listing.neighborhood || "Listing"}
            {listing.rent ? ` · ${listing.rent}` : ""}
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {fieldLabels.map(([key, label, type]) => (
                <div key={key} className={type === "textarea" ? "md:col-span-2" : ""}>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </label>
                  <EditableCell
                    value={draft[key as keyof EditableListing] as string | number | boolean}
                    type={type}
                    testId={`input-${String(key)}-${listing.id}`}
                    onChange={(value) => onDraftChange(key as keyof EditableListing, value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid={`button-cancel-${listing.id}`}>
                Cancel
              </Button>
              <Button type="button" disabled={isSaving} onClick={onSave} data-testid={`button-save-${listing.id}`}>
                {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
                Save details
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ListingCard({
  listing,
  isEditing,
  draft,
  ratingDisabled,
  editSaving,
  deletePending,
  statusDisabled,
  onRateChange,
  onStartEditing,
  onEditOpenChange,
  onDraftChange,
  onSaveEdit,
  onDelete,
  onAvailabilityChange,
  onWorkflowStatusChange,
}: {
  listing: ListingView;
  isEditing: boolean;
  draft: EditableListing | null;
  ratingDisabled: boolean;
  editSaving: boolean;
  deletePending: boolean;
  statusDisabled: boolean;
  onRateChange: (id: number, values: RatingPatch) => Promise<unknown> | unknown;
  onStartEditing: (listing: ListingView) => void;
  onEditOpenChange: (open: boolean) => void;
  onDraftChange: (key: keyof EditableListing, value: string | number | boolean) => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onAvailabilityChange: (id: number, value: Availability) => void;
  onWorkflowStatusChange: (id: number, value: WorkflowStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const average = averageRating(listing);
  const lizardAverage = personAverageRating(listing, "lizard");
  const crabAverage = personAverageRating(listing, "crab");
  const availability = normalizeAvailability(listing.availability);
  const workflowStatus = normalizeWorkflowStatus(listing.workflowStatus);
  const availabilityVariant: "default" | "secondary" | "outline" =
    availability === "active" ? "default" : availability === "stale" ? "secondary" : "outline";
  const laundrySummary =
    listing.hasInUnitLaundry && listing.hasInBuildingLaundry
      ? "Unit + building"
      : listing.hasInUnitLaundry
        ? "In-unit"
        : listing.hasInBuildingLaundry
          ? "Building"
          : "Not listed";
  const amenities = listing.amenities.slice(0, 6);

  return (
    <Card className="overflow-hidden border-card-border shadow-sm" data-testid={`row-listing-${listing.id}`}>
      <CardContent className="p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_160px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-lg font-semibold tabular-nums text-primary" data-testid={`text-card-rent-${listing.id}`}>
                    {listing.rent || "Rent —"}
                  </p>
                  <h3 className="truncate text-lg font-semibold tracking-tight" data-testid={`text-card-title-${listing.id}`}>
                    {listing.buildingTitle || "Untitled listing"}
                  </h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[listing.neighborhood, listing.borough].filter(Boolean).join(" · ") || "Neighborhood unknown"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={availabilityVariant}
                  className="text-[11px] uppercase tracking-wide"
                  data-testid={`badge-availability-${listing.id}`}
                >
                  {availabilityLabels[availability]}
                </Badge>
                <Badge
                  variant="secondary"
                  className="text-[11px] uppercase tracking-wide"
                  data-testid={`badge-workflow-${listing.id}`}
                >
                  {workflowStatusLabels[workflowStatus]}
                </Badge>
                <Badge variant={average ? "default" : "outline"} className="text-sm tabular-nums" data-testid={`text-card-average-${listing.id}`}>
                  Avg {average || "—"}
                </Badge>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="PPLX" value={listing.pplxDist || "—"} detail="853 Broadway" testId={`metric-pplx-${listing.id}`} />
              <MetricTile label="P72" value={listing.sevenTwoDist || "—"} detail="55 Hudson Yards" testId={`metric-p72-${listing.id}`} />
              <MetricTile label="Laundry" value={laundrySummary} detail={listing.hasInBuildingLaundry ? "Building ✓" : listing.hasInUnitLaundry ? "Unit ✓" : ""} testId={`metric-laundry-${listing.id}`} />
              <MetricTile label="Posted" value={listing.datePosted || "—"} detail={listing.openRentalsCount ? `${listing.openRentalsCount} open rentals` : ""} testId={`metric-posted-${listing.id}`} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">Lizard {lizardAverage ? formatAverage(lizardAverage) : "—"}</Badge>
              <Badge variant="secondary">Crab {crabAverage ? formatAverage(crabAverage) : "—"}</Badge>
              {listing.rooms ? <Badge variant="outline">{listing.rooms} rooms</Badge> : null}
              {listing.beds ? <Badge variant="outline">{listing.beds} beds</Badge> : null}
              {listing.bath ? <Badge variant="outline">{listing.bath} bath</Badge> : null}
              {listing.sqFt ? <Badge variant="outline">{listing.sqFt} sq ft</Badge> : null}
              {listing.yearBuilt ? <Badge variant="outline">Built {listing.yearBuilt}</Badge> : null}
            </div>

            {amenities.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`text-card-amenities-${listing.id}`}>
                {amenities.map((amenity) => (
                  <Badge key={amenity} variant="outline" className="bg-background text-[11px]">
                    {amenity}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <RatingCell listing={listing} disabled={ratingDisabled} onChange={onRateChange} />
            <Select
              value={availability}
              onValueChange={(value) => onAvailabilityChange(listing.id, value as Availability)}
              disabled={statusDisabled}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-availability-${listing.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABILITY_VALUES.map((value) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {availabilityLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={workflowStatus}
              onValueChange={(value) => onWorkflowStatusChange(listing.id, value as WorkflowStatus)}
              disabled={statusDisabled}
            >
              <SelectTrigger className="h-8 text-xs" data-testid={`select-workflow-${listing.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_STATUS_VALUES.map((value) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {workflowStatusLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((value) => !value)} data-testid={`button-toggle-card-${listing.id}`}>
              {expanded ? "Less" : "More"}
            </Button>
          </div>
        </div>

        {expanded ? (
          <div className="mt-4 border-t border-border pt-4" data-testid={`panel-card-details-${listing.id}`}>
            <div className="grid gap-3 lg:grid-cols-2">
              <RatingBreakdown
                label="bb-lizard"
                average={lizardAverage}
                location={Number(listing.bbLizardLocationRating) || 0}
                layout={Number(listing.bbLizardLayoutRating) || 0}
                overall={Number(listing.bbLizardOverallRating) || Number(listing.bbLizardRating) || 0}
                comment={listing.bbLizardComment || ""}
                testId={`breakdown-lizard-${listing.id}`}
              />
              <RatingBreakdown
                label="bb-crab"
                average={crabAverage}
                location={Number(listing.bbCrabLocationRating) || 0}
                layout={Number(listing.bbCrabLayoutRating) || 0}
                overall={Number(listing.bbCrabOverallRating) || Number(listing.bbCrabRating) || 0}
                comment={listing.bbCrabComment || ""}
                testId={`breakdown-crab-${listing.id}`}
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Apartment</p>
                  <p className="mt-1 text-sm leading-6">
                    {[listing.rooms ? `${listing.rooms} rooms` : "", listing.beds ? `${listing.beds} beds` : "", listing.bath ? `${listing.bath} bath` : "", listing.sqFt ? `${listing.sqFt} sq ft` : "", listing.yearBuilt ? `Built ${listing.yearBuilt}` : ""]
                      .filter(Boolean)
                      .join(" · ") || "No apartment facts listed."}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                  <DescriptionCell listing={listing} />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</p>
                  <p className="mt-1 text-sm font-medium">{listing.contactName || "—"}</p>
                  <p className="text-xs text-muted-foreground">{listing.contactEmail || "No email"}</p>
                  <p className="text-xs text-muted-foreground">{listing.contactPhone || "No phone"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={listing.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-primary hover:bg-accent"
                    data-testid={`link-listing-${listing.id}`}
                  >
                    StreetEasy <ExternalLink className="ml-1 size-3" />
                  </a>
                  <Button type="button" variant="outline" size="sm" onClick={() => onStartEditing(listing)} data-testid={`button-edit-${listing.id}`}>
                    <Pencil className="mr-2 size-4" />
                    Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={deletePending} onClick={onDelete} data-testid={`button-delete-${listing.id}`}>
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <ListingEditDialog
          listing={listing}
          open={isEditing}
          draft={draft}
          isSaving={editSaving}
          onOpenChange={onEditOpenChange}
          onDraftChange={onDraftChange}
          onSave={onSaveEdit}
        />
      </CardContent>
    </Card>
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

  const sortValue = `${sort.key}:${sort.direction}`;
  const updateSort = (value: string) => {
    const [key, direction] = value.split(":") as [SortKey, SortDirection];
    setSort({ key, direction });
  };

  const updateMutation = useMutation({
    mutationFn: async (values: EditableListing) => {
      const response = await apiRequest("PATCH", `/api/listings/${values.id}`, {
        ...values,
        bbLizardRating: Number(values.bbLizardRating) || 0,
        bbLizardLocationRating: Number(values.bbLizardLocationRating) || 0,
        bbLizardLayoutRating: Number(values.bbLizardLayoutRating) || 0,
        bbLizardOverallRating: Number(values.bbLizardOverallRating) || 0,
        bbCrabRating: Number(values.bbCrabRating) || 0,
        bbCrabLocationRating: Number(values.bbCrabLocationRating) || 0,
        bbCrabLayoutRating: Number(values.bbCrabLayoutRating) || 0,
        bbCrabOverallRating: Number(values.bbCrabOverallRating) || 0,
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
      bbLizardLocationRating,
      bbLizardLayoutRating,
      bbLizardOverallRating,
      bbCrabRating,
      bbCrabLocationRating,
      bbCrabLayoutRating,
      bbCrabOverallRating,
      bbLizardComment,
      bbCrabComment,
    }: {
      id: number;
      bbLizardRating: number;
      bbLizardLocationRating: number;
      bbLizardLayoutRating: number;
      bbLizardOverallRating: number;
      bbCrabRating: number;
      bbCrabLocationRating: number;
      bbCrabLayoutRating: number;
      bbCrabOverallRating: number;
      bbLizardComment?: string;
      bbCrabComment?: string;
    }) => {
      const response = await apiRequest("PATCH", `/api/listings/${id}`, {
        bbLizardRating,
        bbLizardLocationRating,
        bbLizardLayoutRating,
        bbLizardOverallRating,
        bbCrabRating,
        bbCrabLocationRating,
        bbCrabLayoutRating,
        bbCrabOverallRating,
        ...(bbLizardComment !== undefined ? { bbLizardComment } : {}),
        ...(bbCrabComment !== undefined ? { bbCrabComment } : {}),
      });
      return (await response.json()) as ListingView;
    },
    onMutate: async ({
      id,
      bbLizardRating,
      bbLizardLocationRating,
      bbLizardLayoutRating,
      bbLizardOverallRating,
      bbCrabRating,
      bbCrabLocationRating,
      bbCrabLayoutRating,
      bbCrabOverallRating,
      bbLizardComment,
      bbCrabComment,
    }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/listings"] });
      const previous = queryClient.getQueryData<ListingView[]>(["/api/listings"]);
      queryClient.setQueryData<ListingView[]>(["/api/listings"], (current = []) =>
        current.map((listing) =>
          listing.id === id
            ? {
                ...listing,
                bbLizardRating,
                bbLizardLocationRating,
                bbLizardLayoutRating,
                bbLizardOverallRating,
                bbCrabRating,
                bbCrabLocationRating,
                bbCrabLayoutRating,
                bbCrabOverallRating,
                ...(bbLizardComment !== undefined ? { bbLizardComment } : {}),
                ...(bbCrabComment !== undefined ? { bbCrabComment } : {}),
              }
            : listing,
        ),
      );
      return { previous };
    },
    onSuccess: () => {
      toast({ title: "Ratings saved", description: "Category ratings and comments are updated." });
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

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      availability,
      workflowStatus,
    }: {
      id: number;
      availability?: Availability;
      workflowStatus?: WorkflowStatus;
    }) => {
      const payload: Record<string, string> = {};
      if (availability !== undefined) payload.availability = availability;
      if (workflowStatus !== undefined) payload.workflowStatus = workflowStatus;
      const response = await apiRequest("PATCH", `/api/listings/${id}`, payload);
      return (await response.json()) as ListingView;
    },
    onMutate: async ({ id, availability, workflowStatus }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/listings"] });
      const previous = queryClient.getQueryData<ListingView[]>(["/api/listings"]);
      queryClient.setQueryData<ListingView[]>(["/api/listings"], (current = []) =>
        current.map((listing) =>
          listing.id === id
            ? {
                ...listing,
                ...(availability !== undefined ? { availability } : {}),
                ...(workflowStatus !== undefined ? { workflowStatus } : {}),
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
      toast({ title: "Status not saved", description: "Try again.", variant: "destructive" });
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
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 lg:grid-cols-[1.4fr_repeat(3,0.8fr)_repeat(2,1fr)_0.9fr_auto]">
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
          <Select value={sortValue} onValueChange={updateSort}>
            <SelectTrigger className="text-sm" data-testid="select-sort">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={`${option.key}:${option.direction}`} value={`${option.key}:${option.direction}`}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <div className="grid gap-3" data-testid="list-card-view">
            {visibleListings.map((listing) => {
              const isEditing = editingId === listing.id && Boolean(draft);
              return (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isEditing={isEditing}
                  draft={isEditing ? draft : null}
                  ratingDisabled={ratingMutation.isPending}
                  editSaving={updateMutation.isPending}
                  deletePending={deleteMutation.isPending}
                  statusDisabled={statusMutation.isPending}
                  onRateChange={(id, values) => ratingMutation.mutateAsync({ id, ...values })}
                  onStartEditing={startEditing}
                  onEditOpenChange={(open) => {
                    if (!open) {
                      setEditingId(null);
                      setDraft(null);
                    } else {
                      startEditing(listing);
                    }
                  }}
                  onDraftChange={setDraftField}
                  onSaveEdit={() => draft && updateMutation.mutate(draft)}
                  onDelete={() => deleteMutation.mutate(listing.id)}
                  onAvailabilityChange={(id, availability) => statusMutation.mutate({ id, availability })}
                  onWorkflowStatusChange={(id, workflowStatus) => statusMutation.mutate({ id, workflowStatus })}
                />
              );
            })}
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
