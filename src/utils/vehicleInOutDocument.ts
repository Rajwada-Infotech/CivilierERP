// Vehicle In/Out document — maps a full Vehicle In/Out record (GET
// /vehicle-in-out/:id, with Items) onto the shared letterhead layout
// (letterheadDocument.ts) for Print and Generate PDF. Used by the Vehicle In/Out
// page and the Approval Inbox popup.
import {
  fmtDocDate,
  printLetterhead,
  downloadLetterheadPdf,
  type LetterheadCompany,
  type LetterheadDoc,
} from "@/utils/letterheadDocument";
import { loadLetterheadContext, type POSupplier } from "@/utils/purchaseOrderDocument";

const fmtDateTime = (d?: string | null) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? ""
    : dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function buildVehicleInOutLetterhead(rec: any, company: LetterheadCompany, supplier: POSupplier): LetterheadDoc {
  const items: any[] = Array.isArray(rec.Items) ? rec.Items : [];
  const remarks = String(rec.Remarks ?? "").trim();
  const entry = fmtDateTime(rec.EntryTime);
  const exit = fmtDateTime(rec.ExitTime);

  return {
    title: "Vehicle In/Out",
    docNo: rec.DocNo || `VEH-${rec.VehicleInOutID ?? ""}`,
    date: fmtDocDate(rec.DocDate),
    status: rec.Status,
    company,
    toBlocks: [
      {
        label: "Received From :",
        lines: [
          rec.SupplierName || "—",
          supplier.address || "",
          supplier.contact ? `Contact: ${supplier.contact}` : "",
          supplier.gst ? `GSTIN: ${supplier.gst}` : "",
        ],
      },
      { label: "Purchase Order :", lines: [rec.PONumber || "—"] },
      { label: "Project / Site :", lines: [rec.ProjectName || "—"] },
      { label: "Vehicle :", lines: [rec.VehicleNo || "—", rec.ChallanNo ? `Challan No: ${rec.ChallanNo}` : ""] },
      { label: "Gate Entry :", lines: [entry || "—"] },
      ...(exit ? [{ label: "Gate Exit :", lines: [exit] }] : []),
    ],
    columns: [
      { header: "Received Items" },
      { header: "Received", align: "right" as const, widthMm: 34 },
    ],
    rows: items.map((it) => ({
      cells: [
        it.ItemName || "—",
        `${Number(it.ReceivedQty ?? it.Quantity ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}${it.UomName ? ` ${it.UomName}` : ""}`,
      ],
      sub: [it.Brand ? `Brand: ${it.Brand}` : "", it.Quality ? `Quality: ${it.Quality}` : ""].filter(Boolean).join("  ·  ") || null,
    })),
    summary: [
      { label: "Total Items", value: String(items.length) },
      { label: "Challan No", value: rec.ChallanNo || "—", bold: true, rule: true },
    ],
    notes: remarks ? [{ title: "Remarks", lines: [remarks] }] : [],
    signLabel: "Received By",
    signName: rec.CreatedByName ?? rec.CreatedBy ?? null,
    terms:
      "This is a system-generated vehicle in/out gate entry from CivilierERP. Quantities are as recorded at the gate and remain subject to verification against the purchase order and the goods receipt note.",
  };
}

export async function printVehicleInOut(rec: any) {
  const { company, supplier } = await loadLetterheadContext(rec);
  printLetterhead(buildVehicleInOutLetterhead(rec, company, supplier));
}

export async function downloadVehicleInOutPdf(rec: any, filename?: string) {
  const { company, supplier } = await loadLetterheadContext(rec);
  await downloadLetterheadPdf(
    buildVehicleInOutLetterhead(rec, company, supplier),
    filename ?? `${String(rec.DocNo || rec.VehicleInOutID || "vehicle-in-out").replace(/[^\w-]+/g, "_")}.pdf`,
  );
}
