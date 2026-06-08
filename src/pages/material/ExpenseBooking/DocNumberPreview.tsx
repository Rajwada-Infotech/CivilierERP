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

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * All module codes that can be passed as the `module` prop.
 * Keep in sync with MODULE_LINKS in backend/routes/document-type.js.
 */
export type DocModule =
  | "PO" // Purchase Order
  | "WO" // Work Order
  | "WO_PO" // Work Order for Materials
  | "GRN" // Goods Received Note
  | "BOQ" // Bill of Quantities
  | "EB" // Expense Booking
  | "MIS" // Material Issue
  | "PAY" // Payment (Outgoing)
  | "RECP" // Received Payment
  | "DN" // Debit Note
  | "WD" // Work Done
  | "MR" // Material Request
  | "ISS"; // Material Issue

/**
 * Shape returned by GET /api/document-type.
 * Includes the new columns added by migrations 035 + 046.
 */
export interface DocType {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix: string | null;
  DocNoPrefix: string | null;
  ModuleCode: string | null;
  ProjectCode: string | null;
  FinYearReset: boolean;
  Description: string;
  EntryType: string | null;
  links_to: string | null;
}

/**
 * Shape returned by GET /api/document-type/:id/next-number.
 */
export interface NextNumberResult {
  nextDocNo: string;
  prefix: string;
  nextSeq: number;
  finYear: string | null;
}

// ── Component props ───────────────────────────────────────────────────────────

interface Props {
  /** Module code — filters the dropdown to relevant doc types only. */
  module?: DocModule;
  /**
   * Financial year string, e.g. "26-27".
   * Required for Tier 1 (project-scoped) and Tier 3 (legacy) rows.
   * Pass the active fin year from FinYearContext wherever this is used.
   */
  finYear?: string;
  selectedDocTypeId: number | null;
  onSelect: (docTypeId: number | null, preview: string) => void;
  /** Current preview string, owned by the parent. Displayed below the select. */
  preview: string;
  /** Increment to force a preview refresh without changing the selected type. */
  refreshTrigger?: number;
  /**
   * When true (edit mode), suppresses the auto-fetch of a new doc number.
   * The parent's existing preview/docNo is displayed as-is.
   */
  readOnly?: boolean;
}

// ── Standalone fetch helpers (exported for direct use in pages) ───────────────

/**
 * Fetch the next doc number preview for a given TypeOfDocId.
 * Returns an empty string on error so callers can treat it as a loading state.
 */
export async function fetchNextDocNumber(
  docTypeId: number,
  finYear?: string,
): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(
    `/api/document-type/${docTypeId}/next-number${qs}`,
  );
  if (!res.ok) return "";
  const data: NextNumberResult = await res.json();
  return data.nextDocNo ?? "";
}

/**
 * Fetch the list of doc types filtered by module.
 * Returns an empty array on error.
 */
export async function fetchDocTypes(
  module?: DocModule | string,
): Promise<DocType[]> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  const res = await fetchWithAuth(`/api/document-type${qs}`);
  if (!res.ok) return [];
  return res.json();
}

// ── Label builder ─────────────────────────────────────────────────────────────

/**
 * Build the human-readable prefix label shown in the dropdown item.
 *
 * Priority order:
 *  1. Project-scoped new format: "GC-WO" (derived from ProjectCode + ModuleCode)
 *  2. DocNoPrefix (dash format):  "ExB-PO-GRN"
 *  3. FullPrefix (legacy slash):  "CI/WO/"
 *  4. Prefix (plain):             "WO"
 */
