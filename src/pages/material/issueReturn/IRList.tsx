import { format } from "date-fns";
import { Edit3, Eye, Search, Trash2 } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { ACT, HEAD, LBL, RULE, inp, type ReturnRow } from "./config";
import type { IssueReturnState } from "./useIssueReturn";

// The return register: figures by status, search, the table.
export function IRList({ m }: { m: IssueReturnState }) {
  const { rights, stats, filtered, loading, search, setSearch, openDetail, openEdit, setDeleting } = m;

  const columns: ColumnDef<ReturnRow>[] = [
    {
      accessorKey: "DocNo", header: "Doc No", size: 140,
      cell: ({ getValue }) => <span className="font-heading text-xs font-semibold tracking-wide text-foreground whitespace-nowrap">{getValue() as string}</span>,
    },
    {
      accessorKey: "ReturnDate", header: "Date", size: 90, meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{v ? format(new Date(v), "dd MMM yyyy") : "—"}</span>;
      },
    },
    {
      accessorKey: "IssueDocNo", header: "Issue", size: 130, meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <span className="font-heading text-xs text-foreground whitespace-nowrap">{(getValue() as string) || "—"}</span>,
    },
    {
      id: "CompanyProject", header: "Company / Project", size: 200, meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-medium truncate">{row.original.CompanyName || "—"}</span>
          <span className="text-[0.625rem] text-muted-foreground truncate">{row.original.ProjectName || "—"}</span>
        </div>
      ),
    },
    {
      accessorKey: "GodownName", header: "Back to", size: 150, meta: { className: "hidden md:table-cell" },
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground truncate block">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "Status", header: "Status", size: 100, meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <SheetMark text={(getValue() as string) || "Draft"} tone={statusTone((getValue() as string) || "Draft")} />,
    },
    {
      id: "actions", header: () => <div className="text-right">Actions</div>, size: 110, enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center justify-end gap-1">
          <button data-row-view className={`${ACT} hover:text-foreground hover:border-foreground`} title="View" onClick={() => openDetail(r)}>
            <Eye size={14} />
          </button>
          {/* Approve / reject live in the Approval Inbox. Creating submits; editing a rejected return re-submits it. */}
          {["Draft", "Approved", "Rejected"].includes(r.Status) && rights.canEdit && (
            <button className={`${ACT} hover:text-foreground hover:border-foreground`} title={r.Status === "Rejected" ? "Edit and re-submit for approval" : "Edit"} onClick={() => openEdit(r)}>
              <Edit3 size={14} />
            </button>
          )}
          {["Draft", "Rejected"].includes(r.Status) && rights.canDelete && (
            <button className={`${ACT} hover:text-destructive hover:border-destructive`} title="Delete" onClick={() => setDeleting(r)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const figures: [string, number][] = [
    ["Total returns", stats.total],
    ["Draft", stats.draft],
    ["Pending", stats.pending],
    ["Approved", stats.approved],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 bg-card" style={{ border: RULE }}>
        {figures.map(([label, n], i) => (
          <div key={label} className={`px-4 py-3 border-foreground ${i % 2 ? "border-l" : ""} ${i > 0 ? "sm:border-l" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""}`}>
            <p className={LBL}>{label}</p>
            <p className={`font-heading text-2xl font-bold tabular-nums mt-1 text-foreground`}>{n}</p>
          </div>
        ))}
      </div>

      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: RULE }}>
          <div>
            <h3 className={HEAD}>Return register</h3>
            <p className={`${LBL} mt-1 tabular-nums`}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input type="text" placeholder="Search doc, issue, project…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inp} pl-9 !py-2`} />
          </div>
        </div>
        <DataTable columns={columns} data={filtered} loading={loading} searchable={false} emptyMessage="No issue returns yet. Click 'New Return' to create one." />
      </div>
    </div>
  );
}
