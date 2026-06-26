import React, { useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import {
  useRecords,
  type RecordFileAttachment,
  type UnifiedRecord,
} from "@/hooks/useRecords";
import { format } from "date-fns";
import {
  Download,
  Paperclip,
  RefreshCw,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  IndianRupee,
  Receipt,
  CreditCard,
} from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";
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

function EntryBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    Payment: "bg-blue-500/15 text-blue-500",
    Expense: "bg-destructive/15 text-destructive",
    Receipt: "bg-green-500/15 text-green-500",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-heading ${styles[type] ?? styles.Receipt}`}
    >
      {type}
    </span>
  );
}

function UploadCell({
  id,
  attachment,
  onAttach,
}: {
  id: string;
  attachment?: RecordFileAttachment;
  onAttach: (id: string, file: RecordFileAttachment) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = () => {
      onAttach(id, {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result as string,
        uploadedAt: new Date().toISOString(),
      });
      setLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  if (attachment) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        {fileIcon(attachment.type)}
        <span
          className="text-xs text-foreground truncate max-w-[100px]"
          title={attachment.name}
        >
          {attachment.name}
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title="Replace file"
        >
          <Paperclip size={12} />
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleFile}
        />
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
      >
        <Paperclip size={12} />
        {loading ? "Uploading…" : "Attach"}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleFile}
      />
    </>
  );
}

function DownloadButton({ attachment }: { attachment?: RecordFileAttachment }) {
  if (!attachment) {
    return (
      <button
        disabled
        className="p-1.5 rounded-md text-muted-foreground/40 cursor-not-allowed"
        title="No file attached"
      >
        <Download size={15} />
      </button>
    );
  }
  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = attachment.dataUrl;
    link.download = attachment.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  return (
    <button
      onClick={handleDownload}
      className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
      title={`Download ${attachment.name}`}
    >
      <Download size={15} />
    </button>
  );
}

// ─── Columns ─────────────────────────────────────────────────────────────────

function buildColumns(
  attachFile: (id: string, file: RecordFileAttachment) => void,
): ColumnDef<UnifiedRecord, unknown>[] {
  return [
    {
      accessorKey: "docNumber",
      header: "Doc No.",
      cell: ({ getValue }) => (
        <span className="text-primary font-heading text-xs whitespace-nowrap">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span className="whitespace-nowrap">
            {v ? format(new Date(v), "dd/MM/yyyy") : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "entryType",
      header: "Entry Type",
      cell: ({ getValue }) => <EntryBadge type={getValue() as string} />,
    },
    {
      accessorKey: "project",
      header: "Project",
      cell: ({ getValue }) => (
        <span className="font-medium whitespace-nowrap max-w-[140px] truncate block">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount (₹)",
      cell: ({ getValue }) => (
        <span className="font-heading font-medium whitespace-nowrap">
          {formatINR(getValue() as number)}
        </span>
      ),
    },
    {
      id: "modeOrDoc",
      header: "Mode / Doc Type",
      accessorFn: (row) => row.mode || row.docType || "—",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        const style =
          v === "approved" || v === "reconciled"
            ? "bg-green-500/15 text-green-500"
            : v === "cleared"
              ? "bg-blue-500/15 text-blue-500"
              : "bg-yellow-500/15 text-yellow-600";
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-heading ${style}`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </span>
        );
      },
    },
    {
      id: "attachment",
      header: "Attachment",
      enableSorting: false,
      cell: ({ row }) => (
        <UploadCell
          id={row.original.id}
          attachment={row.original.attachment}
          onAttach={attachFile}
        />
      ),
    },
    {
      id: "download",
      header: "Download",
      enableSorting: false,
      cell: ({ row }) => (
        <DownloadButton attachment={row.original.attachment} />
      ),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Records() {
  const { records, loading, error, attachFile, refreshRecords } = useRecords();

  const columns = useMemo(() => buildColumns(attachFile), [attachFile]);

  const totalPayments = records.filter((r) => r.entryType === "Payment").length;
  const totalExpenses = records.filter((r) => r.entryType === "Expense").length;
  const totalAmount = records.reduce((s, r) => s + r.amount, 0);

  const summaryStats = [
    {
      label: "Total Records",
      value: String(records.length),
      icon: FileText,
      color: "hsl(var(--primary))",
    },
    {
      label: "Payments",
      value: String(totalPayments),
      icon: CreditCard,
      color: "hsl(217, 91%, 60%)",
    },
    {
      label: "Expenses",
      value: String(totalExpenses),
      icon: Receipt,
      color: "hsl(0, 72%, 51%)",
    },
    {
      label: "Total Amount",
      value: formatINR(totalAmount),
      icon: IndianRupee,
      color: "hsl(142, 71%, 45%)",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Record Management", "Records"]} />
      <FinanceShell
        title="Records"
        subtitle="Financial entry documents with file attachments"
        action={
          <button
            onClick={refreshRecords}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors"
            style={{ color: "#818cf8" }}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        }
      >
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryStats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-4 flex items-center gap-4"
              style={{
                background: `${s.color}0A`,
                border: `1px solid ${s.color}30`,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderLeftWidth: 3,
                borderLeftColor: s.color,
              }}
            >
              <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
                <s.icon size={18} style={{ color: s.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
                <p className="text-base font-heading font-bold text-foreground truncate">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="p-4 text-center text-destructive text-sm bg-destructive/5 border border-destructive/20 rounded-xl">
            Failed to load records: {error}
          </div>
        )}

        {/* Records Table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: "rgba(15,17,26,0.45)",
            border: "1px solid rgba(99,102,241,0.15)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <DataTable
            data={records}
            columns={columns}
            loading={loading}
            paginated={false}
            searchPlaceholder="Search records…"
            emptyMessage="No records found. Add payments or expenses first, then click Refresh."
          />
        </div>
      </FinanceShell>
    </>
  );
}
