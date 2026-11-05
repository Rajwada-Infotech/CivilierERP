// Shared by the FA Inventory page and its parts. The sheet styles are the Fixed Asset module's, from ../record/config.
import { exportToXlsx } from "@/lib/export";
import type { PendingBatch, TaggingListItem } from "@/api/fixedAssetTaggingApi";

export { fmt, fmtDate, ensureArray } from "../record/config";
import { fmtDate, ensureArray } from "../record/config";

/** A calendar date as YYYY-MM-DD in local time (toISOString() is UTC, a day behind before 05:30 in India). */
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Financial Year always follows the Document Date, never picked by hand, so an entry's date and its year can't drift apart.
export function deriveFinYear(docDate: string, finYears: { year: string; startDate: string; endDate: string }[]): string {
  if (!docDate) return "";
  return finYears.find((f) => f.startDate && f.endDate && docDate >= f.startDate && docDate <= f.endDate)?.year || "";
}

/** What New tagging starts from: blank, or a received batch's company, project, godown and item. */
export interface TaggingPrefill {
  companyId: string;
  projectId: string;
  godownId: string;
  itemId: string;
  numberOfItems: string;
}

/** One line of the inventory table: received stock not tagged yet, or one tagging entry. */
export type InventoryRow = { kind: "pending"; key: string; b: PendingBatch } | { kind: "tag"; key: string; t: TaggingListItem };

// Exports every item whatever the filters show: all untagged stock first, then every tagging entry.
export async function exportInventory(pendingBatches: PendingBatch[], taggings: TaggingListItem[]) {
  const pendingRows = ensureArray<PendingBatch>(pendingBatches).map((b) => ({
    docNo: b.SourceDocNo || "",
    source: b.SourceType === "GRN" ? "GRN" : "Imported Stock / Without GRN",
    date: b.DocDate ? fmtDate(b.DocDate) : "",
    item: b.AssetName || "",
    itemCode: "",
    category: "",
    faItemCode: "",
    transfer: "",
    company: b.CompanyName || "",
    project: b.ProjectName || "",
    godown: b.GodownName || "",
    qty: b.Quantity ?? "",
    status: "Untagged",
    record: "",
    remarks: b.Reason === "NO_TEMPLATE" ? "No Project Alias - add one in ID Template Master" : "Ready to tag",
  }));
  const tagRows = ensureArray<TaggingListItem>(taggings).map((t) => ({
    docNo: t.DocNo || "",
    source: t.StockSource === "IMPORT" ? "Imported Stock / Without GRN" : t.StockSource || "",
    date: t.DocDate ? fmtDate(t.DocDate) : "",
    item: t.AssetName || "",
    itemCode: t.AssetCode || "",
    category: t.AssetCategory || "",
    faItemCode: t.FAItemCode || "",
    transfer: t.TransferredToCode ? `Moved to ${t.TransferredToCode}` : t.TransferredFromCode ? `Came from ${t.TransferredFromCode}` : "",
    company: t.CompanyName || "",
    project: t.ProjectName || "",
    godown: t.GodownName || "",
    qty: t.TaggedQty ?? "",
    status: t.Status === "Transferred" ? "Transferred - Not Available" : t.Status,
    record: t.RecordStatus || "",
    remarks: t.Remarks || "",
  }));
  const rows = [...pendingRows, ...tagRows];
  if (rows.length === 0) return 0;
  await exportToXlsx(
    rows,
    [
      { header: "Doc No", accessor: "docNo" },
      { header: "Stock Source", accessor: "source" },
      { header: "Date", accessor: "date" },
      { header: "Item", accessor: "item" },
      { header: "Item Code", accessor: "itemCode" },
      { header: "Asset Category", accessor: "category" },
      { header: "FA Item Code", accessor: "faItemCode" },
      { header: "Transfer", accessor: "transfer" },
      { header: "Company", accessor: "company" },
      { header: "Project", accessor: "project" },
      { header: "Godown", accessor: "godown" },
      { header: "Quantity", accessor: "qty" },
      { header: "Status", accessor: "status" },
      { header: "Record", accessor: "record" },
      { header: "Remarks", accessor: "remarks" },
    ],
    `FA_Inventory_${todayLocal()}`,
    "FA Inventory",
  );
  return rows.length;
}
