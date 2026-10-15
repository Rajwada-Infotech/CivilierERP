// Purchase Order. The page is split into parts under ./purchaseOrder:
//   config             constants, types, helpers, the chain-status hook
//   usePurchaseOrder   all state, prefills, totals, print and mutations
//   list:  PORegister, PODeleteBlockDialog, PODeleteConfirmDialog, POPreviewModal
//   form:  POFormHeader, PODocSource, POHeaderDetails, POPartyPanels, POLineItems,
//          POTerms, POFlowStatus, POActionBar
import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { Plus, Download, Upload, Loader2 as Loader2Icon } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { PO_EXPORT_COLUMNS, KEY_INK, KEY_LINE } from "./purchaseOrder/config";
import { usePurchaseOrder } from "./purchaseOrder/usePurchaseOrder";
import { PORegister } from "./purchaseOrder/PORegister";
import { PODeleteBlockDialog } from "./purchaseOrder/PODeleteBlockDialog";
import { PODeleteConfirmDialog } from "./purchaseOrder/PODeleteConfirmDialog";
import { POPreviewModal } from "./purchaseOrder/POPreviewModal";
import { POFormHeader } from "./purchaseOrder/POFormHeader";
import { PODocSource } from "./purchaseOrder/PODocSource";
import { POHeaderDetails } from "./purchaseOrder/POHeaderDetails";
import { POPartyPanels } from "./purchaseOrder/POPartyPanels";
import { POLineItems } from "./purchaseOrder/POLineItems";
import { POTerms } from "./purchaseOrder/POTerms";
import { POFlowStatus } from "./purchaseOrder/POFlowStatus";
import { POActionBar } from "./purchaseOrder/POActionBar";

const PurchaseOrderMaster: React.FC = () => {
  const m = usePurchaseOrder();
  const { importFileInputRef, importing, rights, viewMode, items, listData, goToCreate, handleDownloadTemplate, handleImportClick, handleImportFileChange } = m;

  if (viewMode === "list") {
    return (
      <>
        <Breadcrumbs
          items={["Dashboard", "Material", "Purchase Order Master"]}
        />
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Purchase orders"
          subtitle="Orders placed with suppliers — from a material request, a quotation, a work order or direct."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                data={listData as unknown as Record<string, unknown>[]}
                columns={PO_EXPORT_COLUMNS}
                title="Purchase Orders"
                filename="purchase-orders"
                disabled={!listData.length || !rights.canExport}
              />
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportFileChange}
                className="hidden"
              />
              <button
                onClick={handleDownloadTemplate}
                title="Download a blank CSV template"
                className={`${KEY_LINE} h-9 px-3`}
              >
                <Download size={12} />
                <span className="hidden sm:inline">Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className={`${KEY_LINE} h-9 px-3`}
              >
                {importing ? (
                  <Loader2Icon size={12} className="animate-spin" />
                ) : (
                  <Upload size={12} />
                )}
                <span className="hidden sm:inline">
                  {importing ? "Importing..." : "Import CSV"}
                </span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={goToCreate}
                  className={`${KEY_INK} h-9 px-4 shrink-0`}
                >
                  <Plus size={13} />
                  New purchase order
                </button>
              )}
            </div>
          }
        >
          <PORegister m={m} />
          <PODeleteBlockDialog m={m} />
          <PODeleteConfirmDialog m={m} />
        </SheetShell>

        <POPreviewModal m={m} />
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: CREATE / EDIT / VIEW FORM
  // ─────────────────────────────────────────────────────────────────────────


  return (
    <>
      <Breadcrumbs
        items={[
          "Dashboard",
          "Material",
          "Purchase Order Master",
          viewMode === "create" ? "New" : viewMode === "edit" ? "Edit" : "View",
        ]}
      />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Purchase orders"
        subtitle="Orders placed with suppliers — from a material request, a quotation, a work order or direct."
      >
        <POFormHeader m={m} />

        <div className="space-y-5 min-w-0">
          <PODocSource m={m} />
          <POHeaderDetails m={m} />
          <POPartyPanels m={m} />
          <POLineItems m={m} />
          <POTerms m={m} />
          <POFlowStatus m={m} />
          <POActionBar m={m} />
        </div>
      </SheetShell>
    </>
  );
};

export default PurchaseOrderMaster;