function docTypeLabel(dt: DocType): string {
  if (dt.ProjectCode && dt.ModuleCode) {
    return `${dt.ProjectCode}-${dt.ModuleCode}`;
  }
  return dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DocNumberPreview({
  module,
  finYear,
  selectedDocTypeId,
  onSelect,
  preview,
  refreshTrigger = 0,
  readOnly = false,
}: Props) {
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [docTypesLoading, setDocTypesLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load doc type list whenever the module filter changes.
  // Auto-select the first (and usually only) type when none is selected yet.
  useEffect(() => {
    setDocTypesLoading(true);
    fetchDocTypes(module)
      .then((types) => {
        // For the WO dropdown, exclude ExB-* (Expense Booking variants) and
        // WO-PO* (Work Order for Materials) — they share the same links_to tag
        // but belong to separate workflows with their own module codes.
        const filtered =
          module === "WO"
            ? types.filter((dt) => {
                const label = dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix;
                return (
                  !label.startsWith("ExB-") &&
                  !label.startsWith("WO-PO") &&
                  !label.startsWith("WO_PO")
                );
              })
            : module === "PO"
              ? types.filter((dt) => {
                  const label = dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix;
                  return !label.startsWith("ExB-PO");
                })
              : types;
        setDocTypes(filtered);
        if (!readOnly && !selectedDocTypeId && filtered.length > 0) {
          const first = filtered[0];
          fetchNextDocNumber(first.TypeOfDocId, finYear).then((next) => {
            onSelect(first.TypeOfDocId, next);
          });
        }
      })
      .finally(() => setDocTypesLoading(false));
  }, [module]);

  // In readOnly (edit) mode: if the saved docTypeId is not in the module-filtered list
  // (e.g. doc type was created before links_to tagging), fetch all types and inject it.
  useEffect(() => {
    if (!readOnly || !selectedDocTypeId || docTypesLoading) return;
    const found = docTypes.find((d) => d.TypeOfDocId === selectedDocTypeId);
    if (found) return; // already present — no action needed
    fetchDocTypes() // no module filter → all types
      .then((all) => {
        const match = all.find((d) => d.TypeOfDocId === selectedDocTypeId);
        if (match) {
          // For WO, never inject ExB-* or WO-PO* even via the fallback path
          // For PO, never inject ExB-PO* via the fallback path
          const label = match.DocNoPrefix ?? match.FullPrefix ?? match.Prefix;
          if (
            module === "WO" &&
            (label.startsWith("ExB-") ||
              label.startsWith("WO-PO") ||
              label.startsWith("WO_PO"))
          )
            return;
          if (module === "PO" && label.startsWith("ExB-PO")) return;
          setDocTypes((prev) => [match, ...prev]);
        }
      })
      .catch(() => {});
  }, [readOnly, selectedDocTypeId, docTypes, docTypesLoading]);

  // Refresh the preview whenever selectedDocTypeId, finYear, or refreshTrigger changes.
  // In readOnly (edit) mode we skip this — the parent already has the saved doc number.
  useEffect(() => {
    if (!selectedDocTypeId || readOnly) return;
    let active = true;
    setRefreshing(true);
    fetchNextDocNumber(selectedDocTypeId, finYear)
      .then((next) => {
        if (active) onSelect(selectedDocTypeId, next);
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDocTypeId, finYear, refreshTrigger, readOnly]);

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
  const isSpinning = refreshing || generating;

  return (
    <div className="space-y-1.5 min-w-0 w-full overflow-hidden">
      {/* ── Dropdown + refresh button ── */}
      <div className="flex gap-2 items-start min-w-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          <Select
            value={selectedDocTypeId ? String(selectedDocTypeId) : ""}
            onValueChange={handleSelect}
            disabled={docTypesLoading || readOnly}
          >
            <SelectTrigger className="w-full min-w-0 rounded-lg border border-border bg-background text-sm !ring-0 !shadow-none !outline-none focus:!ring-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 data-[state=open]:!ring-0 [&>span]:truncate">
              <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                <Hash size={13} className="text-muted-foreground shrink-0" />
                <SelectValue
                  className="truncate"
                  placeholder={
                    docTypesLoading
                      ? "Loading document types..."
                      : docTypes.length === 0
                        ? "No document types found"
                        : "Select document type..."
                  }
                />
              </div>
            </SelectTrigger>

            <SelectContent
              position="popper"
              sideOffset={4}
              className="z-[200] w-[var(--radix-select-trigger-width)] min-w-[220px]"
            >
              {docTypes.map((dt) => (
                <SelectItem key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
                  <div className="flex items-center gap-2 w-full min-w-0">
                    {/* Prefix badge — shows the effective doc number prefix */}
                    <span className="font-mono text-xs font-semibold text-primary shrink-0">
                      {docTypeLabel(dt)}
                    </span>
                    <span className="text-xs opacity-40 shrink-0">·</span>
                    <span className="text-xs opacity-80 truncate">
                      {dt.Description}
                    </span>
                    {dt.EntryType && (
                      <span className="text-[10px] opacity-40 ml-auto pl-3 shrink-0">
                        {dt.EntryType}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Refresh button — only shown when a type is selected */}
        {selectedDocTypeId && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isSpinning}
            title="Refresh next number"
            className="h-9 w-9 flex items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors shrink-0"
          >
            <RefreshCw size={13} className={isSpinning ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {/* ── Live preview pill ── */}
      {selectedType && (
        <div className="flex items-center gap-1.5 px-1 min-w-0 overflow-hidden">
          {isSpinning ? (
            <p className="text-xs text-muted-foreground animate-pulse truncate">
              {generating ? "Generating" : "Refreshing"} next number …
            </p>
          ) : preview ? (
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className="font-mono text-sm font-bold text-primary tracking-wider truncate min-w-0">
                {preview}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
