import React, { useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useRecords, RecordFileAttachment } from "@/contexts/RecordsContext";
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

function fileIcon(type?: string) {
  if (!type) return <File size={14} className="text-muted-foreground" />;
  if (type.startsWith("image/")) return <FileImage size={14} className="text-blue-400" />;
  if (type.includes("pdf")) return <FileText size={14} className="text-red-400" />;
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv"))
    return <FileSpreadsheet size={14} className="text-green-500" />;
  return <FileText size={14} className="text-muted-foreground" />;
}

function entryBadge(type: string) {
  if (type === "Payment")
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-heading bg-blue-500/15 text-blue-500">
        Payment
      </span>
    );
  if (type === "Expense")
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-heading bg-destructive/15 text-destructive">
        Expense
      </span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-heading bg-green-500/15 text-green-500">
      Receipt
    </span>
  );
}

function UploadCell({ id, attachment, onAttach }: {
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
    // reset so same file can be re-uploaded
    e.target.value = "";
  };

  if (attachment) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        {fileIcon(attachment.type)}
        <span className="text-xs text-foreground truncate max-w-[100px]" title={attachment.name}>
          {attachment.name}
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title="Replace file"
        >
          <Paperclip size={12} />
        </button>
        <input ref={inputRef} type="file" className="hidden" onChange={handleFile} />
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
      <input ref={inputRef} type="file" className="hidden" onChange={handleFile} />
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

export default function Records() {
  const { records, attachFile, refreshRecords } = useRecords();

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
      value: `₹${totalAmount.toLocaleString("en-IN")}`,
      icon: IndianRupee,
      color: "hsl(142, 71%, 45%)",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Record Management", "Records"]} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-heading font-bold text-foreground">Records</h1>
        <button
          onClick={refreshRecords}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Refresh from Payment & Expense data"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {summaryStats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-card border border-border p-4 flex items-center gap-4"
            style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
          >
            <div className="p-2 rounded-lg" style={{ background: `${s.color}20` }}>
              <s.icon size={20} style={{ color: s.color }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-heading">{s.label}</p>
              <p className="text-base sm:text-lg font-heading font-bold text-foreground truncate">
                {s.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Records Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground text-sm">All Records</h2>
          <span className="text-xs text-muted-foreground">{records.length} entries</span>
        </div>

        {records.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            No records found. Add payments or expenses first, then click Refresh.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Doc No.",
                      "Date",
                      "Entry Type",
                      "Project",
                      "Amount (₹)",
                      "Mode / Doc Type",
                      "Status",
                      "Attachment",
                      "Download",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((record, i) => (
                    <tr
                      key={record.id}
                      className={`border-b border-border transition-colors hover:bg-muted/50 ${
                        i % 2 === 1 ? "bg-muted/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-primary font-heading text-xs whitespace-nowrap">
                        {record.docNumber}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {record.date
                          ? format(new Date(record.date), "dd/MM/yyyy")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">{entryBadge(record.entryType)}</td>
                      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap max-w-[140px] truncate">
                        {record.project}
                      </td>
                      <td className="px-4 py-3 text-foreground font-heading font-medium whitespace-nowrap">
                        ₹{record.amount.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {record.mode || record.docType || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-heading ${
                            record.status === "approved" || record.status === "reconciled"
                              ? "bg-green-500/15 text-green-500"
                              : record.status === "cleared"
                              ? "bg-blue-500/15 text-blue-500"
                              : "bg-yellow-500/15 text-yellow-600"
                          }`}
                        >
                          {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <UploadCell
                          id={record.id}
                          attachment={record.attachment}
                          onAttach={attachFile}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <DownloadButton attachment={record.attachment} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {records.map((record) => (
                <div key={record.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-primary font-heading">{record.docNumber}</p>
                      <p className="text-sm font-medium text-foreground truncate">{record.project}</p>
                      <p className="text-xs text-muted-foreground">
                        {record.date ? format(new Date(record.date), "dd/MM/yyyy") : "—"}
                        {(record.mode || record.docType) ? ` · ${record.mode || record.docType}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {entryBadge(record.entryType)}
                      <p className="text-sm font-heading font-bold text-foreground">
                        ₹{record.amount.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <UploadCell
                      id={record.id}
                      attachment={record.attachment}
                      onAttach={attachFile}
                    />
                    <DownloadButton attachment={record.attachment} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
