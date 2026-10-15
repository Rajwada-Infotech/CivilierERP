// Quotation (request for quotation). The page is split into parts under ./quotation:
//   config        styles, types, small helpers
//   useQuotation  all state, queries, mutations, register columns, print helper
//   QtList        the register
//   QtForm        create / edit
//   QtView        one quotation opened
import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import { FileSpreadsheet, Plus } from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { EXPORT_COLUMNS } from "./quotation/config";
import { useQuotation } from "./quotation/useQuotation";
import { QtList } from "./quotation/QtList";
import { QtForm } from "./quotation/QtForm";
import { QtView } from "./quotation/QtView";

export default function Quotation() {
  const m = useQuotation();
  const { rights, viewMode, items, loadingList, rows, startNew, columns } = m;

  return (
    <MaterialShell
      title="Quotation"
      subtitle="Request and compare supplier quotes against a tagged Material Request"
      icon={FileSpreadsheet}
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
              <button
                type="button"
                onClick={startNew}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg btn-module transition-all"
              >
                <Plus size={13} />
                New Quotation
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "Quotation" }]} />
      {/* Called as functions, not rendered as <ListView/> etc.: they are
          defined inside this component, so JSX would give React a brand-new
          component type on every render and remount the whole form on each
          keystroke (Remarks accepted one letter, then lost focus). None of
          them use hooks. */}
      {viewMode === "list" && <QtList m={m} />}
      {viewMode === "form" && <QtForm m={m} />}
      {viewMode === "view" && <QtView m={m} />}
    </MaterialShell>
  );
}
