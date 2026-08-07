/**
 * ExportMenu.tsx
 *
 * A compact toolbar button that opens a dropdown with three export options:
 * PDF, Excel (.xlsx), and CSV. Plugs into any page that has tabular data.
 *
 * Usage:
 *   <ExportMenu
 *     data={banks}
 *     columns={exportColumns}
 *     title="Bank Master"
 *     filename="bank-master"
 *   />
 *
 * exportColumns is an ExportColumn[] — a plain array of { header, accessor }
 * objects that is separate from the TanStack ColumnDef[] used by DataTable.
 * This separation is intentional: PDF/Excel don't need renderers, sort fns, etc.
 */

import React, { useState } from "react";
import {
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  ChevronDown,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  exportToCsv,
  exportToXlsx,
  exportToPdf,
  type ExportColumn,
  type PdfStatCard,
} from "@/lib/export";
import { toast } from "sonner";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExportMenuProps {
  /** The full dataset to export (not just the current page). Ignored when
   *  `fetchData` is provided — ONLY used as the "N records" count shown in
   *  the dropdown before the user picks a format. */
  data: Record<string, unknown>[];
  /** For pages that paginate their fetch server-side: called right before
   *  exporting to pull the FULL matching dataset (all pages, same filters)
   *  instead of exporting whatever page happens to be on screen. When
   *  provided, this — not `data` — is what actually gets exported. */
  fetchData?: () => Promise<Record<string, unknown>[]>;
  /** Column definitions for export — header + accessor */
  columns: ExportColumn[];
  /** Document / sheet title */
  title: string;
  /** Base filename without extension */
  filename?: string;
  /** Optional subtitle shown in PDF header */
  subtitle?: string;
  /** Disable the button (e.g. while data is loading) */
  disabled?: boolean;
  /** Company name from enterprise master — shown in PDF header */
  companyName?: string;
  /** Base64 or URL logo from enterprise master — shown in PDF header */
  logoBase64?: string;
  /** Summary stat cards rendered below the PDF header band */
  stats?: PdfStatCard[];
  /** Optional per-column cellPadding override for the PDF export (by column index) */
  columnPadding?: Record<
    number,
    {
      cellPadding?: {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
    }
  >;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExportMenu({
  data,
  fetchData,
  columns,
  title,
  filename,
  subtitle,
  disabled = false,
  companyName,
  logoBase64,
  stats,
  columnPadding,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<"pdf" | "xlsx" | "csv" | null>(null);

  const base = filename ?? title.toLowerCase().replace(/\s+/g, "-");

  async function run(
    format: "pdf" | "xlsx" | "csv",
    fn: (rows: Record<string, unknown>[]) => Promise<void> | void,
  ) {
    setLoading(format);
    setOpen(false);
    try {
      // fetchData pulls every matching row (all pages, same filters) instead
      // of whatever page is currently on screen — see the prop doc above.
      const rows = fetchData ? await fetchData() : data;
      await fn(rows);
      toast.success(`${title} exported as ${format.toUpperCase()} (${rows.length} record${rows.length !== 1 ? "s" : ""})`);
    } catch (err) {
      console.error(err);
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setLoading(null);
    }
  }

  const options = [
    {
      key: "pdf" as const,
      label: "PDF Document",
      desc: "A4 landscape, paginated",
      icon: FileText,
      color: "text-rose-500",
      action: (rows: Record<string, unknown>[]) =>
        exportToPdf(rows, columns, {
          title,
          filename: base,
          subtitle,
          companyName,
          logoBase64,
          stats,
          columnPadding,
        }),
    },
    {
      key: "xlsx" as const,
      label: "Excel Workbook",
      desc: ".xlsx, auto-fitted columns",
      icon: FileSpreadsheet,
      color: "text-emerald-500",
      action: (rows: Record<string, unknown>[]) => exportToXlsx(rows, columns, base),
    },
    {
      key: "csv" as const,
      label: "CSV File",
      desc: "Plain text, universal",
      icon: FileDown,
      color: "text-sky-500",
      action: (rows: Record<string, unknown>[]) => exportToCsv(rows, columns, base),
    },
  ];

  const isBusy = loading !== null;

  return (
    <DropdownMenu.Root open={open} onOpenChange={(val) => { if (!disabled && !isBusy) setOpen(val) }}>
      {/* Trigger */}
      <DropdownMenu.Trigger asChild>
        <button
          disabled={disabled || isBusy}
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium
            transition-colors select-none outline-none
            ${
              disabled || isBusy
                ? "opacity-40 cursor-not-allowed border-border text-muted-foreground bg-muted"
                : "border-border text-foreground bg-card hover:bg-muted cursor-pointer"
            }
          `}
        >
          {isBusy ? (
            <Loader2 size={13} className="animate-spin text-muted-foreground" />
          ) : (
            <FileDown size={13} />
          )}
          Export
          <ChevronDown
            size={11}
            className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </DropdownMenu.Trigger>

      {/* Dropdown */}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="
            z-50 w-56 rounded-xl border border-border bg-card shadow-lg
            overflow-hidden
            animate-in fade-in slide-in-from-top-2 duration-150
          "
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
              {fetchData ? "Export all matching records" : `Export ${data.length} record${data.length !== 1 ? "s" : ""}`}
            </p>
          </div>

          <div className="py-1">
            {options.map((opt) => {
              const Icon = opt.icon;
              const busy = loading === opt.key;
              return (
                <DropdownMenu.Item asChild key={opt.key}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      run(opt.key, opt.action);
                    }}
                    disabled={isBusy}
                    className="
                      w-full flex items-center gap-3 px-3 py-2.5
                      text-left transition-colors outline-none
                      hover:bg-muted focus:bg-muted disabled:opacity-40 disabled:cursor-not-allowed
                    "
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-lg bg-muted ${opt.color}`}
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Icon size={14} />
                      )}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-xs font-medium text-foreground leading-tight">
                        {opt.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {opt.desc}
                      </span>
                    </span>
                  </button>
                </DropdownMenu.Item>
              );
            })}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default ExportMenu;
