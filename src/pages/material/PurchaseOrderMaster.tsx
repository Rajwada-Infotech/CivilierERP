// Purchase Order. The page is split into parts under ./purchaseOrder:
//   config             constants, types, helpers, the chain-status hook
//   usePurchaseOrder   all state, prefills, totals, print and mutations
//   list:  PORegister, PODeleteBlockDialog, PODeleteConfirmDialog, POPreviewModal
//   form:  POFormHeader, PODocSource, POHeaderDetails, POPartyPanels, POLineItems,
//          POTerms, POFlowStatus, POActionBar
import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { Plus, ShoppingCart, Download, Upload, Loader2 as Loader2Icon } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { PO_EXPORT_COLUMNS } from "./purchaseOrder/config";
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
        <MaterialShell
          title="Purchase Orders"
          subtitle="Create and manage purchase orders"
          icon={ShoppingCart}
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold btn-module text-white hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <Loader2Icon size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                <span className="hidden sm:inline">
                  {importing ? "Importing..." : "Import CSV"}
                </span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={goToCreate}
                  className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg btn-module transition-all"
                >
                  <Plus size={13} />
                  New Purchase Order
                </button>
              )}
            </div>
          }
        >
          <PORegister m={m} />
          <PODeleteBlockDialog m={m} />
          <PODeleteConfirmDialog m={m} />
        </MaterialShell>

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
      <MaterialShell
        title="Purchase Orders"
        subtitle="Create and manage purchase orders"
        icon={ShoppingCart}
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
      </MaterialShell>
    </>
  );
};

export default PurchaseOrderMaster;
