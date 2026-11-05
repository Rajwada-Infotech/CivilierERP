// src/pages/masters/TypeOfDocMaster.tsx
import { Loader2, Plus } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { HEAD, KEY_INK, RULE } from "./typeOfDoc/config";
import { useTypeOfDoc } from "./typeOfDoc/useTypeOfDoc";
import { DocTypeDrawer } from "./typeOfDoc/DocTypeDrawer";
import { DocTypeViewDrawer } from "./typeOfDoc/DocTypeViewDrawer";

const TypeOfDocMaster: React.FC = () => {
  const m = useTypeOfDoc();
  const { rights, types, isLoading, columns, editingId, drawerOpen, setDrawerOpen } = m;

  return (
    <>
      <Breadcrumbs items={["Admin", "Type of Document"]} />

      <SheetShell
        eyebrow="CivilierERP · Admin · Setup"
        title="Types of document"
        subtitle="Document number formats tied to entry types, modules, companies and projects."
        action={
          rights.canCreate ? (
            <button onClick={() => setDrawerOpen(true)} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> Add new type
            </button>
          ) : undefined
        }
      >
        {/* ── Table ── */}
        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>
              Document types <span className="font-normal text-muted-foreground tabular-nums ml-1">{types.length}</span>
            </span>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : types.length === 0 ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              No document types yet. Add one to get started.
            </div>
          ) : (
            <DataTable
              data={types}
              columns={columns}
              searchPlaceholder="Search document types…"
              paginated={true}
              defaultPageSize={10}
              emptyMessage="No document types yet."
              rowClassName={(row) =>
                row.original.TypeOfDocId === editingId
                  ? "bg-primary/5 border-l-2 border-l-foreground"
                  : ""
              }
            />
          )}
        </div>
      </SheetShell>

      {drawerOpen && <DocTypeDrawer m={m} />}
      <DocTypeViewDrawer m={m} />
    </>
  );
};

export default TypeOfDocMaster;
