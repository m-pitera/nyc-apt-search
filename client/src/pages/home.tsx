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
  RotateCcw,
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

const sampleUrl = "https://streeteasy.com/building/436-east-75-street-new_york/2re?from_map=1";

const fieldLabels: Array<[keyof EditableListing, string, "text" | "textarea" | "boolean"]> = [
  ["link", "Link", "text"],
  ["neighborhood", "Neighborhood", "text"],
  ["rent", "Rent", "text"],
  ["beds", "# Beds", "text"],
  ["rooms", "# Rooms", "text"],
  ["roomsDesc", "Rooms Desc", "textarea"],
  ["bath", "# Bath", "text"],
  ["sqFt", "Sq Ft.", "text"],
  ["pplxDist", "PPLX Dist", "text"],
  ["sevenTwoDist", ".72 Dist", "text"],
  ["datePosted", "Date Posted", "text"],
  ["amenities", "Amenities", "textarea"],
  ["hasInUnitLaundry", "Has in-unit laundry", "boolean"],
  ["hasInBuildingLaundry", "Has in-building laundry", "boolean"],
];

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
  const headers = fieldLabels.map(([, label]) => label);
  const rows = listings.map((listing) => [
    listing.link,
    listing.neighborhood,
    listing.rent,
    listing.beds,
    listing.rooms,
    listing.roomsDesc,
    listing.bath,
    listing.sqFt,
    listing.pplxDist,
    listing.sevenTwoDist,
    listing.datePosted,
    listing.amenities.join("; "),
    listing.hasInUnitLaundry ? "TRUE" : "FALSE",
    listing.hasInBuildingLaundry ? "TRUE" : "FALSE",
  ]);

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

function ImportPanel({ count }: { count: number }) {
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
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      form.reset({ url: "", pageText: "" });
      toast({
        title: "Listing added",
        description: listing.parseStatus || "StreetEasy listing imported into the table.",
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
  value: string | boolean;
  type: "text" | "textarea" | "boolean";
  onChange: (value: string | boolean) => void;
  testId: string;
}) {
  if (type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Switch checked={Boolean(value)} onCheckedChange={onChange} data-testid={testId} />
        <span className="text-xs text-muted-foreground">{value ? "Yes" : "No"}</span>
      </div>
    );
  }

  if (type === "textarea") {
    return (
      <Textarea
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="min-w-64 resize-y text-sm"
        data-testid={testId}
      />
    );
  }

  return (
    <Input
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-32 text-sm"
      data-testid={testId}
    />
  );
}

function ListingTable({ listings, isLoading }: { listings: ListingView[]; isLoading: boolean }) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableListing | null>(null);

  const updateMutation = useMutation({
    mutationFn: async (values: EditableListing) => {
      const response = await apiRequest("PATCH", `/api/listings/${values.id}`, {
        ...values,
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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/listings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Row deleted", description: "The listing was removed from the table." });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/listings");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Table cleared", description: "All listing rows were removed." });
    },
  });

  const startEditing = (listing: ListingView) => {
    setEditingId(listing.id);
    setDraft(listingToEditable(listing));
  };

  const setDraftField = (key: keyof EditableListing, value: string | boolean) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <Card className="border-card-border shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Listing rows</CardTitle>
            <CardDescription>
              Fields are intentionally editable because StreetEasy and third-party scrapers can omit listing-specific values.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!listings.length}
              onClick={() => downloadCsv(listings)}
              data-testid="button-export"
            >
              <ArrowDownToLine className="mr-2 size-4" />
              Export CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!listings.length || clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
              data-testid="button-clear"
            >
              <RotateCcw className="mr-2 size-4" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
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
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table className="min-w-[1800px]">
              <TableHeader>
                <TableRow>
                  {fieldLabels.map(([, label]) => (
                    <TableHead key={label} className="whitespace-nowrap bg-muted/40 text-xs font-semibold uppercase tracking-wide">
                      {label}
                    </TableHead>
                  ))}
                  <TableHead className="min-w-40 bg-muted/40 text-xs font-semibold uppercase tracking-wide">
                    Status
                  </TableHead>
                  <TableHead className="min-w-28 bg-muted/40 text-xs font-semibold uppercase tracking-wide">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((listing) => {
                  const isEditing = editingId === listing.id && draft;
                  const row = isEditing ? draft : listingToEditable(listing);
                  return (
                    <TableRow key={listing.id} data-testid={`row-listing-${listing.id}`}>
                      {fieldLabels.map(([key, label, type]) => (
                        <TableCell key={key} className="align-top">
                          {isEditing ? (
                            <EditableCell
                              value={row[key] as string | boolean}
                              type={type}
                              testId={`input-${String(key)}-${listing.id}`}
                              onChange={(value) => setDraftField(key, value)}
                            />
                          ) : key === "link" ? (
                            <a
                              href={listing.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-48 items-center gap-1 truncate text-primary underline-offset-4 hover:underline"
                              data-testid={`link-listing-${listing.id}`}
                              title={listing.link}
                            >
                              StreetEasy <ExternalLink className="size-3" />
                            </a>
                          ) : type === "boolean" ? (
                            <Badge variant={row[key] ? "default" : "outline"} data-testid={`text-${String(key)}-${listing.id}`}>
                              {row[key] ? "Yes" : "No"}
                            </Badge>
                          ) : (
                            <span
                              className="block min-w-24 max-w-72 whitespace-pre-wrap text-sm"
                              data-testid={`text-${String(key)}-${listing.id}`}
                            >
                              {String(row[key] || "—")}
                            </span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="bg-card align-top">
                        <Badge variant={statusVariant(listing.parseStatus)} className="max-w-64 whitespace-normal text-left" data-testid={`status-${listing.id}`}>
                          {listing.parseStatus || "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="bg-card align-top">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="icon"
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
  const { data: listings = [], isLoading } = useQuery<ListingView[]>({
    queryKey: ["/api/listings"],
  });

  const stats = useMemo(() => {
    const inUnit = listings.filter((listing) => listing.hasInUnitLaundry).length;
    const inBuilding = listings.filter((listing) => listing.hasInBuildingLaundry).length;
    const unresolved = listings.filter((listing) => /unresolved|failed|manual/i.test(listing.parseStatus)).length;
    return { inUnit, inBuilding, unresolved };
  }, [listings]);

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
          <ThemeToggle />
        </header>

        <ImportPanel count={listings.length} />

        <section className="grid gap-3 md:grid-cols-3" aria-label="Import summary">
          <Card className="border-card-border">
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">In-unit laundry</p>
              <p className="mt-1 text-xl font-semibold tabular-nums" data-testid="text-stat-in-unit">{stats.inUnit}</p>
            </CardContent>
          </Card>
          <Card className="border-card-border">
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">In-building laundry</p>
              <p className="mt-1 text-xl font-semibold tabular-nums" data-testid="text-stat-in-building">{stats.inBuilding}</p>
            </CardContent>
          </Card>
          <Card className="border-card-border">
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Needs review</p>
              <p className="mt-1 text-xl font-semibold tabular-nums" data-testid="text-stat-unresolved">{stats.unresolved}</p>
            </CardContent>
          </Card>
        </section>

        <ListingTable listings={listings} isLoading={isLoading} />
      </div>
    </main>
  );
}
