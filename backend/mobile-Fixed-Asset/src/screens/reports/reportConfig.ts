// Per-report config for the Fixed Asset Reports section. Each report maps an
// existing list endpoint into a common row shape the generic ReportViewScreen
// renders. Every report is keyed / grouped by FA Item Code.
import {
  getDepreciationSummary,
  getFixedAssets,
  getMaintenanceList,
  getAssetTransfers,
} from "@/api/fixedAssetApi";
import { formatINR } from "@/utils/formatCurrency";

export type ReportKey = "depreciation" | "owner" | "maintenance" | "transfer";

export interface ReportRow {
  id: string;
  code: string;          // FA Item Code (card heading)
  name: string;          // Item name (sub-heading)
  badge?: string;        // small pill, e.g. status
  amount?: string;       // right-aligned headline figure
  lines: { label: string; value: string }[];
}

export interface ReportConfig {
  title: string;
  load: () => Promise<ReportRow[]>;
}

const dash = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const day = (v: unknown) => (v ? String(v).slice(0, 10) : "—");
const month = (v: unknown) => (v ? String(v).slice(0, 7) : "—");

export const REPORTS: Record<ReportKey, ReportConfig> = {
  depreciation: {
    title: "Total Depreciation (FA Item Code wise)",
    load: async () => {
      const rows = await getDepreciationSummary();
      return rows.map((r) => ({
        id: String(r.AssetId),
        code: dash(r.FAItemCode),
        name: dash(r.AssetName),
        amount: formatINR(r.TotalDepreciation, { decimals: 2 }),
        lines: [
          { label: "Company", value: dash(r.CompanyName) },
          { label: "Method / Rate", value: `${dash(r.DepreciationType)} · ${r.DepreciationRate != null ? `${r.DepreciationRate}%` : "—"}` },
          { label: "Purchase Cost", value: formatINR(r.PurchaseCost, { decimals: 2 }) },
          { label: "Months Posted", value: String(r.MonthsPosted ?? 0) },
          { label: "Total Depreciation", value: formatINR(r.TotalDepreciation, { decimals: 2 }) },
          { label: "Book Value", value: formatINR(r.BookValue, { decimals: 2 }) },
          { label: "Period", value: `${month(r.FirstPeriod)} – ${month(r.LastPeriod)}` },
        ],
      }));
    },
  },

  owner: {
    title: "FA Owner / Custodian (FA Item Code wise)",
    load: async () => {
      const rows = await getFixedAssets();
      return rows
        .filter((r) => r.FAItemCode)
        .map((r) => ({
          id: String(r.AssetId),
          code: dash(r.FAItemCode),
          name: dash(r.AssetName),
          badge: r.AssetStatus || undefined,
          lines: [
            { label: "Category", value: dash(r.AssetCategory) },
            { label: "Company", value: dash(r.CompanyName) },
            { label: "Owner / Custodian", value: dash(r.Custodian) },
            { label: "Department", value: dash(r.Department) },
            { label: "Location", value: dash(r.Location) },
            { label: "Activation Date", value: day(r.ActivationDate) },
          ],
        }));
    },
  },

  maintenance: {
    title: "FA Maintenance & Repair (FA Item Code wise)",
    load: async () => {
      const rows = await getMaintenanceList();
      return rows.map((r) => ({
        id: String(r.MaintenanceId),
        code: dash(r.FAItemCode),
        name: dash(r.ItemName),
        badge: r.Status || undefined,
        amount: formatINR(r.TotalAmount ?? r.Amount, { decimals: 2 }),
        lines: [
          { label: "Doc No / Date", value: `${dash(r.DocNo)} · ${day(r.DocDate)}` },
          { label: "Vendor", value: dash(r.VendorName) },
          { label: "Repair Type", value: `${dash(r.RepairExpenseType)} Repair` },
          { label: "Taxable", value: formatINR(r.TaxableAmount ?? r.Amount, { decimals: 2 }) },
          { label: "GST", value: formatINR(r.GstAmount ?? 0, { decimals: 2 }) },
          { label: "Total", value: formatINR(r.TotalAmount ?? r.Amount, { decimals: 2 }) },
        ],
      }));
    },
  },

  transfer: {
    title: "Asset Transfer Report (FA Item Code wise)",
    load: async () => {
      const rows = await getAssetTransfers();
      return rows.map((r) => ({
        id: String(r.Id),
        code: dash(r.FAItemCode),
        name: dash(r.AssetName),
        lines: [
          { label: "Transfer Date", value: day(r.TransferDate) },
          { label: "From User", value: dash(r.FromUserName) },
          { label: "To User", value: dash(r.ToUserName) },
          { label: "Department", value: dash(r.DepartmentName) },
          { label: "Doc No", value: dash(r.DocNo) },
        ],
      }));
    },
  },
};
