import React, { useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordsShell } from "@/components/records/RecordsShell";
import {
  FinanceGlassCard,
  GlassSection,
} from "@/components/finance/FinanceShell";
import { useRecords, type UnifiedRecord } from "@/hooks/useRecords";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Download,
  Eye,
  RefreshCw,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  Archive,
  Ticket,
  Truck,
  FolderLock,
  Search,
  X,
  Loader2,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileIcon(type?: string) {
  if (!type) return <File size={14} className="text-muted-foreground" />;
  if (type.startsWith("image/"))
    return <FileImage size={14} className="text-blue-400" />;
  if (type.includes("pdf"))
    return <FileText size={14} className="text-red-400" />;
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv"))
    return <FileSpreadsheet size={14} className="text-green-500" />;
  return <FileText size={14} className="text-muted-foreground" />;
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const MODULE_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  ticket: { label: "Ticket", icon: Ticket, color: "#ec4899" },
  vehicle: { label: "Vehicle In/Out", icon: Truck, color: "#10b981" },
  vault: { label: "Document Vault", icon: FolderLock, color: "#818cf8" },
};

function ModuleBadge({ source, module }: { source: string; module: string }) {
  const meta = MODULE_META[source] ?? {
    label: module,
    icon: File,
    color: "#94a3b8",
  };
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-heading whitespace-nowrap"
      style={{ background: `${meta.color}18`, color: meta.color }}
    >
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

function ActionButtons({ record }: { record: UnifiedRecord }) {
  const [loading, setLoading] = useState<"preview" | "download" | null>(null);

  const handleAction = async (action: "preview" | "download") => {
    setLoading(action);
    try {
      const res = await fetchWithAuth(record.url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(objUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000); // cleanup after a minute
      } else {
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = record.filename;
        a.click();
        URL.revokeObjectURL(objUrl);
      }
    } catch (e: any) {
      toast.error(`Failed to ${action} file: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleAction("preview")}
        disabled={loading !== null}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        title={`Preview ${record.filename}`}
      >
        {loading === "preview" ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
      </button>
      <button
        onClick={() => handleAction("download")}
        disabled={loading !== null}
        className="p-1.5 rounded-md hover:bg-amber-500/10 transition-colors disabled:opacity-50"
        style={{ color: "#f59e0b" }}
        title={`Download ${record.filename}`}
      >
        {loading === "download" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      </button>
    </div>
  );
}

// ─── Columns ─────────────────────────────────────────────────────────────────

function buildColumns(): ColumnDef<UnifiedRecord, unknown>[] {
  return [
    {
      accessorKey: "module",
      header: "Module",
      cell: ({ row }) => (
        <ModuleBadge
          source={row.original.source}
          module={row.original.module}
        />
      ),
    },
    {
      accessorKey: "docRef",
      header: "Doc Ref.",
      cell: ({ getValue }) => (
        <span className="text-primary font-heading text-xs whitespace-nowrap">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "docLabel",
      header: "Reference",
      cell: ({ getValue }) => (
        <span
          className="font-medium whitespace-nowrap max-w-[180px] truncate block"
          title={getValue() as string}
        >
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "filename",
      header: "File",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 min-w-0">
          {fileIcon(row.original.mimeType)}
          <span
            className="text-xs text-foreground truncate max-w-[160px]"
            title={row.original.filename}
          >
            {row.original.filename}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "size",
      header: "Size",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap text-xs">
          {formatFileSize(getValue() as number)}
        </span>
      ),
    },
    {
      accessorKey: "uploadedBy",
      header: "Uploaded By",
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap text-xs">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "uploadedAt",
      header: "Uploaded",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {v ? format(new Date(v), "dd/MM/yyyy HH:mm") : "—"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => <ActionButtons record={row.original} />,
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Records() {
  const { records, loading, error, refreshRecords } = useRecords();
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const columns = useMemo(() => buildColumns(), []);

  const counts = useMemo(() => {
    const byModule: Record<string, number> = {};
    for (const r of records) byModule[r.source] = (byModule[r.source] ?? 0) + 1;
    return byModule;
  }, [records]);

  const filteredByModule = useMemo(
    () =>
      moduleFilter ? records.filter((r) => r.source === moduleFilter) : records,
    [records, moduleFilter],
  );

  // Search across doc ref, reference label, filename, module, and uploader —
  // layered on top of the module filter, in addition to the DataTable's own
  // built-in per-column global search box.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByModule;
    return filteredByModule.filter((r) =>
      [r.docRef, r.docLabel, r.filename, r.module, r.uploadedBy ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [filteredByModule, search]);

  const totalSize = records.reduce((s, r) => s + (r.size || 0), 0);

  const summaryStats = [
    {
      label: "Total Files",
      value: String(records.length),
      icon: Archive,
      color: "#f59e0b",
    },
    {
      label: "Tickets",
      value: String(counts.ticket ?? 0),
      icon: Ticket,
      color: "#ec4899",
    },
    {
      label: "Vehicle In/Out",
      value: String(counts.vehicle ?? 0),
      icon: Truck,
      color: "#10b981",
    },
    {
      label: "Storage Used",
      value: formatFileSize(totalSize),
      icon: FolderLock,
      color: "#818cf8",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Records"]} />
      <RecordsShell
        title="Records"
        subtitle="Every attachment across the ERP — Tickets, Vehicle In/Out, Document Vault — in one searchable place"
        action={
          <button
            onClick={refreshRecords}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
            style={{ color: "#fbbf24" }}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        }
      >
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryStats.map((s) => (
            <FinanceGlassCard
              key={s.label}
              label={s.label}
              value={s.value}
              icon={s.icon}
              accentColor={s.color}
            />
          ))}
        </div>

        {error && (
          <div className="p-4 text-center text-destructive text-sm bg-destructive/5 border border-destructive/20 rounded-xl">
            Failed to load records: {error}
          </div>
        )}

        <GlassSection
          title="All Attachments"
          icon={Archive}
          accentColor="#f59e0b"
          action={
            <div className="flex items-center gap-2">
              {/* Module quick-filter chips */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setModuleFilter(null)}
                  className={`px-2.5 py-1 rounded-full text-xs font-heading transition-colors ${
                    moduleFilter === null
                      ? "bg-amber-500/20 text-amber-500"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  All
                </button>
                {Object.entries(MODULE_META).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() =>
                      setModuleFilter(moduleFilter === key ? null : key)
                    }
                    className="px-2.5 py-1 rounded-full text-xs font-heading transition-colors"
                    style={
                      moduleFilter === key
                        ? { background: `${meta.color}28`, color: meta.color }
                        : { color: "var(--muted-foreground)" }
                    }
                  >
                    {meta.label} ({counts[key] ?? 0})
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {/* Doc-reference search bar — searches doc ref, filename, module, uploader */}
          <div className="relative mb-3">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by document number, filename, module, or uploader…"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm bg-muted/60 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 placeholder:text-muted-foreground/70"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: isDark ? "rgba(15,17,26,0.45)" : "rgba(255,255,255,0.72)",
              border: isDark
                ? "1px solid rgba(245,158,11,0.18)"
                : "1px solid rgba(245,158,11,0.22)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: isDark
                ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
                : "0 4px 24px rgba(245,158,11,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
          >
            <DataTable
              data={searched}
              columns={columns}
              loading={loading}
              getRowId={(row) => row.id}
              searchPlaceholder="Filter visible columns…"
              emptyMessage={
                records.length === 0
                  ? "No attachments yet. Files uploaded in Tickets, Vehicle In/Out, or the Document Vault will appear here automatically."
                  : "No attachments match your search."
              }
              exportConfig={{
                title: "Records",
                filename: "records",
                columns: [
                  { header: "Module", accessor: "module" },
                  { header: "Doc Ref.", accessor: "docRef" },
                  { header: "Reference", accessor: "docLabel" },
                  { header: "File", accessor: "filename" },
                  { header: "Uploaded By", accessor: "uploadedBy" },
                  { header: "Uploaded At", accessor: "uploadedAt" },
                ],
              }}
            />
          </div>
        </GlassSection>
      </RecordsShell>
    </>
  );
}
