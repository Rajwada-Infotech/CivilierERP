// Quotation (request for quotation). The page is split into parts under ./quotation:
//   config        styles, types, small helpers
//   useQuotation  all state, queries, mutations, register columns, print helper
//   QtList        the register
//   QtForm        create / edit
//   QtView        one quotation opened
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import { Plus } from "lucide-react";
import { SheetShell } from "@/components/sheet/Sheet";
import { EXPORT_COLUMNS, KEY_INK } from "./quotation/config";
import { useQuotation } from "./quotation/useQuotation";
import { QtList } from "./quotation/QtList";
import { QtForm } from "./quotation/QtForm";
import { QtView } from "./quotation/QtView";

export default function Quotation() {
  const m = useQuotation();
  const { rights, viewMode, loadingList, rows, startNew } = m;

  return (
    <>
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "Quotation" }]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Quotations"
        subtitle="Request and compare supplier quotes against a tagged material request."
        action={
          viewMode === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={rows as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Quotations"
                filename="quotations"
                disabled={loadingList || !rows.length || !rights.canExport}
              />
              {rights.canCreate && (
                <button type="button" onClick={startNew} className={`${KEY_INK} h-9 px-4`}>
                  <Plus size={13} /> New quotation
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {viewMode === "list" && <QtList m={m} />}
        {viewMode === "form" && <QtForm m={m} />}
        {viewMode === "view" && <QtView m={m} />}
      </SheetShell>
    </>
  );
}
