import { Check, Edit, Eye, Trash2, X } from "lucide-react";
import type { ColumnDef } from "@/components/ui/DataTable";
import type { DocTypeRecord } from "@/api/documentTypeApi";
import { SheetMark } from "@/components/sheet/Sheet";
import { ACT, TAG, effectivePrefix, recordTier } from "./config";

export function buildDocColumns(
  openEdit: (item: DocTypeRecord) => void,
  deleteId: number | null,
  setDeleteId: (id: number | null) => void,
  handleDelete: (id: number) => void,
  onView: (item: DocTypeRecord) => void,
  canEdit: boolean,
  canDelete: boolean,
): ColumnDef<DocTypeRecord, unknown>[] {
  return [
    {
      accessorKey: "EntryType",
      header: "Entry Type",
      cell: ({ getValue }) => (
        <span className="text-sm font-medium text-foreground">
          {(getValue() as string) ?? "—"}
        </span>
      ),
    },
    {
      id: "effectivePrefix",
      header: "Doc Number Prefix",
      cell: ({ row }) => (
        <span className="font-heading text-xs font-semibold tracking-wider text-foreground border border-foreground/30 px-1.5 py-0.5">
          {effectivePrefix(row.original)}
        </span>
      ),
    },
    {
      accessorKey: "Description",
      header: "Description",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "ProjectName",
      header: "Project",
      cell: ({ row }) => {
        const r = row.original;
        if (!r.ProjectId)
          return <span className="text-xs text-muted-foreground">All</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {r.ProjectCode ? (
              <>
                <span className="font-heading font-semibold text-foreground">{r.ProjectCode}</span>{" "}
                · {r.ProjectName}
              </>
            ) : (
              r.ProjectName
            )}
          </span>
        );
      },
    },
    {
      accessorKey: "links_to",
      header: "Links To",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v)
          return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {v.split(",").map((l) => (
              <span key={l} className={`${TAG} text-foreground border-foreground/40`}>
                {l.trim()}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      id: "tier",
      header: "Format",
      cell: ({ row }) => {
        const tier = recordTier(row.original);
        return <span className={`${TAG} ${tier.cls}`}>{tier.short}</span>;
      },
    },
    {
      accessorKey: "IsActive",
      header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return <SheetMark text={active ? "Active" : "Inactive"} tone={active ? "done" : "waiting"} />;
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.TypeOfDocId;
        if (deleteId === id) {
          return (
            <div className="flex items-center gap-1 justify-end">
              <span className="text-[0.6875rem] text-destructive mr-1">Deactivate?</span>
              <button
                onClick={() => handleDelete(id)}
                className={`${ACT} text-destructive border-destructive hover:bg-destructive/10`}
                title="Confirm deactivate"
                aria-label="Confirm deactivate"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                title="Keep"
                aria-label="Keep"
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <button data-row-view
              onClick={() => onView(row.original)}
              className={`${ACT} hover:text-foreground hover:border-foreground`}
              title="View details"
              aria-label="View details"
            >
              <Eye size={13} />
            </button>
            {canEdit && (
              <button
                onClick={() => openEdit(row.original)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                title="Edit"
                aria-label="Edit"
              >
                <Edit size={13} />
              </button>
            )}
            {canDelete && row.original.IsActive && (
              <button
                onClick={() => setDeleteId(id)}
                className={`${ACT} hover:text-destructive hover:border-destructive`}
                title="Deactivate"
                aria-label="Deactivate"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}
