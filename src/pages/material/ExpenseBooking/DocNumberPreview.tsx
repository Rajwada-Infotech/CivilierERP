import React, { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Hash, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DocType {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix: string;
  Description: string;
  EntryType: string;
}

interface Props {
  /** Optional filter — leave undefined to show ALL doc types */
  entryTypeFilter?: string;
  /** Financial year string e.g. "2024-25" — appended to the booking reference */
  finYear?: string;
  selectedDocTypeId: number | null;
  onSelect: (docTypeId: number | null, preview: string) => void;
  preview: string;
}

// Only show doc types that are invoice / receipt / payment related
const PAYMENT_KEYWORDS = ["invoice", "receipt", "received", "payment"];

function isPaymentRelated(dt: DocType): boolean {
  const haystack = [dt.EntryType, dt.Description, dt.Prefix]
    .join(" ")
    .toLowerCase();
  return PAYMENT_KEYWORDS.some((kw) => haystack.includes(kw));
}

async function fetchNextDocNumber(
  docTypeId: number,
  finYear?: string,
): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(
    `/api/document-type/${docTypeId}/next-number${qs}`,
  );
  if (!res.ok) return "";
  const data = await res.json();
  return data.nextDocNo ?? "";
}

async function fetchDocTypes(): Promise<DocType[]> {
  const res = await fetchWithAuth("/api/document-type");
  if (!res.ok) return [];
  return res.json();
}

export function DocNumberPreview({
  entryTypeFilter,
  finYear,
  selectedDocTypeId,
  onSelect,
  preview,
}: Props) {
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [docTypesLoading, setDocTypesLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setDocTypesLoading(true);
    fetchDocTypes()
      .then((all) => {
        // Filter to payment/invoice/receipt related types only — no fallback to all
        const paymentRelated = all.filter(isPaymentRelated);

        // Apply optional extra entryTypeFilter on top if provided
        const filtered = entryTypeFilter
          ? paymentRelated.filter(
              (d) =>
                d.EntryType?.toLowerCase().includes(
                  entryTypeFilter.toLowerCase(),
                ) ||
                d.Description?.toLowerCase().includes(
                  entryTypeFilter.toLowerCase(),
                ) ||
                d.Prefix?.toLowerCase().includes(entryTypeFilter.toLowerCase()),
            )
          : paymentRelated;

        setDocTypes(filtered);
      })
      .finally(() => setDocTypesLoading(false));
  }, [entryTypeFilter]);

  const handleSelect = async (value: string) => {
    if (!value) {
      onSelect(null, "");
      return;
    }
    const id = parseInt(value, 10);
    setGenerating(true);
    const next = await fetchNextDocNumber(id, finYear);
    onSelect(id, next);
    setGenerating(false);
  };

  const handleRefresh = async () => {
    if (!selectedDocTypeId) return;
    setRefreshing(true);
    const next = await fetchNextDocNumber(selectedDocTypeId, finYear);
    onSelect(selectedDocTypeId, next);
    setRefreshing(false);
  };

  const selectedType = docTypes.find(
    (d) => d.TypeOfDocId === selectedDocTypeId,
  );

  return (
    <div className="space-y-3">
      {/* ── Doc type dropdown ──────────────────────────────────────────── */}
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <Select
            value={selectedDocTypeId ? String(selectedDocTypeId) : ""}
            onValueChange={handleSelect}
            disabled={docTypesLoading}
          >
            <SelectTrigger>
              <div className="flex items-center gap-2 min-w-0">
                <Hash size={13} className="text-muted-foreground shrink-0" />
                <SelectValue
                  placeholder={
                    docTypesLoading
                      ? "Loading document types…"
                      : docTypes.length === 0
                        ? "No document types found"
                        : "Select document type…"
                  }
                />
              </div>
            </SelectTrigger>
            <SelectContent>
              {docTypes.map((dt) => (
                <SelectItem key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">
                      {dt.FullPrefix ?? dt.Prefix}
                    </span>
                    <span className="text-xs opacity-50">—</span>
                    <span className="text-xs opacity-80">{dt.Description}</span>
                    {dt.EntryType && (
                      <span className="text-[10px] opacity-50 ml-auto pl-3">
                        {dt.EntryType}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Refresh button — only when a type is selected */}
        {selectedDocTypeId && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Regenerate next number"
            className="h-9 w-9 flex items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors shrink-0"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {/* ── Preview chip — shown after selection ───────────────────────── */}
      {selectedType && (
        <div className="flex items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.04] px-3.5 py-2.5">
          <Hash size={13} className="text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-muted-foreground">
              prefix:{" "}
              <span className="font-mono">
                {selectedType.FullPrefix ?? selectedType.Prefix}
              </span>
              {finYear && (
                <span className="ml-2 text-primary/60">· FY {finYear}</span>
              )}
            </p>
            {generating ? (
              <p className="text-xs text-muted-foreground animate-pulse">
                Generating…
              </p>
            ) : (
              <p className="text-sm font-mono font-semibold text-primary tracking-wide">
                {preview || "—"}
              </p>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground/70 shrink-0">
            {selectedType.Description}
          </span>
        </div>
      )}
    </div>
  );
}
