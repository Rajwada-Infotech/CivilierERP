// Everything the Purchase Order page holds: master data, the list, the form, the
// prefills from MR / quotation / work order / work done, totals, print and the
// mutations. The page and its parts read from this one object.
import { generateUUID } from "../../../utils/cryptoPolyfill";
import { useReturnAfterView } from "@/hooks/useReturnAfterView";
import { DM_SANS_FACE_CSS, printWhenFontsReady } from "@/utils/documentFont";
import { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { escapeHtml, safeHtml } from "@/utils/escapeHtml";
import { printPurchaseOrder, downloadPurchaseOrderPdf } from "@/utils/purchaseOrderDocument";
import { printStatusLabel } from "@/utils/printStatus";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ItemPicker } from "../ItemPicker";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { fetchNextDocNumber, fetchDocTypes, type DocType } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { getPurchaseOrders, getPurchaseOrderById, addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, getSuppliers, getCompanies, getProjects, getUOMs, getSupplierDetails, getCompanyDetails, getItemsWithGST, type SupplierDetails, type CompanyDetails } from "@/api/purchaseOrdersApi";
import { type MRPOPrefill, getMRPOPrefill, getApprovedMRList } from "@/api/materialRequestApi";
import { type WDPOPrefill } from "@/api/engineeringApi";
import { type WOPOPrefill } from "@/api/workOrderApi";
import { type QTPOPrefill } from "@/api/quotationApi";

