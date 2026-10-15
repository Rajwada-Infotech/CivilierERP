// Everything the Vehicle In/Out page holds: master data, the list, the form, the
// PO link, attachments and camera, print and the mutations. The page and its parts
// read from this one object.
import * as vehApi from "@/api/vehicleInOutApi";
import React, { useRef, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Webcam from "react-webcam";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { Camera, Upload } from "lucide-react";
import { printVehicleInOut, downloadVehicleInOutPdf } from "@/utils/vehicleInOutDocument";
import { exportToCsv, parseCsv } from "@/lib/export";
import { type VehicleInOutPayload } from "@/api/vehicleInOutApi";
import { createQualityDebitNote } from "@/api/qualityRejectionDebitNoteApi";
import { usePageRights } from "@/hooks/usePageRights";
import { VEH_TEMPLATE_COLUMNS, toUtcDateTimeInput, buildEmpty, bridge } from "./config";

export function useVehicleInOut() {
  const rights = usePageRights("vehicle-in-out");
  bridge.canEdit = rights.canEdit;
  bridge.canDelete = rights.canDelete;
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const { currentUser } = useAuth();

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year ||
    [...finYears].sort((a, b) => b.year.localeCompare(a.year))[0]?.year ||
    "";

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRec, setViewingRec] = useState<any | null>(null);
  const [viewTab, setViewTab] = useState<"details" | "supplier">("details");
  const [showPODetails, setShowPODetails] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filterFY, setFilterFY] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">(
    "environment",
  );
  const webcamRef = useRef<Webcam>(null);

  // Received qty entered in THIS lot, keyed by PO line item id. Reset when
  // the PO changes; prefilled from the record's own saved items on edit.
  const [receivedQtyByItem, setReceivedQtyByItem] = useState<Record<number, string>>({});

  // Real-time photo captured beside "Qty This Lot", keyed by PO line item
  // id — base64 data URL, sent as part of that item's line on save (stored
  // directly on VehicleInOutItems.PhotoBase64, not through the binary
  // header-level Attachments pipeline). Reset/prefilled alongside
  // receivedQtyByItem everywhere that resets. capturingPoItemId tracks
  // which item's camera button opened the shared capture modal below —
  // null means the modal is being used for the general vehicle/plate photo
  // instead (its original purpose).
  const [photoByItem, setPhotoByItem] = useState<Record<number, string>>({});
  const [capturingPoItemId, setCapturingPoItemId] = useState<number | null>(null);

  // Quick inspection grade per PO line item, keyed the same way as
  // receivedQtyByItem/photoByItem — reset/prefilled alongside them
  // everywhere those are.
  const [qualityByItem, setQualityByItem] = useState<
    Record<number, vehApi.VehicleInOutItemQuality | "">
  >({});

  // Optional free-text brand per PO line item, keyed the same way as
  // receivedQtyByItem/photoByItem/qualityByItem — reset/prefilled alongside
  // them everywhere those are. Not mandatory.
  const [brandByItem, setBrandByItem] = useState<Record<number, string>>({});

  // Quality-rejection debit note modal — raised against a single received
  // line item (VehicleInOutItemID) from the view modal.
  const [debitNoteItem, setDebitNoteItem] = useState<any>(null);
  const [debitNoteQty, setDebitNoteQty] = useState("");
  const [debitNoteReason, setDebitNoteReason] = useState("");

  const [form, setForm] = useState(buildEmpty(activeFinYear));
  const pf = (patch: Partial<typeof form>) =>
    setForm((p) => ({ ...p, ...patch }));

  // ── Queries ──────────────────────────────────────────────────────────────────
  const {
    data: listPage,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["vehicle-in-out", page, filterFY],
    queryFn: () =>
      vehApi.getVehicleInOuts({
        page,
        limit: 15,
        finYear: filterFY || undefined,
      }),
    placeholderData: (prev) => prev,
  });
  const records = listPage?.data ?? [];
  const totalPages = listPage?.totalPages ?? 1;
  const total = listPage?.total ?? 0;

  const { data: docNoPreview, isFetching: loadingPreview } = useQuery({
    queryKey: ["vehicle-in-out", "next-number"],
    queryFn: vehApi.previewNextVEHNumber,
    enabled: !editingId,
    staleTime: 15_000,
  });

  // Companies from enterprise
  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-companies"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=C").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 300_000,
  });

  // Projects from enterprise
  const { data: projects = [] } = useQuery({
    queryKey: ["enterprise-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 300_000,
  });

  // Suppliers from AccountHeadMaster
  const { data: suppliers = [] } = useQuery({
    queryKey: ["account-head-suppliers-v2"],
    queryFn: () =>
      fetchWithAuth("/api/account-head/options?type=S,V&excludeCategory=Landlord").then((r) => r.json().catch(() => ({}))),
    staleTime: 300_000,
  });

  // Purchase orders (all — filtered client-side by supplierId)
  const { data: allPOs = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () =>
      fetchWithAuth("/api/vehicle-in-out/po-options")
        .then((r) => r.json().catch(() => ({})))
        .then((d) => (Array.isArray(d) ? d : (d.data ?? []))),
    staleTime: 120_000,
  });

  const { data: viewingPODetail, isFetching: loadingPODetail } = useQuery({
    queryKey: ["veh-po-preview", viewingRec?.VehicleInOutID],
    queryFn: () =>
      fetchWithAuth(`/api/vehicle-in-out/${viewingRec!.VehicleInOutID}/po`)
        .then((r) => { if (!r.ok) throw new Error("No PO"); return r.json().catch(() => ({})); }),
    enabled: !!viewingRec?.VehicleInOutID && showPODetails,
    staleTime: 300_000,
    retry: false,
  });

  // POs still owed goods (ordered > received-so-far across all Vehicle
  // In/Out lots) — same query the "Pending Vehicle In/Out" widget uses.
  // Only covers Approved/Received POs (a Pending-status PO has no
  // received-qty history yet, so it's never filtered out below on that
  // basis). Used to hide fully-received POs from the picker instead of
  // making the user scroll past ones with nothing left to deliver.
  const { data: pendingSummary, isLoading: loadingPendingSummary } = useQuery({
    queryKey: ["veh-po-pending-summary"],
    queryFn: () =>
      fetchWithAuth("/api/vehicle-in-out/pending-summary")
        .then((r) => r.json().catch(() => []))
        .then((d) => (Array.isArray(d) ? d : [])),
    staleTime: 60_000,
  });
  const pendingPoIds = useMemo(
    () => new Set((pendingSummary ?? []).map((r: any) => Number(r.poId))),
    [pendingSummary],
  );

  // Selectable POs — status-filtered, and narrowed to the header's own
  // Company/Project once those are picked (a PO for a different project has
  // no business showing up here). PO still drives supplier/company/project
  // auto-fill on select, same as before — this only narrows the list shown.
  const filteredPOs = useMemo(() => {
    return (allPOs as any[]).filter((po: any) => {
      // Always keep whatever PO is currently selected on the form — even
      // if it's since become fully received — so editing an existing
      // record never finds its own PO silently missing from the list.
      if (form.poId && Number(po.PurchaseOrderID) === Number(form.poId))
        return true;
      if (
        po.Status !== "Approved" &&
        po.Status !== "Pending" &&
        po.Status !== "Received"
      )
        return false;
      if (form.companyId && Number(po.CompanyId) !== Number(form.companyId))
        return false;
      if (form.projectId && Number(po.ProjectId) !== Number(form.projectId))
        return false;
      // Fully-received POs (Approved/Received with nothing left to
      // deliver) are hidden — but only once the pending-summary query has
      // actually loaded, so the list doesn't flash empty on first render.
      if (
        !loadingPendingSummary &&
        (po.Status === "Approved" || po.Status === "Received") &&
        !pendingPoIds.has(Number(po.PurchaseOrderID))
      )
        return false;
      return true;
    });
  }, [allPOs, form.companyId, form.projectId, form.poId, pendingPoIds, loadingPendingSummary]);

  // Live PO line items + how much is already received across other lots
  // (excludes this record's own rows when editing, via editingId) — the
  // read side of the "10 + 20 + 70 of 100" flow. Queried straight from
  // dbo.PurchaseOrderItems rather than the cached PO list's denormalized
  // POItems JSON blob, since that blob has no stable id to key qty inputs.
  const { data: poItemsRemaining = [], isFetching: loadingPOItems } = useQuery({
    queryKey: ["veh-po-items-remaining", form.poId, editingId],
    queryFn: () => vehApi.getPOItemsRemaining(form.poId!, editingId ?? undefined),
    enabled: !!form.poId,
    staleTime: 0,
  });

  const filteredProjects = useMemo(() => {
    if (!form.companyId) return projects as any[];
    return (projects as any[]).filter(
      (p: any) =>
        p.company_id != null && String(p.company_id) === String(form.companyId),
    );
  }, [projects, form.companyId]);

  // ── Deep links from the "Pending Vehicle In/Out" widget ────────────────────
  // ?view=<id>      — open a previously logged lot in the view modal.
  // ?newForPO=<id>  — open the create form pre-filled for a PO that still
  //                   has goods outstanding (mirrors the PO <select>'s own
  //                   onChange below, so company/project/supplier match).
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    bridge.onView({ VehicleInOutID: Number(viewId) });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("view");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  React.useEffect(() => {
    const poIdParam = searchParams.get("newForPO");
    if (!poIdParam || allPOs.length === 0) return;
    const id = Number(poIdParam);
    const po = (allPOs as any[]).find((p: any) => p.PurchaseOrderID === id);
    setShowForm(true);
    setEditingId(null);
    setForm({
      ...buildEmpty(activeFinYear),
      poId: id,
      poNumber: po?.DocNo || po?.PurchaseOrderNo || "",
      supplierId: po?.SupplierID ?? null,
      supplierName: po?.SupplierName ?? "",
      companyId: po?.CompanyId ?? null,
      projectId: po?.ProjectId ?? null,
    });
    setReceivedQtyByItem({});
    setPhotoByItem({});
    setQualityByItem({});
    setBrandByItem({});
    setErrors({});
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("newForPO");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allPOs]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (p: VehicleInOutPayload) => vehApi.createVehicleInOut(p),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["vehicle-in-out"] });
      setPage(1);
      setShowForm(false);
      setEditingId(null);
      setErrors({});
      setForm(buildEmpty(activeFinYear));
      setReceivedQtyByItem({});
      setPhotoByItem({});
      setQualityByItem({});
      setBrandByItem({});
      toast.success(`Vehicle In/Out ${res.docNo} created`);
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to create record"),
  });

  const updateMut = useMutation({
    mutationFn: (p: VehicleInOutPayload) =>
      vehApi.updateVehicleInOut(editingId!, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-in-out"] });
      setPage(1);
      setShowForm(false);
      setEditingId(null);
      setErrors({});
      setForm(buildEmpty(activeFinYear));
      setReceivedQtyByItem({});
      setPhotoByItem({});
      setQualityByItem({});
      setBrandByItem({});
      toast.success("Record updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => vehApi.deleteVehicleInOut(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-in-out"] });
      setPage(1);
      toast.success("Record deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete"),
  });

  const debitNoteMut = useMutation({
    mutationFn: () =>
      createQualityDebitNote({
        vehicleInOutItemId: debitNoteItem.VehicleInOutItemID,
        rejectedQty: parseFloat(debitNoteQty) || 0,
        reason: debitNoteReason.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(
        `Debit note ${res.docNo} raised — ${res.percentBad}% bad, ₹${res.amount.toLocaleString("en-IN")}`,
      );
      setDebitNoteItem(null);
      setDebitNoteQty("");
      setDebitNoteReason("");
    },
    onError: (err: any) => toast.error(err.message || "Failed to raise debit note"),
  });

  // Received-qty entries as a payload array — only lines with a positive
  // quantity are sent (an empty/zero input just means "not delivered in
  // this lot").
  const itemsPayload = useMemo(
    () =>
      Object.entries(receivedQtyByItem)
        .map(([poItemId, raw]) => ({
          poItemId: Number(poItemId),
          receivedQty: parseFloat(raw) || 0,
          photoBase64: photoByItem[Number(poItemId)] || null,
          quality: qualityByItem[Number(poItemId)] || null,
          brand: brandByItem[Number(poItemId)]?.trim() || null,
        }))
        .filter((it) => it.receivedQty > 0),
    [receivedQtyByItem, photoByItem, qualityByItem, brandByItem],
  );

  // ── Validate ──────────────────────────────────────────────────────────────────
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.companyId) errs.companyId = "Company is required";
    if (!form.projectId) errs.projectId = "Project is required";
    if (!form.poId) errs.poId = "A Purchase Order must be selected";
    if (!form.vehicleNo.trim()) errs.vehicleNo = "Vehicle number is required";
    if (!form.entryTime) errs.entryTime = "Entry time is required";
    if (!form.challanNo.trim()) errs.challanNo = "Supplier ref / Challan No is required";

    // Mirror the backend's cap client-side so the user gets an inline
    // error instead of a round-trip failure — "don't let me save 1000
    // when I ordered 100".
    for (const it of itemsPayload) {
      const po = poItemsRemaining.find((p) => p.poItemId === it.poItemId);
      if (po && it.receivedQty > po.remainingQty + 1e-6) {
        errs.items = `${po.itemName || "An item"}: cannot receive ${it.receivedQty} — only ${po.remainingQty} remaining on the PO.`;
        break;
      }
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error(
        errs.items || errs.companyId || errs.projectId || errs.poId || errs.vehicleNo || errs.entryTime || errs.challanNo || "Please fix the errors",
      );
      return false;
    }
    return true;
  };

  const buildPayload = (): VehicleInOutPayload => ({
    docDate: form.docDate,
    companyId: form.companyId,
    projectId: form.projectId,
    finYear: form.finYear || null,
    supplierId: form.supplierId,
    supplierName: form.supplierName,
    poId: form.poId,
    poNumber: form.poNumber,
    vehicleNo: form.vehicleNo.trim().toUpperCase(),
    entryTime: form.entryTime,
    exitTime: form.exitTime || null,
    challanNo: form.challanNo,
    // Backend links any of these ids that are still unlinked (newly
    // uploaded during this session); already-linked ids are a harmless
    // no-op, so it's safe to always send the full current list.
    attachmentIds: form.attachments.map((a) => a.id),
    remarks: form.remarks,
    items: itemsPayload,
  });

  const onSubmit = () => {
    if (!validate()) return;
    if (editingId != null) updateMut.mutate(buildPayload());
    else createMut.mutate(buildPayload());
  };

  const resetForm = () => {
    setForm(buildEmpty(activeFinYear));
    setReceivedQtyByItem({});
    setPhotoByItem({});
    setQualityByItem({});
    setBrandByItem({});
    setEditingId(null);
    setShowForm(false);
    setErrors({});
  };

  // ── View / Edit ───────────────────────────────────────────────────────────────
  bridge.onView = async (rec: any) => {
    setShowPODetails(false);
    setViewTab("details");
    try {
      const full = await vehApi.getVehicleInOut(rec.VehicleInOutID);
      setViewingRec(full);
    } catch {
      setViewingRec(rec);
    }
  };

  bridge.onEdit = async (rec: any) => {
    // List rows only carry AttachmentCount (cheap query) and never carry
    // Items at all — fetch the full record so we have both the actual
    // Attachments[] (id/filename/url) and Items[] (received qty per PO
    // line item) to edit.
    let full = rec;
    if (!Array.isArray(rec.Attachments) || !Array.isArray(rec.Items)) {
      try {
        full = await vehApi.getVehicleInOut(rec.VehicleInOutID);
      } catch {
        toast.error("Failed to load record details");
      }
    }
    setReceivedQtyByItem(
      Array.isArray(full.Items)
        ? Object.fromEntries(
            full.Items.map((it: any) => [it.POItemId, String(it.ReceivedQty)]),
          )
        : {},
    );
    setPhotoByItem(
      Array.isArray(full.Items)
        ? Object.fromEntries(
            full.Items.filter((it: any) => it.PhotoBase64).map((it: any) => [it.POItemId, it.PhotoBase64]),
          )
        : {},
    );
    setQualityByItem(
      Array.isArray(full.Items)
        ? Object.fromEntries(
            full.Items.filter((it: any) => it.Quality).map((it: any) => [it.POItemId, it.Quality]),
          )
        : {},
    );
    setBrandByItem(
      Array.isArray(full.Items)
        ? Object.fromEntries(
            full.Items.filter((it: any) => it.Brand).map((it: any) => [it.POItemId, it.Brand]),
          )
        : {},
    );
    setForm({
      docNo: full.DocNo ?? "",
      docDate: full.DocDate ? String(full.DocDate).slice(0, 10) : "",
      companyId: full.CompanyID ?? null,
      projectId: full.ProjectID ?? null,
      finYear: full.FinYear ?? "",
      supplierId: full.SupplierID ?? null,
      supplierName: full.SupplierName ?? "",
      contactPerson:
        (suppliers as any[]).find((s: any) => Number(s.id) === full.SupplierID)
          ?.contactPerson ?? "",
      poId: full.POID ?? null,
      poNumber: full.PONumber ?? "",
      vehicleNo: full.VehicleNo ?? "",
      entryTime: full.EntryTime
        ? toUtcDateTimeInput(new Date(full.EntryTime))
        : "",
      exitTime: full.ExitTime
        ? toUtcDateTimeInput(new Date(full.ExitTime))
        : null,
      challanNo: full.ChallanNo ?? "",
      attachments: Array.isArray(full.Attachments) ? full.Attachments : [],
      remarks: full.Remarks ?? "",
    });
    setEditingId(rec.VehicleInOutID);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  bridge.onDelete = (id: number) => setDeleteId(id);

  // ── File upload (supports multiple files — appends, doesn't replace) ────────
  // Files are sent straight to the DB-backed /upload endpoint (no local disk
  // involved) and come back with server-assigned ids + streamable urls.
  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const result = await vehApi.uploadVehicleAttachments(files);
      pf({ attachments: [...form.attachments, ...result.attachments] });
      toast.success(
        result.attachments.length > 1
          ? `${result.attachments.length} attachments uploaded`
          : "Attachment uploaded",
      );
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    // Optimistically drop it from the form; roll back if the delete fails.
    const prev = form.attachments;
    pf({ attachments: prev.filter((a) => a.id !== attachmentId) });
    try {
      await vehApi.deleteVehicleAttachment(attachmentId);
    } catch (err: any) {
      pf({ attachments: prev });
      toast.error(err.message || "Failed to remove attachment");
    }
  };

  // ── Print (from the preview modal) ───────────────────────────────────────────
  // Print and Generate PDF both render the shared letterhead document
  // (vehicleInOutDocument.ts → letterheadDocument.ts), so the two always match.
  const handlePrintVehicleRec = (rec: any) => {
    void printVehicleInOut(rec);
  };

  // Same document as Print, downloaded as a .pdf.
  //
  // The list/grid row (list query's SELECT) never carries Items — only
  // GET /:id does — so a rec passed straight from the grid's Actions
  // column here always lacks Items. Refetch the full record so the PDF
  // includes Received Items regardless of whether this was triggered from
  // the grid row or the already-fully-loaded view modal.
  const handleGeneratePdfVehicleRec = async (recIn: any) => {
    const toastId = toast.loading("Generating PDF...");
    try {
      let rec = recIn;
      if (!Array.isArray(recIn.Items) && recIn.VehicleInOutID) {
        try {
          rec = await vehApi.getVehicleInOut(recIn.VehicleInOutID);
        } catch {
          // fall back to whatever was passed in — PDF still generates,
          // just without the Items section.
        }
      }
      await downloadVehicleInOutPdf(rec);
      toast.success("PDF downloaded", { id: toastId });
    } catch {
      toast.error("Could not generate PDF", { id: toastId });
    }
  };
  bridge.onGeneratePdf = handleGeneratePdfVehicleRec;

  // ── Camera capture ───────────────────────────────────────────────────────────
  // Shared modal, two targets: capturingPoItemId set → the item's photo is
  // kept as base64 in local state (photoByItem) and sent with that line on
  // save, no upload here; null → the original behavior, uploaded as a
  // binary header-level attachment via vehApi.
  const capturePhoto = useCallback(async () => {
    const dataUrl = webcamRef.current?.getScreenshot();
    if (!dataUrl) {
      toast.error("Could not capture photo — try again");
      return;
    }
    if (capturingPoItemId != null) {
      setPhotoByItem((prev) => ({ ...prev, [capturingPoItemId]: dataUrl }));
      setShowCamera(false);
      setCapturingPoItemId(null);
      toast.success("Photo captured");
      return;
    }
    setUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `vehicle-capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      const result = await vehApi.uploadVehicleAttachments([file]);
      pf({ attachments: [...form.attachments, ...result.attachments] });
      toast.success("Photo captured");
    } catch (err: any) {
      toast.error(err.message || "Failed to save captured photo");
    } finally {
      setUploading(false);
    }
  }, [form.attachments, capturingPoItemId]);

  const switchCamera = () =>
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filteredRecords = records.filter((r: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.DocNo?.toLowerCase().includes(q) ||
      r.VehicleNo?.toLowerCase().includes(q) ||
      r.ChallanNo?.toLowerCase().includes(q) ||
      r.SupplierName?.toLowerCase().includes(q) ||
      r.PONumber?.toLowerCase().includes(q)
    );
  });

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: vehicleApprovalTrails, isLoading: vehicleApprovalTrailsLoading } = useApprovalTrailsBulk(
    "VehicleInOut",
    filteredRecords.map((r: any) => r.VehicleInOutID),
  );
  bridge.vehicleApprovalTrails = vehicleApprovalTrails;
  bridge.vehicleApprovalTrailsLoading = vehicleApprovalTrailsLoading;

  // ── Group by linked PO — every Vehicle In/Out lot delivered against the
  // same PO now shows together instead of scattered across a flat list.
  // Records with no PO link fall into a single "No PO Linked" bucket.
  // Group order follows first-appearance in the (already recency-sorted)
  // list, so the most recently active PO's group surfaces first.
  const groupedRecords = useMemo(() => {
    const groups = new Map<string, { key: string; poNumber: string | null; supplierName: string | null; rows: any[] }>();
    for (const r of filteredRecords) {
      const key = r.POID ? `po-${r.POID}` : "no-po";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          poNumber: r.PONumber || null,
          supplierName: r.SupplierName || null,
          rows: [],
        });
      }
      groups.get(key)!.rows.push(r);
    }
    return Array.from(groups.values());
  }, [filteredRecords]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], VEH_TEMPLATE_COLUMNS, "vehicle-in-out-template");
  };
  const handleImportClick = () => { importFileInputRef.current?.click(); };
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) { toast.error("CSV is empty"); return; }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };


  return {
    isLoading,
    isFetching,
    rights,
    qc,
    finYears,
    currentUser,
    activeFinYear,
    importFileInputRef,
    importing,
    setImporting,
    showForm,
    setShowForm,
    editingId,
    setEditingId,
    viewingRec,
    setViewingRec,
    viewTab,
    setViewTab,
    showPODetails,
    setShowPODetails,
    deleteId,
    setDeleteId,
    search,
    setSearch,
    page,
    setPage,
    filterFY,
    setFilterFY,
    errors,
    setErrors,
    uploading,
    setUploading,
    fileInputRef,
    showCamera,
    setShowCamera,
    cameraError,
    setCameraError,
    facingMode,
    setFacingMode,
    webcamRef,
    receivedQtyByItem,
    setReceivedQtyByItem,
    photoByItem,
    setPhotoByItem,
    capturingPoItemId,
    setCapturingPoItemId,
    qualityByItem,
    setQualityByItem,
    brandByItem,
    setBrandByItem,
    debitNoteItem,
    setDebitNoteItem,
    debitNoteQty,
    setDebitNoteQty,
    debitNoteReason,
    setDebitNoteReason,
    form,
    setForm,
    pf,
    records,
    totalPages,
    total,
    docNoPreview,
    loadingPreview,
    companies,
    projects,
    suppliers,
    allPOs,
    viewingPODetail,
    loadingPODetail,
    pendingSummary,
    loadingPendingSummary,
    pendingPoIds,
    filteredPOs,
    poItemsRemaining,
    loadingPOItems,
    filteredProjects,
    searchParams,
    setSearchParams,
    createMut,
    updateMut,
    deleteMut,
    debitNoteMut,
    itemsPayload,
    validate,
    buildPayload,
    onSubmit,
    resetForm,
    handleFileUpload,
    removeAttachment,
    handlePrintVehicleRec,
    handleGeneratePdfVehicleRec,
    capturePhoto,
    switchCamera,
    filteredRecords,
    vehicleApprovalTrails,
    vehicleApprovalTrailsLoading,
    groupedRecords,
    collapsedGroups,
    setCollapsedGroups,
    toggleGroup,
    handleDownloadTemplate,
    handleImportClick,
    handleImportFileChange,
  };
}

export type VIOState = ReturnType<typeof useVehicleInOut>;