/** A quotation (for this PO's MR) whose lowest (L1) supplier isn't the PO's — GET /api/purchase-orders/l1-check. */
export type L1Deviation = {
  quotationId: number;
  quotationDocNo: string;
  mrId: number | null;
  mrDocNo: string | null;
  mrDate: string | null;
  l1SupplierId: number;
  l1SupplierName: string | null;
  l1Total: number;
  chosenQuoteTotal: number | null;
};
export type LastRate = { ItemId: string; Rate: number; UomName: string | null; PurchaseOrderID: number; DocNo: string | null; PODate: string; Status: string | null };
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { getTCRecords } from "@/api/tcMasterApi";
import { getEnterprises } from "@/api/enterpriseApi";
import { projectCompanyIds, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { usePageRights } from "@/hooks/usePageRights";
import { Trash2, Eye, Check, FileDown, Lock } from "lucide-react";
import { exportToCsv, parseCsv } from "@/lib/export";
import { getAllItemUomAlternates } from "@/api/itemUomAlternatesApi";
import { useAuth } from "@/contexts/AuthContext";
import { PO_TEMPLATE_COLUMNS, usePOChainStatus, POLineItem, POForm, TCRecord, POListItem, uid, fmt, fmtDate, ensureArray, EMPTY_LINE, EMPTY_FORM, StatusChip, resolveLineGstSplit, ViewMode } from "./config";

export function usePurchaseOrder() {
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const rights = usePageRights("purchase-orders");
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { finYears } = useFinYear();

  // ── MR prefill (when navigated from Material Request "Create PO") ─────────
  const mrPrefill =
    (location.state as { mrPrefill?: MRPOPrefill } | null)?.mrPrefill ?? null;

  // ── WD prefill (when navigated from Work Done "Create Material PO") ──────
  const wdPrefill =
    (location.state as { wdPrefill?: WDPOPrefill } | null)?.wdPrefill ?? null;

  // ── WO prefill (when navigated from Work Order "Create Material PO") ──────
  const woPrefill =
    (location.state as { woPrefill?: WOPOPrefill } | null)?.woPrefill ?? null;

  // ── QT prefill (when navigated from the L1 Price Comparative Chart) ───────
  const qtPrefill =
    (location.state as { qtPrefill?: QTPOPrefill } | null)?.qtPrefill ?? null;

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingPO, setViewingPO] = useState<any | null>(null);
  const [viewingPOSupplier, setViewingPOSupplier] =
    useState<SupplierDetails | null>(null);
  const [viewingPOCompany, setViewingPOCompany] =
    useState<CompanyDetails | null>(null);
  const [viewingPOProject, setViewingPOProject] =
    useState<CompanyDetails | null>(null);
  const [viewingTab, setViewingTab] = useState<"details" | "supplier">("details");
  const { currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const limit = 10;
  const [poTypeFilter, setPoTypeFilter] = useState<string>(""); // "" = All
  // Same collapsible-by-project pattern as Material Request's own list —
  // stays at the top level rather than inside a conditionally-called
  // helper, same Rules-of-Hooks reasoning as the other list-view state here.
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Record<string, boolean>>({});
  const [projectFilter, setProjectFilter] = useState<string>("");

  // ── Doc number state ──────────────────────────────────────────────────────
  const [poDocTypeId, setPoDocTypeId] = useState<number | null>(null);
  const poDocTypeIdRef = useRef<number | null>(null);
  const [poDocNo, setPoDocNo] = useState("");
  const [, setPoFormPatchKey] = useState(0);
  const [, setDocRefreshTrigger] = useState(0);

  // ── PO doc types (for the plain Document Type & Number select) ───────────
  const [poDocTypes, setPoDocTypes] = useState<DocType[]>([]);
  const [poDocTypesLoading, setPoDocTypesLoading] = useState(true);

  useEffect(() => {
    setPoDocTypesLoading(true);
    fetchDocTypes("PO")
      .then((types) => {
        // Mirror the ExB-PO exclusion that DocNumberPreview applied internally
        const filtered = types.filter((dt) => {
          const label = dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix;
          return !label.startsWith("ExB-PO");
        });
        setPoDocTypes(filtered);
        // Auto-select QPO when arriving from L1 chart, DPO otherwise
        if (!poDocTypeId && filtered.length > 0) {
          const preferredPrefix = qtPrefill ? "QPO" : "DPO";
          const preferred =
            filtered.find((dt) => (dt.DocNoPrefix ?? dt.Prefix) === preferredPrefix) ??
            filtered.find((dt) => (dt.DocNoPrefix ?? dt.Prefix) === "DPO") ??
            filtered[0];
          fetchNextDocNumber(
            preferred.TypeOfDocId,
            selectedFinYear || undefined,
          ).then((docNo) => applyPoDocNumber(preferred.TypeOfDocId, docNo));
        }
      })
      .finally(() => setPoDocTypesLoading(false));
    // qtPrefill is included so arriving from the L1 chart via a
    // location.state update (without a full remount of this page) still
    // re-evaluates the QPO-vs-DPO auto-select instead of using whatever
    // was captured on the very first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtPrefill]);
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const finYearOptions = finYears.filter(
    (fy) => fy.status === "Active" && !fy.locked,
  );
  const [selectedFinYear, setSelectedFinYear] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) setSelectedFinYear(activeFinYear);
  }, [activeFinYear, selectedFinYear]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState<POForm>(EMPTY_FORM());
  const [lineItems, setLineItems] = useState<POLineItem[]>([EMPTY_LINE()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteBlockInfo, setDeleteBlockInfo] = useState<{
    reason: string;
    grns?: { grnId: number; grnNo: string; status: string }[];
    expenseBookings?: { id: number; docNo: string; status: string }[];
    clearedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      brsId: number;
      expenseDocNo: string;
    }[];
    linkedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      expenseDocNo: string;
    }[];
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);
  // Source MRs — the first is the one the PO was opened from; more of the same company and project can be added,
  // their items summed into the same lines. `sourceMR` / `setSourceMR` keep meaning "the (first) MR".
  const [sourceMRs, setSourceMRs] = useState<{ id: number; docNo: string }[]>([]);
  const sourceMR = sourceMRs[0] ?? null;
  const setSourceMR = (mr: { id: number; docNo: string } | null) => setSourceMRs(mr ? [mr] : []);
  const [addMrValue, setAddMrValue] = useState("");
  const [addMrLoading, setAddMrLoading] = useState(false);

  // Source Quotation reference — set when form is opened from the L1 Chart
  const [sourceQT, setSourceQT] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // Why the PO goes to a supplier other than the lowest (L1) on the MR's quotation — required then, and the
  // directors are told. originalSupplierId: the supplier an edited PO was saved with (no reason asked unless changed).
  const [supplierChangeReason, setSupplierChangeReason] = useState("");
  const [originalSupplierId, setOriginalSupplierId] = useState<string | null>(null);

  // ── Approved MR dropdown ──────────────────────────────────────────────────
  const [mrDropdownValue, setMrDropdownValue] = useState<string>("");
  const [mrDropdownLoading, setMrDropdownLoading] = useState(false);
  const [mrDropdownError, setMrDropdownError] = useState<string | null>(null);
  // Filters applied BEFORE the MR dropdown to narrow approved MRs
  const [mrFilterCompanyId, setMrFilterCompanyId] = useState<string>("");
  const [mrFilterProjectId, setMrFilterProjectId] = useState<string>("");

  // Source WD reference — set when form is opened from a Work Done entry
  const [sourceWD, setSourceWD] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // Source WO reference — set when form is opened from a Work Order (Material PO)
  const [sourceWO, setSourceWO] = useState<{
    id: number;
    docNo: string;
  } | null>(null);

  // Source Sale Invoice reference — manually linked by user on the PO form
  const [sourceSaleInvoice, setSourceSaleInvoice] = useState<{
    id: number;
    docNo: string;
  } | null>(null);
  const [saleInvoiceInput, setSaleInvoiceInput] = useState("");

  // ── Supplier & Company detail state (auto-fetched on selection) ────────────────────
  const [supplierDetails, setSupplierDetails] =
    useState<SupplierDetails | null>(null);
  const [companyDetails, setCompanyDetails] = useState<CompanyDetails | null>(
    null,
  );

  // Whether the selected supplier and company are in the same GST state —
  // drives CGST+SGST vs IGST on every line item below. Mirrors the same
  // normalizeState + fallback-to-intrastate pattern used server-side in
  // expenseBooking.js / buildGrnGstData.js, so a PO and its downstream
  // GRN/invoice never disagree on tax mode. Defaults to intrastate when
  // either state is unknown, rather than silently charging IGST.
  const normalizeState = (v: string | null | undefined) =>
    String(v || "").trim().toLowerCase();
  const isIntraState = useMemo(() => {
    const supState = normalizeState(supplierDetails?.LGSTState);
    const compState = normalizeState(companyDetails?.state);
    return !supState || !compState || supState === compState;
  }, [supplierDetails?.LGSTState, companyDetails?.state]);
  // A non-GST (Unregistered) supplier can't charge GST at all — an item's
  // own HSN/item-master rate never applies, regardless of what it's tagged
  // with. LGSTType is explicit when set; for older rows saved before it
  // existed (null), fall back to inferring from whether a GST number is on
  // file, same as SupplierMaster.tsx's own normalizeGSTType.
  const supplierIsGstRegistered = useMemo(() => {
    if (!supplierDetails) return true; // no supplier picked yet — don't block entry
    if (supplierDetails.LGSTType === "Unregistered") return false;
    if (supplierDetails.LGSTType) return true;
    return !!supplierDetails.LGST?.trim();
  }, [supplierDetails]);
  // Reuses CompanyDetails shape — the enterprise table holds Project rows
  // too, so the same getCompanyDetails() lookup gives us the project's
  // address to show as the PO's delivery address.
  const [projectDetails, setProjectDetails] = useState<CompanyDetails | null>(
    null,
  );

  // Must be declared after sourceMR, sourceWD, sourceWO — all used in `enabled`
  const { data: approvedMRs = [], isLoading: approvedMRsLoading } = useQuery({
    queryKey: ["approvedMRList", mrFilterCompanyId, mrFilterProjectId],
    queryFn: () =>
      getApprovedMRList({
        companyId: mrFilterCompanyId || undefined,
        projectId: mrFilterProjectId || undefined,
      }),
    enabled: viewMode === "create" && !sourceMR && !sourceWD && !sourceWO,
    staleTime: 30_000,
  });

  // ── Remote data ───────────────────────────────────────────────────────────
  const { data: dbData, isLoading } = useQuery({
    queryKey: ["purchase-orders", page, limit, poTypeFilter, projectFilter],
    queryFn: () =>
      getPurchaseOrders({
        page,
        limit,
        poType: poTypeFilter || undefined,
        includeShortClosed: true,
        projectId: projectFilter ? Number(projectFilter) : undefined,
        groupBy: "project",
      }),
  });

  const { data: suppliersRaw = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliers,
  });
  const { data: companiesRaw = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: getCompanies,
  });
  const { data: projectsRaw = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const { data: uomsRaw = [] } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUOMs,
  });
  const { data: itemUomAlternates = [] } = useQuery({
    queryKey: ["item-uom-alternates"],
    queryFn: getAllItemUomAlternates,
    staleTime: 60_000,
  });
  const { data: itemsRaw = [] } = useQuery({
    queryKey: ["item-master"],
    queryFn: getItems,
  });
  // HSN-resolved GST rates — authoritative source for GST%, since
  // Item_Master_Group.M_CGST/M_SGST/M_IGST are often stale/unset while the
  // HSN Master has the current rate (see getItemsWithGST for resolution order).
  const { data: itemsGstRaw = [] } = useQuery({
    queryKey: ["items-with-gst"],
    queryFn: getItemsWithGST,
  });
  const { data: tcRaw = [] } = useQuery({
    queryKey: ["tc-master"],
    queryFn: getTCRecords,
  });

  const { data: enterprisesRaw = [] } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
  });

  const { data: paymentTerms = [] } = useQuery<{ id: number; label: string; days: number }[]>({
    queryKey: ["payment-terms-po"],
    queryFn: () =>
      fetchWithAuth("/api/payment-terms/options").then((r) =>
        r.json().catch(() => ({})),
      ),
  });

  // ── Normalise data ────────────────────────────────────────────────────────
  const suppliers = useMemo(
    () =>
      ensureArray<any>(suppliersRaw).map((s) => ({
        id: String(s.LHeadId),
        name: s.LHeadName ?? "",
      })),
    [suppliersRaw],
  );

  const companies = useMemo(
    () =>
      ensureArray<any>(companiesRaw).map((c) => ({
        id: String(c.id),
        name: c.label ?? "",
      })),
    [companiesRaw],
  );

  const allProjects = useMemo(
    () =>
      ensureArray<any>(projectsRaw).map((p) => ({
        id: String(p.id),
        name: p.label ?? "",
        belongsTo: p.belongs_to ?? null,
        companyId: p.company_id != null ? String(p.company_id) : null,
        // Primary company plus every company the project is tagged to in
        // Project Master (dbo.ProjectCompanies).
        companyIds: projectCompanyIds(p as ProjectCompanyLike),
      })),
    [projectsRaw],
  );

  // Projects filtered by the MR filter company (for the MR filter dropdown)
  const filteredMRProjects = useMemo(() => {
    if (!mrFilterCompanyId) return allProjects;
    return allProjects.filter((p) => p.companyIds.includes(mrFilterCompanyId));
  }, [allProjects, mrFilterCompanyId]);

  // Projects filtered by the form's selected company (for Order Details)
  const filteredFormProjects = useMemo(() => {
    if (!form.companyId) return allProjects;
    return allProjects.filter((p) => p.companyIds.includes(form.companyId));
  }, [allProjects, form.companyId]);

  const uoms = useMemo(
    () =>
      ensureArray<any>(uomsRaw)
        .filter((u) => u.IsActive !== false && u.IsActive !== 0)
        .map((u) => ({
          id: Number(u.Id),
          name: u.UOMName ?? "",
          code: (u.UOMCode ?? "").toString().trim(),
          category: (u.UOMCategory ?? null) as string | null,
          baseFactor: Number(u.BaseFactor) || 1,
        }))
        .filter((u) => u.name !== ""),
    [uomsRaw],
  );

  const itemsGstById = useMemo(() => {
    const map = new Map<string, { gstRate: number; hsnCode: string | null }>();
    for (const i of itemsGstRaw) map.set(String(i.id), i);
    return map;
  }, [itemsGstRaw]);

  const items = useMemo(
    () =>
      ensureArray<DbItem>(itemsRaw).map((i) => ({
        id: i.M_Id,
        name: i.M_Name,
        description: i.M_Description ?? "",
        hsn: i.M_HSN ?? "",
        uom: i.M_UOM ?? "",
        itemType: i.M_Type ?? "",
        cgst: Number(i.M_CGST ?? 0),
        sgst: Number(i.M_SGST ?? 0),
        igst: Number(i.M_IGST ?? 0),
        // HSN-resolved rate — takes precedence over the raw item-master
        // columns above, which are frequently stale/unset.
        resolvedGstRate: itemsGstById.get(String(i.M_Id))?.gstRate ?? null,
        // Cost Centre tagged on the item (Item Master) — used to auto-fill
        // this PO's own Cost Centre the first time a tagged item is added.
        costCenterId: i.M_CostCenterId ? String(i.M_CostCenterId) : "",
        // Days of Supply (Item Master) — used to floor Expected Delivery so
        // it's never sooner than the slowest item on this PO can arrive.
        daysOfSupply: i.M_DaysOfSupply != null ? Number(i.M_DaysOfSupply) : null,
      })),
    [itemsRaw, itemsGstById],
  );

  // A PO must be all-Goods or all-Service — never a mix (see the
  // validate()-time block below for the full rationale). Computed here too
  // so the cart can show a warning as soon as a mix appears, not just at
  // save time.
  const itemTypesInCart = useMemo(() => {
    const types = new Set<string>();
    for (const li of lineItems) {
      if (!li.itemName && !li.quantity) continue;
      const t = items.find((i) => i.id === li.itemId)?.itemType;
      if (t) types.add(t);
    }
    return types;
  }, [lineItems, items]);
  const hasMixedItemTypes =
    itemTypesInCart.has("Goods") && itemTypesInCart.has("Service");

  // Expected Delivery floor — never sooner than PO Date + the longest Days
  // of Supply among the cart's items, since that's the slowest item's own
  // lead time. The user can still push it later, just never earlier.
  const maxDaysOfSupply = useMemo(() => {
    let max = 0;
    for (const li of lineItems) {
      const days = items.find((i) => i.id === li.itemId)?.daysOfSupply ?? 0;
      if (days > max) max = days;
    }
    return max;
  }, [lineItems, items]);

  const minExpectedDate = useMemo(() => {
    if (!maxDaysOfSupply || !form.poDate) return "";
    const d = new Date(`${form.poDate}T00:00:00`);
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + maxDaysOfSupply);
    // The local calendar date: toISOString() is UTC and read a day early east of Greenwich, under the server's check.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [form.poDate, maxDaysOfSupply]);

  // Auto-advance Expected Delivery to the floor: fill it when blank, pull it
  // forward when the cart or PO Date push the floor past what's already
  // chosen. Never pulls it back once the user has picked something later.
  useEffect(() => {
    if (!minExpectedDate || isReadOnly) return;
    if (!form.expectedDate || form.expectedDate < minExpectedDate) {
      setField("expectedDate", minExpectedDate);
    }
  }, [minExpectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same "only show what can actually arrive in time" filter as Material
  // Request's item picker — a PO can be raised directly, without an MR
  // behind it, so this needs its own copy of the logic rather than relying
  // on whatever floor the MR it came from already enforced.
  const availableSupplyDays = useMemo(() => {
    if (!form.poDate || !form.expectedDate) return null;
    const start = new Date(`${form.poDate}T00:00:00`);
    const end = new Date(`${form.expectedDate}T00:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
  }, [form.poDate, form.expectedDate]);

  // An item already on some line stays pickable everywhere — filtering it
  // out of the list the moment the date window shrinks would make that
  // line's own ItemPicker unable to display its current value.
  const selectedItemIds = useMemo(
    () => new Set(lineItems.map((li) => li.itemId).filter(Boolean)),
    [lineItems],
  );

  const pickableItems = useMemo(() => {
    if (availableSupplyDays === null) return items;
    return items.filter((i) => {
      if (selectedItemIds.has(i.id)) return true;
      // Days of Supply is a new field — most items don't have one set yet.
      // No data means no constraint: show it anyway, exactly like an item
      // whose lead time already fits.
      if (i.daysOfSupply === null || i.daysOfSupply === undefined) return true;
      return i.daysOfSupply <= availableSupplyDays;
    });
  }, [items, availableSupplyDays, selectedItemIds]);

  const tcRecords = useMemo(
    () =>
      ensureArray<any>(tcRaw)
        .filter((t) => t.isActive !== false)
        .map((t) => ({
          id: Number(t.Id),
          name: String(t.Name ?? ""),
          terms: String(t.TermsAndCondition ?? ""),
        })),
    [tcRaw],
  );

  // ── Company logo — prefer the selected company's own logo; fall back to enterprise logo ──
  const enterpriseLogo = useMemo(() => {
    const list = ensureArray<any>(enterprisesRaw);
    const enterprise =
      list.find((e) => e.entity_type === "Enterprise") ?? list[0];
    return (enterprise?.logo as string | null) ?? null;
  }, [enterprisesRaw]);

  // The logo shown in print/preview: company-specific first, then enterprise fallback
  const activeLogo = companyDetails?.logo ?? enterpriseLogo;

  // ── Print handler — uses Blob URL so base64 logo renders correctly ─────────
  const handlePrint = () => {
    // All of these snapshots are interpolated into the print HTML below, so
    // they are HTML-escaped at the source to prevent stored data (supplier
    // names, addresses, remarks, etc.) from injecting markup/script into the
    // print window (which is same-origin and can read the auth token).
    const supplier = escapeHtml(
      suppliers.find((s) => s.id === form.supplierId)?.name ?? "—",
    );
    const company = escapeHtml(
      companies.find((c) => c.id === form.companyId)?.name ?? "—",
    );
    const project = escapeHtml(
      allProjects.find((p) => p.id === form.projectId)?.name ?? "—",
    );

    // Supplier & company detail snapshots for print
    const supAddr = escapeHtml(supplierDetails?.LHeadAddress ?? "");
    const supContact = escapeHtml(supplierDetails?.LHeadContactPerson ?? "");
    const supGST = escapeHtml(supplierDetails?.LGST ?? "");
    const supPhone = escapeHtml(supplierDetails?.LHeadPhone ?? "");
    const supEmail = escapeHtml(supplierDetails?.LHeadEmail ?? "");
    const compAddr = escapeHtml(
      [
        companyDetails?.address,
        companyDetails?.address_line2,
        companyDetails?.city,
        companyDetails?.state,
        companyDetails?.pincode,
      ]
        .filter(Boolean)
        .join(", "),
    );
    const compGST = escapeHtml(companyDetails?.gst_no ?? "");
    const compEmail = escapeHtml(companyDetails?.email ?? "");
    const compPhone = escapeHtml(companyDetails?.phone_number ?? "");

    // Logo: company-specific logo first, then enterprise fallback
    const logoHtml = activeLogo
      ? `<img src="${escapeHtml(activeLogo)}" alt="Logo" style="height:64px;max-width:200px;object-fit:contain;" />`
      : `<span style="font-size:20px;font-weight:800;color:#4f46e5;">${company}</span>`;

    // PO status badge for print
    const poStatus = form.status || "Draft";
    const statusColors: Record<
      string,
      { bg: string; color: string; border: string }
    > = {
      approved: { bg: "#f0fdf4", color: "#166534", border: "#86efac" },
      pending: { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
      draft: { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
      rejected: { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
    };
    const sc = statusColors[poStatus.toLowerCase()] ?? statusColors.draft;
    const statusHtml = `<span style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${sc.bg};color:${sc.color};border:1px solid ${sc.border};letter-spacing:0.05em;">${escapeHtml(printStatusLabel(poStatus).toUpperCase())}</span>`;

    const itemRows = lineItems
      .map(
        (li, i) => safeHtml`
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 10px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
        <td style="padding:8px 10px;font-weight:500;">${li.itemName || "—"}</td>
        <td style="padding:8px 10px;color:#6b7280;font-size:12px;">${li.itemDescription || "—"}</td>
        <td style="padding:8px 10px;text-align:center;">${li.quantity}</td>
        <td style="padding:8px 10px;text-align:center;color:#6b7280;">${li.unit || "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;">₹${li.rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td style="padding:8px 10px;text-align:center;">${li.gstRate > 0 ? li.gstRate + "%" : "—"}</td>
        <td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;">₹${li.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
      </tr>`,
      )
      .join("");

    const taxRows = [
      totalCgst > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">CGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
      totalSgst > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">SGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
      totalIgst > 0
        ? `<tr><td style="color:#6b7280;padding:5px 8px;">IGST</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
        : "",
    ].join("");

    const tcHtml = form.paymentTerms
      ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
           <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:8px;">Terms &amp; Conditions</div>
           <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.7;">${escapeHtml(form.paymentTerms)}</div>
         </div>`
      : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>PO — ${escapeHtml(form.poNumber || "—")}</title>
  <style>
    ${DM_SANS_FACE_CSS}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #fff; padding: 36px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f3f4f6; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7280; padding: 9px 10px; }
    @media print {
      body { padding: 16px; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #4f46e5;margin-bottom:28px;">
    <div>${logoHtml}</div>
    <div style="text-align:right;">
      <div style="font-size:24px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PURCHASE ORDER</div>
      <div style="font-size:15px;font-weight:700;font-family:monospace;color:#111827;margin-top:4px;">${escapeHtml(form.poNumber || "—")}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:6px;">Date: <strong>${fmtDate(form.poDate)}</strong></div>
      ${form.expectedDate ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">Expected: <strong>${fmtDate(form.expectedDate)}</strong></div>` : ""}
      ${statusHtml}
    </div>
  </div>

  <!-- Party details -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:24px;">
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Supplier</div>
      <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${supplier}</div>
      ${supAddr ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;">${supAddr}</div>` : ""}
      ${supContact ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Contact: <strong style="color:#111827;">${supContact}</strong></div>` : ""}
      ${supPhone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#128222; ${supPhone}</div>` : ""}
      ${supEmail ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#9993; ${supEmail}</div>` : ""}
      ${supGST ? `<div style="margin-top:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:4px;display:inline-block;">GSTIN: ${supGST}</span></div>` : ""}
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Billing Details</div>
      <div style="font-weight:700;font-size:13px;margin-bottom:3px;">${company}</div>
      ${compAddr ? `<div style="font-size:11px;color:#374151;margin-bottom:2px;">${compAddr}</div>` : ""}
      ${compPhone ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#128222; ${compPhone}</div>` : ""}
      ${compEmail ? `<div style="font-size:11px;color:#6b7280;margin-bottom:2px;">&#9993; ${compEmail}</div>` : ""}
      ${compGST ? `<div style="margin-top:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:4px;display:inline-block;">GSTIN: ${compGST}</span></div>` : ""}
    </div>
    <div style="padding:12px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:4px;">Project / Site</div>
      <div style="font-weight:600;font-size:13px;">${project}</div>
    </div>
  </div>

  <!-- Items table -->
  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center;">#</th>
        <th style="text-align:left;">Item</th>
        <th style="text-align:left;">Description</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:center;">UOM</th>
        <th style="text-align:right;">Rate (₹)</th>
        <th style="text-align:center;">GST %</th>
        <th style="text-align:right;">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-top:16px;">
    <table style="width:260px;border-collapse:collapse;">
      <tbody>
        <tr><td style="color:#6b7280;padding:5px 8px;">Subtotal (excl. GST)</td><td style="text-align:right;padding:5px 8px;font-family:monospace;">₹${subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
        ${taxRows}
        <tr style="border-top:2px solid #4f46e5;">
          <td style="padding:8px;font-weight:800;font-size:14px;">Grand Total</td>
          <td style="text-align:right;padding:8px;font-family:monospace;font-weight:800;font-size:15px;color:#4f46e5;">₹${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${tcHtml}

  ${form.remarks ? `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:6px;">Remarks</div><div style="font-size:12px;color:#374151;">${escapeHtml(form.remarks)}</div></div>` : ""}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
    <span>Generated by CivilierERP</span>
    <span>Printed: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
  </div>
</body>
</html>`;

    // Use Blob URL — avoids document.write CSP issues with base64 images
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank", "width=960,height=720");
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error("Pop-up blocked — please allow pop-ups for this site.");
      return;
    }
    // Revoke after enough time for the window to load and print
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    printWhenFontsReady(win);
  };

  // ── Derived list data ─────────────────────────────────────────────────────
  const dbItems: any[] = dbData?.data ?? [];
  const totalPages = Math.max(dbData?.totalPages ?? 1, 1);
  const totalRecords = dbData?.total ?? dbItems.length;

  const listData: POListItem[] = useMemo(
    () =>
      dbItems.map((item) => ({
        _id: String(item.PurchaseOrderID ?? ""),
        poNumber: item.PurchaseOrderNo ?? "",
        poDate: item.PODate ?? "",
        supplierName:
          suppliers.find((s) => s.id === String(item.SupplierID))?.name ??
          item.SupplierName ??
          "",
        companyName:
          companies.find((c) => c.id === String(item.CompanyId))?.name ??
          item.CompanyName ??
          "",
        projectName:
          allProjects.find((p) => p.id === String(item.ProjectId))?.name ??
          item.ProjectName ??
          "",
        totalAmount: Number(item.TotalAmount ?? 0),
        status: item.Status ?? "Draft",
        docNo: item.DocNo ?? "",
        remarks: item.Remarks ?? "",
        poType: item.POType ?? "Direct",
        sourceWODocNo: item.SourceWODocNo ?? null,
        effectiveMRDocNo: item.EffectiveMRDocNo ?? null,
      })),
    [dbItems, suppliers, companies, allProjects],
  );

  // ── Pre-populate form when arriving from Material Request ─────────────────
  useEffect(() => {
    if (
      !mrPrefill ||
      companies.length === 0 ||
      allProjects.length === 0 ||
      uoms.length === 0
    )
      return;

    const matchCompany = companies.find(
      (c) => String(c.id) === String(mrPrefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(mrPrefill.ProjectId),
    );

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      remarks: mrPrefill.Remarks ?? prev.remarks,
      // Raised from a work order whose lines all name one supplier: start with that supplier.
      supplierId: mrPrefill.WorkOrderSupplierId ? String(mrPrefill.WorkOrderSupplierId) : prev.supplierId,
    }));

    const prefillLines: POLineItem[] = mrPrefill.items.map((it) => {
      const cgst = Number(it.M_CGST ?? 0);
      const sgst = Number(it.M_SGST ?? 0);
      const igst = Number(it.M_IGST ?? 0);
      // The item's own GST rates win; the work order's GST % only fills in when the item master has none.
      const { cgstRate: cgstResolved, sgstRate: sgstResolved, igstRate: igstResolved, gstRate } =
        resolveLineGstSplit(cgst, sgst, igst, Number(it.WoGstRate ?? 0), isIntraState);
      // Default to what's actually still pending on this MR item, not the
      // original full requested qty — a second/third PO off the same MR
      // should only ever offer the remaining balance.
      const pendingQty = Number(it.PendingQty ?? it.Quantity ?? 1);
      const qty = pendingQty;
      // From the work order this MR was raised from, when there is one; otherwise the buyer enters it.
      const rate = Number(it.WoRate ?? 0);
      const taxAmount = (qty * rate * gstRate) / 100;

      // Resolve UOM: match UOMCode against master code, fallback to UOMName
      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch =
        uoms.find(
          (u) =>
            (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) ||
            (uomNameNorm && u.name.toLowerCase() === uomNameNorm),
        ) ?? null;

      return {
        id: uid(),
        itemId: it.ItemId ?? "",
        itemName: it.ItemName ?? "",
        itemDescription: "",
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate,
        cgstRate: cgstResolved,
        sgstRate: sgstResolved,
        igstRate: igstResolved,
        gstRate,
        taxAmount,
        amount: qty * rate + taxAmount,
        mrItemId: it.MRItemId ?? null,
        mrPendingQty: pendingQty,
      };
    });

    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceMR({ id: mrPrefill.MRId, docNo: mrPrefill.DocNo });
    if (mrPrefill.WorkOrderDocNo && prefillLines.some((l) => l.rate > 0)) {
      toast.info(
        `Rates${mrPrefill.WorkOrderSupplierId ? ", GST and supplier" : " and GST"} are filled in from work order ${mrPrefill.WorkOrderDocNo}. Check them against the supplier's offer.`,
      );
    }

    // Auto-select fin year from MR
    if (mrPrefill.FinYearId) {
      const matchFY = finYears.find(
        (fy) => String(fy.id) === String(mrPrefill.FinYearId),
      );
      if (matchFY) setSelectedFinYear(matchFY.year);
    }

    setViewMode("create");
    // Only run once when mrPrefill is present and master data is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrPrefill, companies.length, allProjects.length, uoms.length]);

  // ── Pre-populate form when arriving from the L1 Price Comparative Chart ───
  // The winning supplier and their quoted rates are already known — unlike
  // the MR prefill, this pre-fills supplierId and each line's rate too.
  useEffect(() => {
    if (
      !qtPrefill ||
      companies.length === 0 ||
      allProjects.length === 0 ||
      uoms.length === 0
    )
      return;

    const matchCompany = companies.find(
      (c) => String(c.id) === String(qtPrefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(qtPrefill.ProjectId),
    );

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      supplierId: qtPrefill.SupplierId
        ? String(qtPrefill.SupplierId)
        : prev.supplierId,
      remarks: qtPrefill.Remarks ?? prev.remarks,
      // The payment term agreed with this supplier on the quotation.
      paymentTermId: qtPrefill.PaymentTermId ? String(qtPrefill.PaymentTermId) : prev.paymentTermId,
    }));

    const prefillLines: POLineItem[] = qtPrefill.items.map((it) => {
      const cgst = Number(it.M_CGST ?? 0);
      const sgst = Number(it.M_SGST ?? 0);
      const igst = Number(it.M_IGST ?? 0);
      const { cgstRate: cgstResolved, sgstRate: sgstResolved, igstRate: igstResolved, gstRate } =
        resolveLineGstSplit(cgst, sgst, igst, 0, isIntraState);
      const qty = Number(it.Quantity ?? 1);
      const rate = Number(it.Rate ?? 0);
      const taxAmount = (qty * rate * gstRate) / 100;

      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch =
        uoms.find(
          (u) =>
            (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) ||
            (uomNameNorm && u.name.toLowerCase() === uomNameNorm),
        ) ?? null;

      return {
        id: uid(),
        itemId: it.ItemId ?? "",
        itemName: it.ItemName ?? "",
        itemDescription: "",
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate,
        cgstRate: cgstResolved,
        sgstRate: sgstResolved,
        igstRate: igstResolved,
        gstRate,
        taxAmount,
        amount: qty * rate + taxAmount,
        uomLocked: true,
      };
    });

    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceQT({ id: qtPrefill.QuotationId, docNo: qtPrefill.DocNo });
    if (qtPrefill.SourceMRId && qtPrefill.SourceMRDocNo) {
      setSourceMR({ id: qtPrefill.SourceMRId, docNo: qtPrefill.SourceMRDocNo });
    }

    setViewMode("create");
    // Only run once when qtPrefill is present and master data is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtPrefill, companies.length, allProjects.length, uoms.length]);

  // ── Pre-populate form when arriving from Work Done "Create WO_PO" ─────────
  useEffect(() => {
    if (!wdPrefill || companies.length === 0 || allProjects.length === 0)
      return;

    const matchCompany = companies.find(
      (c) => String(c.id) === String(wdPrefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(wdPrefill.ProjectId),
    );

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      remarks: wdPrefill.Remarks ?? prev.remarks,
    }));

    const prefillLines: POLineItem[] = wdPrefill.items.map((it) => ({
      id: uid(),
      itemId: "",
      itemName: "",
      itemDescription: it.itemDescription ?? "",
      quantity: Number(it.quantity) || 1,
      uomId: null,
      unit: it.unit ?? "LS",
      rate: Number(it.rate) || 0,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
      gstRate: 0,
      taxAmount: 0,
      amount: Number(it.amount) || 0,
    }));

    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceWD({ id: wdPrefill.WDId, docNo: wdPrefill.DocNo });
    setViewMode("create");
    // Only run once when wdPrefill is present and master data is loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wdPrefill, companies.length, allProjects.length]);

  // ── Apply WO prefill (material lines from Work Order) ─────────────────────
  useEffect(() => {
    if (
      !woPrefill ||
      companies.length === 0 ||
      allProjects.length === 0 ||
      suppliers.length === 0 ||
      uoms.length === 0 ||
      items.length === 0
    )
      return;

    // Try to match a single supplier from the prefill items
    const supplierNames = [
      ...new Set(woPrefill.items.map((i) => i.supplierName).filter(Boolean)),
    ];
    const matchedSupplier =
      supplierNames.length === 1
        ? suppliers.find(
            (s) => s.name.toLowerCase() === supplierNames[0]!.toLowerCase(),
          )
        : null;

    setForm((prev) => ({
      ...prev,
      companyId: woPrefill.CompanyId
        ? String(woPrefill.CompanyId)
        : prev.companyId,
      projectId: woPrefill.ProjectId
        ? String(woPrefill.ProjectId)
        : prev.projectId,
      supplierId: matchedSupplier ? matchedSupplier.id : prev.supplierId,
    }));
    const prefillLines: POLineItem[] = woPrefill.items.map((it) => {
      // Split combined GST% into CGST+SGST halves (intra-state assumption for WO-PO).
      // If the item later gets an IGST designation the user can override in the line.
      const totalGst = Number(it.tax) || 0;
      const halfGst = totalGst / 2;
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      const base = qty * rate;
      const taxAmt = (base * totalGst) / 100;

      // Resolve unit string → UOM master entry
      // 1. Try direct match on the unit string (code or name)
      const unitNorm = (it.unit || "").trim().toLowerCase();
      let uomMatch = unitNorm
        ? (uoms.find(
            (u) =>
              u.code.toLowerCase() === unitNorm ||
              u.name.toLowerCase() === unitNorm,
          ) ?? null)
        : null;

      // 2. Fallback: look up item master M_UOM when itemId is available
      if (!uomMatch && it.itemId) {
        const masterItem = items.find((i) => i.id === it.itemId);
        if (masterItem?.uom) {
          const mUomNorm = masterItem.uom.trim().toLowerCase();
          uomMatch =
            uoms.find(
              (u) =>
                u.code.toLowerCase() === mUomNorm ||
                u.name.toLowerCase() === mUomNorm,
            ) ?? null;
        }
      }

      return {
        id: generateUUID(),
        itemId: it.itemId || "",
        itemName: it.itemDescription,
        itemDescription: it.itemDescription,
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.unit ?? "",
        rate,
        cgstRate: halfGst,
        sgstRate: halfGst,
        igstRate: 0,
        gstRate: totalGst,
        taxAmount: taxAmt,
        amount: base + taxAmt,
      };
    });
    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceWO({
      id: woPrefill.WOId,
      docNo: woPrefill.DocNo || woPrefill.DocumentNumber,
    });
    setViewMode("create");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    woPrefill,
    companies.length,
    allProjects.length,
    suppliers.length,
    uoms.length,
    items.length,
  ]);

  // ── Apply an MRPOPrefill object to the form (shared by both prefill paths) ──
  const applyMRPrefill = (prefill: MRPOPrefill) => {
    const matchCompany = companies.find(
      (c) => String(c.id) === String(prefill.CompanyId),
    );
    const matchProject = allProjects.find(
      (p) => String(p.id) === String(prefill.ProjectId),
    );

    // Resolve fin year: match prefill.FinYearId against context finYears
    if (prefill.FinYearId) {
      const matchFY = finYears.find(
        (fy) => String(fy.id) === String(prefill.FinYearId),
      );
      if (matchFY) setSelectedFinYear(matchFY.year);
    }

    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId,
      projectId: matchProject?.id ?? prev.projectId,
      remarks: prefill.Remarks ?? prev.remarks,
    }));
    const prefillLines: POLineItem[] = prefill.items.map((it) => {
      const cgst = Number(it.M_CGST ?? 0);
      const sgst = Number(it.M_SGST ?? 0);
      const igst = Number(it.M_IGST ?? 0);
      const { cgstRate: cgstResolved, sgstRate: sgstResolved, igstRate: igstResolved, gstRate } =
        resolveLineGstSplit(cgst, sgst, igst, 0, isIntraState);
      const pendingQty = Number(it.PendingQty ?? it.Quantity ?? 1);
      const qty = pendingQty;
      const rate = 0;
      const taxAmount = (qty * rate * gstRate) / 100;
      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch =
        uoms.find(
          (u) =>
            (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) ||
            (uomNameNorm && u.name.toLowerCase() === uomNameNorm),
        ) ?? null;
      return {
        id: uid(),
        itemId: it.ItemId ?? "",
        itemName: it.ItemName ?? "",
        itemDescription: "",
        quantity: qty,
        uomId: uomMatch?.id ?? null,
        unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate,
        cgstRate: cgstResolved,
        sgstRate: sgstResolved,
        igstRate: igstResolved,
        gstRate,
        taxAmount,
        amount: qty * rate + taxAmount,
        mrItemId: it.MRItemId ?? null,
        mrPendingQty: pendingQty,
        mrSources: it.MRItemId ? [{ mrItemId: it.MRItemId, mrId: prefill.MRId, qty: pendingQty }] : undefined,
      };
    });
    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceMR({ id: prefill.MRId, docNo: prefill.DocNo });
    setMrDropdownError(null);
  };

  const handleMRDropdownSelect = async (mrId: string) => {
    setMrDropdownValue(mrId);
    if (!mrId) return;
    if (
      companies.length === 0 ||
      allProjects.length === 0 ||
      uoms.length === 0
    ) {
      setMrDropdownError("Master data still loading — please wait a moment.");
      return;
    }
    setMrDropdownLoading(true);
    setMrDropdownError(null);
    try {
      const prefill = await getMRPOPrefill(Number(mrId));
      applyMRPrefill(prefill);
      setViewMode("create");
    } catch (err: any) {
      setMrDropdownError(err.message ?? "Could not load Material Request.");
    } finally {
      setMrDropdownLoading(false);
    }
  };

  // ── More Material Requests on the same PO ────────────────────────────────
  // Only MRs of the PO's own company and project are offered. An item already on the PO (same item, same unit)
  // has the new MR's pending quantity added to its line; anything else becomes a new line.
  const { data: moreMRs = [], isLoading: moreMRsLoading } = useQuery({
    queryKey: ["approvedMRList", form.companyId, form.projectId],
    queryFn: () => getApprovedMRList({ companyId: String(form.companyId), projectId: String(form.projectId) }),
    enabled: viewMode === "create" && !!sourceMR && !!form.companyId && !!form.projectId,
    staleTime: 30_000,
  });
  const addableMRs = useMemo(
    () => moreMRs.filter((m) => !sourceMRs.some((s) => s.id === m.MRId)),
    [moreMRs, sourceMRs],
  );

  const lineSources = (li: POLineItem) =>
    li.mrSources?.length
      ? li.mrSources
      : li.mrItemId && sourceMR
        ? [{ mrItemId: li.mrItemId, mrId: sourceMR.id, qty: li.mrPendingQty ?? li.quantity }]
        : [];
  const reprice = (li: POLineItem): POLineItem => {
    const taxAmount = (li.quantity * li.rate * li.gstRate) / 100;
    return { ...li, taxAmount, amount: li.quantity * li.rate + taxAmount };
  };

  const addMR = async (mrId: string) => {
    setAddMrValue(mrId);
    if (!mrId) return;
    setAddMrLoading(true);
    try {
      const prefill = await getMRPOPrefill(Number(mrId));
      if (String(prefill.CompanyId) !== String(form.companyId) || String(prefill.ProjectId) !== String(form.projectId)) {
        toast.error(`${prefill.DocNo} is for a different company or project — only MRs of this PO's company and project can be combined.`);
        return;
      }
      const next = [...lineItems];
      let added = 0;
      for (const it of prefill.items) {
        const pending = Number(it.PendingQty ?? it.Quantity ?? 0);
        if (!it.MRItemId || pending <= 0) continue;
        const uom = uoms.find(
          (u) =>
            (it.UOMCode && u.code.toLowerCase() === String(it.UOMCode).trim().toLowerCase()) ||
            (it.UOMName && u.name.toLowerCase() === String(it.UOMName).trim().toLowerCase()),
        );
        const unit = uom?.name ?? it.UOMName ?? it.UOMCode ?? "";
        const src = { mrItemId: it.MRItemId, mrId: prefill.MRId, qty: pending };
        const at = next.findIndex(
          (l) => l.itemId && String(l.itemId) === String(it.ItemId) && l.unit.toLowerCase() === String(unit).toLowerCase() && lineSources(l).length > 0,
        );
        if (at >= 0) {
          const l = next[at];
          next[at] = reprice({
            ...l,
            quantity: l.quantity + pending,
            mrPendingQty: (l.mrPendingQty ?? l.quantity) + pending,
            mrSources: [...lineSources(l), src],
            mrItemId: null,
          });
        } else {
          const cgst = Number(it.M_CGST ?? 0);
          const sgst = Number(it.M_SGST ?? 0);
          const igst = Number(it.M_IGST ?? 0);
          const { cgstRate, sgstRate, igstRate, gstRate } = resolveLineGstSplit(cgst, sgst, igst, 0, isIntraState);
          next.push({
            id: uid(),
            itemId: it.ItemId ?? "",
            itemName: it.ItemName ?? "",
            itemDescription: "",
            quantity: pending,
            uomId: uom?.id ?? null,
            unit,
            rate: 0,
            cgstRate,
            sgstRate,
            igstRate,
            gstRate,
            taxAmount: 0,
            amount: 0,
            mrItemId: it.MRItemId,
            mrPendingQty: pending,
            mrSources: [src],
          });
        }
        added++;
      }
      if (!added) {
        toast.error(`${prefill.DocNo} has nothing left to order.`);
        return;
      }
      setLineItems(next.filter((l) => l.itemId || l.itemName));
      setSourceMRs((prev) => [...prev, { id: prefill.MRId, docNo: prefill.DocNo }]);
      toast.success(`${prefill.DocNo} added — its items are summed into this PO.`);
    } catch (err: any) {
      toast.error(err.message ?? "Could not load that Material Request.");
    } finally {
      setAddMrValue("");
      setAddMrLoading(false);
    }
  };

  // Takes an added MR back out: its share comes off each summed line; lines that came only from it go.
  const removeMR = (mrId: number) => {
    setLineItems((prev) =>
      prev.flatMap((l) => {
        const srcs = lineSources(l);
        const mine = srcs.filter((s) => s.mrId === mrId);
        if (!mine.length) return [l];
        const rest = srcs.filter((s) => s.mrId !== mrId);
        if (!rest.length) return [];
        const less = mine.reduce((a, s) => a + s.qty, 0);
        return [reprice({
          ...l,
          quantity: Math.max(0, l.quantity - less),
          mrPendingQty: rest.reduce((a, s) => a + s.qty, 0),
          mrSources: rest,
          mrItemId: rest.length === 1 ? rest[0].mrItemId : null,
        })];
      }),
    );
    setSourceMRs((prev) => prev.filter((m) => m.id !== mrId));
  };

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return listData;
    const q = searchQuery.toLowerCase();
    return listData.filter(
      (r) =>
        r.poNumber.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.companyName.toLowerCase().includes(q) ||
        r.projectName.toLowerCase().includes(q),
    );
  }, [listData, searchQuery]);

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: poApprovalTrails, isLoading: poApprovalTrailsLoading } = useApprovalTrailsBulk(
    "PurchaseOrders",
    filteredList.map((r: any) => r._id),
  );

  // Grouped by Project, same collapsible pattern Material Request's own
  // list uses — groups.set() on first appearance preserves the order rows
  // arrive in, and the list is already newest-first (server sort), so a
  // project's group lands wherever its most recently created PO would.
  const groupedByProject = useMemo(() => {
    const groups = new Map<string, { key: string; projectName: string | null; rows: any[] }>();
    for (const r of filteredList) {
      const key = r.projectName || "no-project";
      if (!groups.has(key)) {
        groups.set(key, { key, projectName: r.projectName || null, rows: [] });
      }
      groups.get(key)!.rows.push(r);
    }
    return Array.from(groups.values());
  }, [filteredList]);

  // Extracted from the DataTable JSX below so it can be rendered once per
  // project group instead of duplicated — not memoized since it was
  // recomputed every render as an inline literal before this too.
  const poColumns = [
    {
      id: "poNumber",
      accessorFn: (row: any) => row.poNumber || row.docNo,
      header: "PO No",
      size: 130,
      cell: ({ row }: any) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <span className="font-heading text-xs font-semibold text-foreground">
              {item.poNumber || item.docNo || "—"}
            </span>
            {item.poType === "WO_PO" && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[0.625rem] font-bold bg-card text-foreground border border-foreground/40">
                WO-PO
              </span>
            )}
            {item.poType === "Direct" && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[0.625rem] font-bold bg-card text-foreground border border-foreground/40">
                Direct
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "poDate",
      accessorKey: "poDate",
      header: "Date",
      size: 90,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm text-muted-foreground">{fmtDate(getValue() as string)}</span>
      ),
    },
    {
      id: "supplierName",
      accessorKey: "supplierName",
      header: "Supplier",
      size: 130,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm font-medium">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "companyName",
      accessorKey: "companyName",
      header: "Company",
      size: 120,
      meta: { className: "hidden md:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "projectName",
      accessorKey: "projectName",
      header: "Project / Site",
      size: 130,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "effectiveMRDocNo",
      accessorKey: "effectiveMRDocNo",
      header: "MR Ref",
      size: 100,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }: any) => {
        const v = getValue() as string | null;
        return v ? (
          <span className="inline-flex items-center px-1.5 py-0.5 text-[0.625rem] font-heading font-semibold bg-card text-foreground border border-foreground/40">
            {v}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "totalAmount",
      accessorKey: "totalAmount",
      header: "Amount",
      size: 100,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }: any) => (
        <span className="text-sm font-semibold">{fmt(getValue() as number)}</span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      size: 140,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }: any) => (
        <div className="flex flex-col items-start gap-1">
          <ApprovalStatusChain
            table="PurchaseOrders"
            recordId={row.original._id}
            fallback={<StatusChip status={row.original.status} />}
            preloaded={poApprovalTrails.get(String(row.original._id)) ?? null}
            preloadedLoading={poApprovalTrailsLoading}
          />
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      size: 120,
      cell: ({ row }: any) => {
        const item = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <ApprovalActions
              status={item.status}
              recordId={item._id}
              endpoint="/api/purchase-orders"
              submitOnly
              onSuccess={(action) => handleApprovalSuccess(item._id, action)}
            />
            <button data-row-view
              onClick={async () => {
                setViewingTab("details");
                try {
                  const full = await getPurchaseOrderById(item._id);
                  setViewingPO(full);
                } catch {
                  setViewingPO(item);
                }
              }}
              className="p-1 text-foreground hover:bg-primary/5 transition-colors"
              title="View details"
            >
              <Eye size={15} />
            </button>
            <button
              onClick={() => handleGeneratePdf(item)}
              className="p-1 text-foreground hover:bg-primary/5 transition-colors"
              title="Generate PDF"
            >
              <FileDown size={15} />
            </button>
            {rights.canDelete && (
              <button
                onClick={() => handleDelete(item._id)}
                className="p-1 text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete this order"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ] as ColumnDef<any, unknown>[];

  // ── Computed totals ───────────────────────────────────────────────────────
  const { subtotal, totalCgst, totalSgst, totalIgst, totalTax, grandTotal } =
    useMemo(() => {
      const sub = lineItems.reduce((s, li) => s + li.quantity * li.rate, 0);
      // A line is CGST+SGST when cgstRate or sgstRate > 0; otherwise IGST
      const cgst = lineItems.reduce((s, li) => {
        if (li.cgstRate <= 0) return s;
        return s + (li.quantity * li.rate * li.cgstRate) / 100;
      }, 0);
      const sgst = lineItems.reduce((s, li) => {
        if (li.sgstRate <= 0) return s;
        return s + (li.quantity * li.rate * li.sgstRate) / 100;
      }, 0);
      const igst = lineItems.reduce((s, li) => {
        if (li.cgstRate > 0 || li.sgstRate > 0) return s; // CGST+SGST item — no IGST
        return s + (li.quantity * li.rate * li.igstRate) / 100;
      }, 0);
      const tax = cgst + sgst + igst;
      return {
        subtotal: sub,
        totalCgst: cgst,
        totalSgst: sgst,
        totalIgst: igst,
        totalTax: tax,
        grandTotal: sub + tax,
      };
    }, [lineItems]);

  // Chain status — must be here (before any early returns) to satisfy Rules of Hooks
  const { status: poChainStatus, loading: poChainLoading } = usePOChainStatus(
    editingId ?? null,
  );

  // ── Doc number helpers ────────────────────────────────────────────────────
  const applyPoDocNumber = (docTypeId: number | null, docNo: string) => {
    setPoDocTypeId(docTypeId);
    poDocTypeIdRef.current = docTypeId;
    setPoDocNo(docNo);
    setForm((p) => ({ ...p, poNumber: docNo, docNo, docTypeId }));
    setPoFormPatchKey((c) => c + 1);
  };

  const refreshPoDocNumber = async (
    docTypeId: number | null = poDocTypeId,
    finYearOverride = selectedFinYear,
  ) => {
    if (!docTypeId) {
      applyPoDocNumber(null, "");
      return "";
    }
    const nextDocNo = await fetchNextDocNumber(
      docTypeId,
      finYearOverride || undefined,
    );
    applyPoDocNumber(docTypeId, nextDocNo);
    setDocRefreshTrigger((c) => c + 1);
    return nextDocNo;
  };

  // ── Auto-select WO_PO doc type when form is opened from a Work Order ─────
  useEffect(() => {
    if (!sourceWO || poDocTypeIdRef.current) return; // already selected or not a WO-sourced form
    fetchDocTypes("WO_PO").then(async (docTypes) => {
      // Lock to the doc type whose Prefix is "WO-PO" (dash, as seeded in TypeOfDoc)
      // Fall back to "WO_PO" (underscore) for legacy installs
      const woPo =
        docTypes.find((d) => d.Prefix === "WO-PO") ??
        docTypes.find((d) => d.Prefix === "WO_PO");
      if (!woPo) return;
      const nextDocNo = await fetchNextDocNumber(
        woPo.TypeOfDocId,
        selectedFinYear || undefined,
      );
      applyPoDocNumber(woPo.TypeOfDocId, nextDocNo);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceWO, selectedFinYear]);

  // ── Auto-switch doc type: QPO (from a quotation), PO (MR/Sale Invoice), DPO (Direct) ───
  useEffect(() => {
    if (viewMode !== "create" || sourceWO) return; // WO has its own effect
    const hasMROrSI = !!(sourceMR || sourceSaleInvoice);
    // A quotation-sourced PO stays QPO even when the quotation came from an MR.
    const targetPrefix = sourceQT || qtPrefill ? "QPO" : hasMROrSI ? "PO" : "DPO";
    const target = poDocTypes.find(
      (dt) => (dt.DocNoPrefix ?? dt.Prefix) === targetPrefix,
    );
    if (!target) return;
    // Use ref to avoid stale closure on poDocTypeId
    if (poDocTypeIdRef.current === target.TypeOfDocId) return;
    fetchNextDocNumber(target.TypeOfDocId, selectedFinYear || undefined).then(
      (docNo) => applyPoDocNumber(target.TypeOfDocId, docNo),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMR, sourceSaleInvoice, sourceWO, sourceQT, qtPrefill, viewMode, poDocTypes]);

  // ── Line item helpers ─────────────────────────────────────────────────────
  const updateLine = (idx: number, patch: Partial<POLineItem>) => {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== idx) return li;
        const updated = { ...li, ...patch };
        const baseAmount = updated.quantity * updated.rate;
        // Recalculate gstRate from whichever split is active
        if (
          patch.igstRate !== undefined ||
          patch.cgstRate !== undefined ||
          patch.sgstRate !== undefined
        ) {
          updated.gstRate =
            updated.cgstRate > 0 || updated.sgstRate > 0
              ? updated.cgstRate + updated.sgstRate
              : updated.igstRate;
        }
        updated.taxAmount = (baseAmount * updated.gstRate) / 100;
        updated.amount = baseAmount + updated.taxAmount;
        return updated;
      }),
    );
  };

  // Lines can arrive with GST already on them (MR/WO/WD-sourced lines are
  // filled in bulk, and the supplier can be picked after items are added) —
  // handleItemSelect's own gate only covers hand-picked items. Zero GST on
  // every line whenever the chosen supplier is non-GST, in create/edit only.
  useEffect(() => {
    if (supplierIsGstRegistered) return;
    if (viewMode !== "create" && viewMode !== "edit") return;
    setLineItems((prev) => {
      if (!prev.some((li) => li.gstRate > 0 || li.taxAmount > 0)) return prev;
      return prev.map((li) => ({
        ...li,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
        gstRate: 0,
        taxAmount: 0,
        amount: li.quantity * li.rate,
      }));
    });
  }, [supplierIsGstRegistered, viewMode, lineItems]);

  const addLine = () => setLineItems((p) => [...p, EMPTY_LINE()]);

  const removeLine = (idx: number) => {
    if (lineItems.length === 1) return;
    setLineItems((p) => p.filter((_, i) => i !== idx));
  };

  const handleItemSelect = (idx: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const itemUomNorm = item.uom.trim().toLowerCase();
    const uomMatch = uoms.find(
      (u) =>
        u.code.toLowerCase() === itemUomNorm ||
        u.name.toLowerCase() === itemUomNorm,
    );
    // Items are tagged with CGST, SGST, and IGST rates all at once — which
    // one actually applies depends on whether the supplier and the ordering
    // company are in the same GST state (isIntraState, computed above from
    // supplierDetails.LGSTState vs companyDetails.state). Same state →
    // CGST+SGST; different state → IGST. This is why the identical item can
    // price out differently on two POs raised against two different-state
    // suppliers.
    // Skip the HSN/item-master GST rate entirely for a non-GST supplier —
    // see supplierIsGstRegistered above.
    const { cgstRate, sgstRate, igstRate, gstRate } = supplierIsGstRegistered
      ? resolveLineGstSplit(
          Number(item.cgst ?? 0),
          Number(item.sgst ?? 0),
          Number(item.igst ?? 0),
          item.resolvedGstRate ?? 0,
          isIntraState,
        )
      : { cgstRate: 0, sgstRate: 0, igstRate: 0, gstRate: 0 };

    updateLine(idx, {
      itemId,
      itemName: item.name,
      itemDescription: item.description,
      uomId: uomMatch?.id ?? null,
      unit: uomMatch?.name ?? item.uom,
      cgstRate,
      sgstRate,
      igstRate,
      gstRate,
      // Cost Centre is per-line, not per-PO — a single PO can legitimately
      // mix a fixed-asset item with a consumption item, each keeping its
      // own Item Master cost centre tag. GRN/Invoice GL posting resolves
      // this per line (by ItemId) to build a cost-centre-wise breakdown.
      costCenterId: item.costCenterId || "",
    });

    // Also mirror it onto the legacy PO-header field (first-tagged-item-
    // wins) purely for old code paths that still read form.costCenterId —
    // the real per-line value above is what GL posting actually uses now.
    if (item.costCenterId && !form.costCenterId) {
      setField("costCenterId", item.costCenterId);
    }
  };

  // ── Form helpers ──────────────────────────────────────────────────────────
  const setField = <K extends keyof POForm>(key: K, value: POForm[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    const hasBackendNumbering =
      viewMode === "create" && !!(form.docTypeId ?? poDocTypeId);
    if (!form.poNumber && !hasBackendNumbering) e.poNumber = true;
    if (!form.poDate) e.poDate = true;
    if (!form.supplierId) e.supplierId = true;
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (lineItems.every((li) => !li.itemName && !li.quantity))
      e.lineItems = true;
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Please fill in all required fields.");
      return false;
    }
    if (supplierDeviations.length && !supplierChangeReason.trim()) {
      setErrors({ supplierChangeReason: true });
      toast.error("Give a reason for choosing a supplier other than the L1.");
      return false;
    }

    // MR-sourced lines can't exceed what's still pending on that MR item —
    // a repeat PO off the same MR must stay within the remaining balance.
    const overCap = lineItems.find(
      (li) =>
        (li.mrItemId != null || !!li.mrSources?.length) &&
        li.mrPendingQty != null &&
        li.quantity - li.mrPendingQty > 0.0001,
    );
    if (overCap) {
      toast.error(
        `"${overCap.itemName}" exceeds the pending Material Request quantity (max ${overCap.mrPendingQty}).`,
      );
      return false;
    }

    // A PO must be all-Goods or all-Service — never a mix. Goods items
    // always have to be received via a GRN before they can be invoiced;
    // Service items can be invoiced directly with no GRN (see the
    // "service-eligible" PO endpoint used for direct/TOD invoicing).
    // Mixing the two on one PO would make that invoice-eligibility
    // ambiguous per line, so a Material Request containing both — e.g.
    // Cement + Sand (Goods) and Plastering (Service) — must be split into
    // separate POs by item type: one PO for the Goods items and another
    // for the Service items (or further split however's convenient), but
    // never one PO combining Cement/Sand with Plastering. The MR → PO →
    // GRN/WO → Invoice → Payment chain still tracks each split PO on its
    // own, same as any other PO.
    if (hasMixedItemTypes) {
      toast.error(
        "This PO mixes Goods and Service items. Create separate POs — one for the Goods items (they'll need a GRN) and another for the Service items (can be invoiced directly).",
      );
      return false;
    }

    return true;
  };

  const toPayload = () => {
    const supplier = suppliers.find((s) => s.id === form.supplierId);
    const company = companies.find((c) => c.id === form.companyId);
    const project = allProjects.find((p) => p.id === form.projectId);
    const validItems = lineItems.filter((li) => li.itemName || li.quantity > 0);
    const docTypeId = form.docTypeId ?? poDocTypeId;
    const backendNumbered = viewMode === "create" && !!docTypeId;
    return {
      PurchaseOrderNo: backendNumbered ? null : form.poNumber || null,
      PODate: form.poDate || null,
      ExpectedDeliveryDate: form.expectedDate || null,
      SupplierID: supplier ? Number(supplier.id) : null,
      CompanyId: company ? Number(company.id) : null,
      ProjectId: project ? Number(project.id) : null,
      ItemDescription: validItems.map((li) => li.itemName).join(", ") || null,
      Quantity: validItems.reduce((s, li) => s + li.quantity, 0),
      Unit: validItems[0]?.unit || null,
      Rate: validItems[0]?.rate || 0,
      TotalAmount: grandTotal,
      POItems: validItems.map((li) => ({
        itemId: li.itemId || null,
        itemDescription: li.itemName,
        description: li.itemDescription || null,
        unit: li.unit,
        uomId: li.uomId ?? null,
        quantity: li.quantity,
        rate: li.rate,
        tax: li.gstRate,
        cgstRate: li.cgstRate,
        sgstRate: li.sgstRate,
        igstRate: li.igstRate,
        gstType: li.igstRate > 0 ? "igst" : "cgst_sgst",
        amount: li.amount,
        mrItemId: li.mrItemId ?? null,
        // Several MR lines summed into this one — the server splits the quantity across them.
        mrSources: li.mrSources?.length ? li.mrSources.map((s) => ({ mrItemId: s.mrItemId, qty: s.qty })) : undefined,
        costCenterId: li.costCenterId || null,
      })),
      PaymentTerms:
        selectedTCs.length > 0
          ? selectedTCs.map((tc) => `${tc.name}: ${tc.terms}`).join("\n\n")
          : form.paymentTerms || null,
      Status:
        viewMode === "edit"
          ? (listData.find((r) => r._id === editingId)?.status ?? "Draft")
          : "Pending", // creation always auto-submits; backend ignores this field on create anyway
      Remarks: form.remarks || null,
      CostCenterId: form.costCenterId ? parseInt(form.costCenterId, 10) : null,
      PaymentTermId: form.paymentTermId ? parseInt(form.paymentTermId, 10) : null,
      DocTypeId: docTypeId,
      DocNo: backendNumbered
        ? null
        : form.poNumber || form.docNo || poDocNo || null,
      finYear: selectedFinYear || null,
      // Source tracking
      SourceMRId: sourceMR?.id ?? null,
      SourceMRDocNo: sourceMR?.docNo ?? null,
      SourceMRIds: sourceMRs.map((m) => m.id),
      SourceQTId: sourceQT?.id ?? null,
      SourceQTDocNo: sourceQT?.docNo ?? null,
      SupplierChangeReason: supplierChangeReason.trim() || null,
      SourceWDId: sourceWD?.id ?? null,
      SourceWDDocNo: sourceWD?.docNo ?? null,
      SourceWOId: sourceWO?.id ?? null,
      SourceWODocNo: sourceWO?.docNo ?? null,
      SourceSaleOrderId: null,
      SourceSaleOrderDocNo: null,
      SourceSaleInvoiceId: sourceSaleInvoice?.id ?? null,
      SourceSaleInvoiceDocNo: sourceSaleInvoice?.docNo ?? null,
      POType: (sourceQT
        ? "QPO"
        : sourceMR
          ? "Normal"
          : sourceWD || sourceWO
            ? "WO_PO"
            : "Direct") as "Normal" | "WO_PO" | "Direct" | "QPO",
    };
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // validate() already shows its own specific toast for whichever check
    // failed (missing fields vs. over the MR-pending cap) — don't stack a
    // second, generic one on top.
    if (!validate()) return;
    setSaving(true);
    try {
      if (viewMode === "create") {
        const created = await addPurchaseOrder(toPayload());
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        if (created?.PurchaseOrderNo) {
          setForm((p) => ({
            ...p,
            poNumber: created.PurchaseOrderNo,
            docNo: created.PurchaseOrderNo,
          }));
          setPoDocNo(created.PurchaseOrderNo);
        }
        toast.success("Purchase Order created and sent for approval!");
        const savedDocTypeId = form.docTypeId ?? poDocTypeId;
        await refreshPoDocNumber(savedDocTypeId);
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          goToList();
        }, 1200);
      } else if (viewMode === "edit" && editingId) {
        await updatePurchaseOrder(editingId, toPayload());
        await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
        toast.success("Purchase Order updated successfully!");
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          goToList();
        }, 1200);
      }
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/purchase-orders/${id}/can-delete`);
      const data = await res.json();
      if (!data.deletable) {
        setDeleteBlockInfo(data);
        return;
      }
      setDeleteConfirmId(id);
    } catch (err: any) {
      toast.error(`Check failed: ${err.message}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deletePurchaseOrder(deleteConfirmId);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase Order deleted.");
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleApprovalSuccess = async (
    recordId?: string,
    action?: "submit" | "approve" | "reject",
  ) => {
    // Optimistically update the cached row status so the UI reflects
    // the change immediately without waiting for the refetch round-trip.
    if (recordId && action) {
      const nextStatus =
        action === "submit"
          ? "Pending"
          : action === "approve"
            ? "Approved"
            : "Rejected";

      queryClient.setQueriesData<any>(
        { queryKey: ["purchase-orders"] },
        (old: any) => {
          if (!old) return old;
          // handle both raw-array and { data: [] } response shapes
          const rows: any[] = Array.isArray(old) ? old : (old?.data ?? []);
          const updated = rows.map((row: any) =>
            String(row.PurchaseOrderID) === recordId
              ? { ...row, Status: nextStatus }
              : row,
          );
          return Array.isArray(old) ? updated : { ...old, data: updated };
        },
      );
    }

    // Small delay to let the server-side cache version bump propagate
    // across workers before the refetch hits Redis.
    await new Promise((r) => setTimeout(r, 400));
    // Then invalidate so the server state syncs in the background.
    await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  // ── Auto-fetch supplier details on supplierId change ────────────────────
  useEffect(() => {
    if (!form.supplierId) {
      setSupplierDetails(null);
      return;
    }
    getSupplierDetails(form.supplierId).then(setSupplierDetails);
  }, [form.supplierId]);

  // ── Auto-fetch company details on companyId change ────────────────────────
  useEffect(() => {
    if (!form.companyId) {
      setCompanyDetails(null);
      return;
    }
    getCompanyDetails(form.companyId).then(setCompanyDetails);
  }, [form.companyId]);

  // ── Auto-fetch project details on projectId change (delivery address) ─────
  useEffect(() => {
    if (!form.projectId) {
      setProjectDetails(null);
      return;
    }
    getCompanyDetails(form.projectId).then(setProjectDetails);
  }, [form.projectId]);

  // ── Print from preview modal ──────────────────────────────────────────────
  // Print uses the shared letterhead layout (see purchaseOrderDocument.ts) —
  // the same document Generate PDF downloads, so the two always match.
  const handlePrintFromPreview = () => {
    if (!viewingPO) return;
    void printPurchaseOrder(viewingPO);
  };

  // Downloads the PO as a .pdf in the shared letterhead layout. `poIn` is
  // whatever triggered this — a grid row (list query, no LineItems) or the
  // already-fully-loaded preview panel (viewingPO, has LineItems/POItems) — so
  // it refetches the full record when LineItems/POItems isn't already present,
  // the same way the Eye/view click does; otherwise Order Items would be
  // silently missing from a PDF generated straight from the grid.
  const handleGeneratePdf = async (poIn: any) => {
    const toastId = toast.loading("Generating PDF...");
    try {
      let po = poIn;
      const id = poIn._id ?? poIn.PurchaseOrderID ?? poIn.purchaseOrderId;
      if (!Array.isArray(poIn.LineItems) && !Array.isArray(poIn.POItems) && id) {
        try {
          po = await getPurchaseOrderById(id);
        } catch {
          // fall back to whatever was passed in — PDF still generates,
          // just without the items.
        }
      }
      const poNumber = po.PurchaseOrderNo ?? po.poNumber ?? "purchase-order";
      await downloadPurchaseOrderPdf(po, `${String(poNumber).replace(/[^\w-]+/g, "_")}.pdf`);
      toast.success("PDF downloaded", { id: toastId });
    } catch {
      toast.error("Could not generate PDF", { id: toastId });
    }
  };

  // ── Auto-fetch details for preview pop-out ────────────────────────────────
  useEffect(() => {
    if (!viewingPO) {
      setViewingPOSupplier(null);
      setViewingPOCompany(null);
      setViewingPOProject(null);
      return;
    }
    const suppId = viewingPO.SupplierID ?? viewingPO.supplierId;
    const compId = viewingPO.CompanyID ?? viewingPO.companyId;
    const projId = viewingPO.ProjectID ?? viewingPO.projectId;
    if (suppId)
      getSupplierDetails(suppId)
        .then(setViewingPOSupplier)
        .catch(() => {});
    if (compId)
      getCompanyDetails(compId)
        .then(setViewingPOCompany)
        .catch(() => {});
    if (projId)
      getCompanyDetails(projId)
        .then(setViewingPOProject)
        .catch(() => {});
  }, [viewingPO]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setSelectedTCs([]);
    setErrors({});
    setSourceMR(null);
    setSourceWD(null);
    setSourceWO(null);
    setSourceSaleInvoice(null);
    setSaleInvoiceInput("");
    setSupplierDetails(null);
    setCompanyDetails(null);
    setProjectDetails(null);
    setMrDropdownValue("");
    setMrDropdownError(null);
  };

  const goToCreate = () => {
    setForm(EMPTY_FORM());
    setLineItems([EMPTY_LINE()]);
    setSelectedTCs([]);
    setErrors({});
    setSourceMR(null);
    setSourceWD(null);
    setSourceWO(null);
    setSourceSaleInvoice(null);
    setSaleInvoiceInput("");
    setSupplierDetails(null);
    setCompanyDetails(null);
    setMrDropdownValue("");
    setMrDropdownError(null);
    setSupplierChangeReason("");
    setOriginalSupplierId(null);
    setViewMode("create");
  };

  const goToEdit = async (item: POListItem) => {
    // Always fetch the full PO — list rows don't include POItems or DocTypeId
    let raw: any =
      dbItems.find((d) => String(d.PurchaseOrderID) === item._id) ?? {};
    try {
      const full = await getPurchaseOrderById(item._id);
      if (full) raw = full;
    } catch {
      // fall back to list-row data
    }

    const supplier = suppliers.find(
      (s) =>
        s.id === String(raw.SupplierID ?? "") || s.name === item.supplierName,
    );
    const company = companies.find(
      (c) =>
        c.id === String(raw.CompanyId ?? "") || c.name === item.companyName,
    );
    const project = allProjects.find(
      (p) =>
        p.id === String(raw.ProjectId ?? "") || p.name === item.projectName,
    );

    const docTypeId: number | null = raw.DocTypeId ?? null;
    const docNo: string = raw.DocNo ?? raw.PurchaseOrderNo ?? "";

    // Restore doc type + doc number state so DocNumberPreview renders correctly
    setPoDocTypeId(docTypeId);
    setPoDocNo(docNo);

    setSupplierChangeReason(raw.SupplierChangeReason ?? "");
    setOriginalSupplierId(supplier?.id ?? String(raw.SupplierID ?? ""));
    setForm({
      poNumber: raw.PurchaseOrderNo ?? "",
      poDate: raw.PODate ? raw.PODate.slice(0, 10) : "",
      expectedDate: raw.ExpectedDeliveryDate
        ? raw.ExpectedDeliveryDate.slice(0, 10)
        : "",
      supplierId: supplier?.id ?? String(raw.SupplierID ?? ""),
      companyId: company?.id ?? String(raw.CompanyId ?? ""),
      projectId: project?.id ?? String(raw.ProjectId ?? ""),
      paymentTerms: raw.PaymentTerms ?? "",
      remarks: raw.Remarks ?? "",
      docTypeId,
      docNo,
      status: raw.Status ?? "Draft",
      costCenterId: String(raw.CostCenterId ?? ""),
      paymentTermId: String(raw.PaymentTermId ?? ""),
    });

    // Restore line items from POItems (full record) or legacy fields
    const poItems: any[] = Array.isArray(raw.POItems)
      ? raw.POItems
      : Array.isArray(raw.LineItems)
        ? raw.LineItems
        : [];

    // Snapshot items at call time — avoids stale closure issues
    const itemsSnapshot = items;

    if (poItems.length > 0) {
      setLineItems(
        poItems.map((pi: any) => {
          const qty = Number(pi.quantity ?? pi.Quantity ?? 0);
          const rate = Number(pi.rate ?? pi.Rate ?? 0);
          const totalTaxRate = Number(pi.tax ?? pi.Tax ?? 0);

          // Priority 1: use stored split fields (saved by toPayload)
          const storedCgst = Number(pi.cgstRate ?? 0);
          const storedSgst = Number(pi.sgstRate ?? 0);
          const storedIgst = Number(pi.igstRate ?? 0);

          let resolvedCgst = 0,
            resolvedSgst = 0,
            resolvedIgst = 0;

          if (storedCgst > 0 || storedSgst > 0) {
            resolvedCgst = storedCgst;
            resolvedSgst = storedSgst;
          } else if (storedIgst > 0) {
            resolvedIgst = storedIgst;
          } else {
            // Priority 2: legacy record — derive from item master
            const itemId = String(pi.itemId ?? pi.ItemId ?? "");
            const masterItem = itemId
              ? itemsSnapshot.find((it) => String(it.id) === itemId)
              : null;
            if (masterItem) {
              const mc = Number(masterItem.cgst ?? 0);
              const ms = Number(masterItem.sgst ?? 0);
              const mi = Number(masterItem.igst ?? 0);
              if (mc > 0 || ms > 0) {
                resolvedCgst = mc;
                resolvedSgst = ms;
              } else {
                resolvedIgst = mi;
              }
            } else {
              resolvedIgst = totalTaxRate;
            }
          }

          const gstRate =
            resolvedCgst > 0 || resolvedSgst > 0
              ? resolvedCgst + resolvedSgst
              : resolvedIgst;
          const taxAmount = (qty * rate * gstRate) / 100;
          const unitStr = (pi.unit ?? pi.UomName ?? "").trim().toLowerCase();
          const uomMatch = uoms.find(
            (u) =>
              u.code.toLowerCase() === unitStr ||
              u.name.toLowerCase() === unitStr,
          );
          return {
            id: uid(),
            itemId: pi.itemId ?? pi.ItemId ?? "",
            itemName: pi.itemDescription ?? pi.ItemName ?? pi.Description ?? "",
            itemDescription: pi.description ?? pi.ItemDescription ?? "",
            quantity: qty,
            uomId: uomMatch?.id ?? null,
            unit: uomMatch?.name ?? pi.unit ?? pi.UomName ?? "",
            rate,
            cgstRate: resolvedCgst,
            sgstRate: resolvedSgst,
            igstRate: resolvedIgst,
            gstRate,
            taxAmount,
            amount: qty * rate + taxAmount,
            costCenterId: pi.costCenterId ? String(pi.costCenterId) : (pi.CostCenterId ? String(pi.CostCenterId) : ""),
            // Kept so saving an edit doesn't cut the line off from its Material Request(s).
            mrItemId: pi.mrItemId ?? pi.MRItemId ?? null,
            mrSources: Array.isArray(pi.mrSources) && pi.mrSources.length ? pi.mrSources : undefined,
          };
        }),
      );
    } else {
      const qty = Number(raw.Quantity ?? 0);
      const rate = Number(raw.Rate ?? 0);
      setLineItems([
        {
          id: uid(),
          itemId: "",
          itemName: raw.ItemDescription ?? "",
          itemDescription: "",
          quantity: qty,
          uomId: null,
          unit: raw.Unit ?? "",
          rate,
          cgstRate: 0,
          sgstRate: 0,
          igstRate: 0,
          gstRate: 0,
          taxAmount: 0,
          amount: qty * rate,
        },
      ]);
    }

    setEditingId(item._id);
    setSelectedTCs([]);
    setViewMode("edit");
    // Explicitly fetch details here too, so view mode always has fresh data
    // regardless of whether supplierId/companyId changed from prior state.
    const resolvedSupplierId = supplier?.id ?? String(raw.SupplierID ?? "");
    const resolvedCompanyId = company?.id ?? String(raw.CompanyId ?? "");
    const resolvedProjectId = project?.id ?? String(raw.ProjectId ?? "");
    if (resolvedSupplierId)
      getSupplierDetails(resolvedSupplierId).then(setSupplierDetails);
    else setSupplierDetails(null);
    if (resolvedCompanyId)
      getCompanyDetails(resolvedCompanyId).then(setCompanyDetails);
    else setCompanyDetails(null);
    if (resolvedProjectId)
      getCompanyDetails(resolvedProjectId).then(setProjectDetails);
    else setProjectDetails(null);
  };

  const goToView = async (item: POListItem) => {
    await goToEdit(item);
    setViewMode("view");
  };

  // Deep-link support — Linked Documents panels navigate here as
  // /material/purchase-order?view=<PurchaseOrderID> to open this exact PO.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    goToView({ _id: viewId } as POListItem);
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("view")]);

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], PO_TEMPLATE_COLUMNS, "purchase-order-template");
  };
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };
  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        toast.error("CSV is empty");
        return;
      }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };


  const isReadOnly = viewMode === "view";

  // The base rate each item was last ordered at from this supplier (any earlier PO, direct or MR-tagged) — shown
  // beside the line's rate so a changed price is noticed. Keyed by item id.
  const lastRateItemIds = useMemo(
    () => [...new Set(lineItems.map((l) => l.itemId).filter(Boolean))].sort(),
    [lineItems],
  );
  const { data: lastRates = {} } = useQuery<Record<string, LastRate>>({
    queryKey: ["po-last-rates", form.supplierId, lastRateItemIds.join(","), editingId],
    enabled: !!form.supplierId && lastRateItemIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ supplierId: String(form.supplierId), itemIds: lastRateItemIds.join(",") });
      if (editingId) qs.set("excludeId", String(editingId));
      const r = await fetchWithAuth(`/api/purchase-orders/last-rates?${qs}`);
      if (!r.ok) return {};
      const rows: LastRate[] = await r.json().catch(() => []);
      return Object.fromEntries(rows.map((x) => [String(x.ItemId).toLowerCase(), x]));
    },
  });

  // The MR's quotation(s) whose L1 supplier isn't the one chosen — asks for a reason (POHeaderDetails).
  const l1MrIds = [...new Set([sourceMR?.id, ...sourceMRs.map((x) => x.id)].filter((x): x is number => x != null))];
  const l1CheckOn =
    (viewMode === "create" || viewMode === "edit") &&
    !!form.supplierId &&
    (viewMode === "create" ? l1MrIds.length > 0 || !!sourceQT : form.supplierId !== originalSupplierId);
  const { data: l1Deviations = [] } = useQuery<L1Deviation[]>({
    queryKey: ["po-l1-check", form.supplierId, l1MrIds.join(","), sourceQT?.id ?? null, viewMode === "edit" ? editingId : null],
    enabled: l1CheckOn,
    staleTime: 30_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ supplierId: String(form.supplierId), mrIds: l1MrIds.join(",") });
      if (sourceQT) qs.set("qtId", String(sourceQT.id));
      if (viewMode === "edit" && editingId) qs.set("excludeId", String(editingId));
      const r = await fetchWithAuth(`/api/purchase-orders/l1-check?${qs}`);
      if (!r.ok) return [];
      return r.json().catch(() => []);
    },
  });
  const supplierDeviations = l1CheckOn ? l1Deviations : [];

  // Opened from the Material dashboard: back to that list once the record is closed.
  useReturnAfterView(viewMode !== "list");

  return {
    supplierDeviations,
    supplierChangeReason,
    setSupplierChangeReason,
    lastRates,
    importFileInputRef,
    importing,
    setImporting,
    rights,
    queryClient,
    location,
    navigate,
    searchParams,
    setSearchParams,
    finYears,
    mrPrefill,
    wdPrefill,
    woPrefill,
    qtPrefill,
    viewMode,
    setViewMode,
    editingId,
    setEditingId,
    viewingPO,
    setViewingPO,
    viewingPOSupplier,
    setViewingPOSupplier,
    viewingPOCompany,
    setViewingPOCompany,
    viewingPOProject,
    setViewingPOProject,
    viewingTab,
    setViewingTab,
    currentUser,
    page,
    setPage,
    limit,
    poTypeFilter,
    setPoTypeFilter,
    collapsedProjectGroups,
    setCollapsedProjectGroups,
    projectFilter,
    setProjectFilter,
    poDocTypeId,
    setPoDocTypeId,
    poDocTypeIdRef,
    poDocNo,
    setPoDocNo,
    setPoFormPatchKey,
    setDocRefreshTrigger,
    poDocTypes,
    setPoDocTypes,
    poDocTypesLoading,
    setPoDocTypesLoading,
    activeFinYear,
    finYearOptions,
    selectedFinYear,
    setSelectedFinYear,
    form,
    setForm,
    lineItems,
    setLineItems,
    errors,
    setErrors,
    saving,
    setSaving,
    saved,
    setSaved,
    deleteBlockInfo,
    setDeleteBlockInfo,
    deleteConfirmId,
    setDeleteConfirmId,
    searchQuery,
    setSearchQuery,
    selectedTCs,
    setSelectedTCs,
    tcDropdownOpen,
    setTcDropdownOpen,
    sourceMR,
    setSourceMR,
    sourceMRs,
    addableMRs,
    moreMRsLoading,
    addMrValue,
    addMrLoading,
    addMR,
    removeMR,
    sourceQT,
    setSourceQT,
    mrDropdownValue,
    setMrDropdownValue,
    mrDropdownLoading,
    setMrDropdownLoading,
    mrDropdownError,
    setMrDropdownError,
    mrFilterCompanyId,
    setMrFilterCompanyId,
    mrFilterProjectId,
    setMrFilterProjectId,
    sourceWD,
    setSourceWD,
    sourceWO,
    setSourceWO,
    sourceSaleInvoice,
    setSourceSaleInvoice,
    saleInvoiceInput,
    setSaleInvoiceInput,
    supplierDetails,
    setSupplierDetails,
    companyDetails,
    setCompanyDetails,
    normalizeState,
    isIntraState,
    supplierIsGstRegistered,
    projectDetails,
    setProjectDetails,
    approvedMRs,
    approvedMRsLoading,
    dbData,
    isLoading,
    suppliersRaw,
    companiesRaw,
    projectsRaw,
    uomsRaw,
    itemUomAlternates,
    itemsRaw,
    itemsGstRaw,
    tcRaw,
    enterprisesRaw,
    paymentTerms,
    suppliers,
    companies,
    allProjects,
    filteredMRProjects,
    filteredFormProjects,
    uoms,
    itemsGstById,
    items,
    itemTypesInCart,
    hasMixedItemTypes,
    maxDaysOfSupply,
    minExpectedDate,
    availableSupplyDays,
    selectedItemIds,
    pickableItems,
    tcRecords,
    enterpriseLogo,
    activeLogo,
    handlePrint,
    dbItems,
    totalPages,
    totalRecords,
    listData,
    applyMRPrefill,
    handleMRDropdownSelect,
    filteredList,
    poApprovalTrails,
    poApprovalTrailsLoading,
    groupedByProject,
    poColumns,
    subtotal,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    grandTotal,
    poChainStatus,
    poChainLoading,
    applyPoDocNumber,
    refreshPoDocNumber,
    updateLine,
    addLine,
    removeLine,
    handleItemSelect,
    setField,
    validate,
    toPayload,
    handleSave,
    handleDelete,
    confirmDelete,
    handleApprovalSuccess,
    handlePrintFromPreview,
    handleGeneratePdf,
    goToList,
    goToCreate,
    goToEdit,
    goToView,
    handleDownloadTemplate,
    handleImportClick,
    handleImportFileChange,
    isReadOnly,
  };
}

export type POState = ReturnType<typeof usePurchaseOrder>;
