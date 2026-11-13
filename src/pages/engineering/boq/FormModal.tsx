// New / edit BOQ: header, lines, totals and save.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Save, RefreshCw, Edit3, ArrowLeft, Calendar as CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { DateInput } from "@/components/ui/date-input";
import { BoqItem, BoqActivity, BoqRecord, Company, Project, DocType, UomOption, ItemOption, ActivityOption, ActivityGroupOption, uid, apiFetch, rowToItem, rowToActivity, buildPayload, Field, FormState, defaultForm, recordToForm } from "./config";
import { LineEditor } from "./LineEditor";

// BOQ Form Modal
// ─────────────────────────────────────────────────────────────────────────────

export interface FormModalProps {
  record: BoqRecord | null;
  companies: Company[];
  projects: Project[];
  docTypes: DocType[];
  uoms: UomOption[];
  itemOptions: ItemOption[];
  activityOptions: ActivityOption[];
  activityGroups: ActivityGroupOption[];
  finYears: { id?: number | string; year: string; status?: string; locked?: boolean }[];
  activeFinYear?: string;
  onClose: () => void;
  onSaved: () => void;
  /** Amendment mode (Amend on an approved BOQ): saving raises an amendment instead of saving. */
  amend?: { intercept: (id: string | number | null | undefined, payload: unknown) => Promise<boolean> };
}

export const FormModal: React.FC<FormModalProps> = ({
  record,
  companies,
  projects,
  docTypes,
  uoms,
  itemOptions,
  activityOptions,
  activityGroups,
  finYears,
  activeFinYear,
  onClose,
  onSaved,
  amend,
}) => {
  const isEdit = record !== null;
  const [form, setForm] = useState<FormState>(
    isEdit
      ? {
          ...recordToForm(record!),
          FinYear: (record as any)?.FinYear ?? activeFinYear ?? "",
        }
      : defaultForm(activeFinYear),
  );
  const [items, setItems] = useState<BoqItem[]>(
    (record?.BoqItems ?? []).map(rowToItem),
  );
  const [activities, setActivities] = useState<BoqActivity[]>(
    (record?.BoqActivities ?? []).map(rowToActivity),
  );
  const [lineTab, setLineTab] = useState<"items" | "activities">("activities");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof FormState, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
  };

  // Where the estimation is for: Block → Floor, floors narrowed by the block (Floor Master + Auto Project Setup).
  const clearLocation = () => setForm((p) => ({ ...p, BlockId: "", FloorNo: "", RoomId: "" }));
  const [locOpts, setLocOpts] = useState<{ blocks: { id: number; name: string }[]; floors: { value: string; label: string }[] }>({ blocks: [], floors: [] });
  useEffect(() => {
    if (!form.ProjectId) { setLocOpts({ blocks: [], floors: [] }); return; }
    let live = true;
    const q = new URLSearchParams({ projectId: form.ProjectId });
    if (form.BlockId) q.set("blockId", form.BlockId);
    apiFetch(`/boq/location-options?${q}`)
      .then((d: any) => { if (live) setLocOpts({ blocks: d?.blocks ?? [], floors: d?.floors ?? [] }); })
      .catch(() => { if (live) setLocOpts({ blocks: [], floors: [] }); });
    return () => { live = false; };
  }, [form.ProjectId, form.BlockId]);

  // Activities already estimated on another BOQ for this exact place — they can't be added here.
  const [usedActivities, setUsedActivities] = useState<{ activityId: string; activityName: string; boqNo: string }[]>([]);
  useEffect(() => {
    if (!form.ProjectId || !form.BlockId || !form.FloorNo) { setUsedActivities([]); return; }
    let live = true;
    const q = new URLSearchParams({ projectId: form.ProjectId, blockId: form.BlockId, floorNo: form.FloorNo });
    if (record?.BoqID) q.set("excludeId", String(record.BoqID));
    apiFetch(`/boq/used-activities?${q}`)
      .then((d: any) => { if (live) setUsedActivities(Array.isArray(d) ? d : []); })
      .catch(() => { if (live) setUsedActivities([]); });
    return () => { live = false; };
  }, [form.ProjectId, form.BlockId, form.FloorNo, record?.BoqID]);
  const usedIds = new Set(usedActivities.map((u) => String(u.activityId)));
  const pickableActivities = activityOptions.filter((o) => !usedIds.has(String(o.id)));
  const clashing = usedActivities.filter((u) => activities.some((a) => String(a.activityId) === String(u.activityId)));

  // When company changes, reset the project selection (and the location under it)
  const handleCompanyChange = (v: string) => {
    set("CompanyId", v);
    set("ProjectId", "");
    clearLocation();
  };

  // When an Activity line is added, auto-fetch the items linked to that
  // activity (Activity Master → "Add Item") and merge any not already on
  // the Items tab — quantity/rate are left blank for the user to fill in.
  const handleActivitySelected = async (activityId: string) => {
    try {
      const linked = await apiFetch(`/activity-items?activityId=${activityId}`);
      const linkedList: any[] = Array.isArray(linked) ? linked : [];
      if (linkedList.length === 0) return;

      setItems((prev) => {
        const existingIds = new Set(prev.map((it) => it.itemId));
        const actName = activityOptions.find((o) => o.id === activityId)?.name ?? "";
        const newRows = linkedList
          .filter((li) => !existingIds.has(li.itemId))
          .map((li) => ({
            _key: uid(),
            activityId,
            activityName: actName,
            itemId: li.itemId,
            itemName: li.itemName,
            itemCode: li.itemCode || "",
            description: "",
            quantity: "",
            uomName: li.uom || "",
            rate: "",
            tax: "18",
            amount: 0,
          }));
        if (newRows.length === 0) return prev;
        toast.success(
          `${newRows.length} item${newRows.length > 1 ? "s" : ""} auto-added from this activity`,
        );
        return [...prev, ...newRows];
      });
    } catch (err) {
      // Non-fatal — activity selection itself still succeeds either way.
      console.warn("Failed to auto-fetch activity items:", err);
    }
  };

  // Filter projects to only those belonging to the selected company.
  // If no company selected, show all projects.
  const filteredProjects = form.CompanyId
    ? projects.filter(
        (p) =>
          p.companyId == null || // show projects with no company link always
          (p.companyIds ?? []).includes(form.CompanyId) ||
          String(p.companyId) === form.CompanyId,
      )
    : projects;

  const refreshBoqNo = async (docTypeId: string, finYear: string) => {
    if (!docTypeId) {
      set("BoqNo", "");
      return;
    }
    try {
      const nextDocNo = await fetchNextDocNumber(
        Number(docTypeId),
        finYear || undefined,
      );
      set("BoqNo", nextDocNo);
    } catch {
      toast.error("Failed to generate BOQ number preview");
    }
  };

  const handleDocTypeChange = async (value: string) => {
    set("DocTypeId", value);
    await refreshBoqNo(value, form.FinYear);
  };

  // On the BOQ page the document type is the BOQ one: with a single BOQ type it's picked on its own (which also
  // fetches the BOQ No) and shown locked; the picker only appears if more than one BOQ type exists.
  const onlyDocType = docTypes.length === 1 ? docTypes[0] : null;
  useEffect(() => {
    if (onlyDocType && !form.DocTypeId) void handleDocTypeChange(String(onlyDocType.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyDocType?.id, form.FinYear]);

  const handleFinYearChange = async (value: string) => {
    set("FinYear", value);
    if (form.DocTypeId) {
      await refreshBoqNo(form.DocTypeId, value);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.BoqDate) e.BoqDate = "Date is required";
    if (!form.CompanyId) e.CompanyId = "Company is required";
    if (!form.ProjectId) e.ProjectId = "Project is required";
    if (!form.DocTypeId) e.DocTypeId = "Document type is required";
    if (!form.FinYear) e.FinYear = "Financial year is required";
    if (!form.BlockId) e.BlockId = "Block is required";
    if (!form.FloorNo) e.FloorNo = "Floor is required";
    setErrors(e);
    if (Object.keys(e).length === 0 && clashing.length) {
      toast.error(`Already estimated for this block and floor: ${clashing.map((c) => `${c.activityName || c.activityId} (${c.boqNo})`).join(", ")}`);
      return false;
    }
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildPayload(form, items, activities, activityOptions, activityGroups);
      if (isEdit) {
        if (amend && (await amend.intercept(record!.BoqID, payload))) return;
        await apiFetch(`/boq/${record!.BoqID}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("BOQ updated");
      } else {
        await apiFetch("/boq", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("BOQ created");
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const itemsTotal = items.reduce(
    (s, r) => s + (parseFloat(String(r.amount)) || 0),
    0,
  );
  const activitiesTotal = activities.reduce(
    (s, r) => s + (parseFloat(String(r.amount)) || 0),
    0,
  );

  return (
    <div
      className="flex flex-col animate-in fade-in"
      style={{ minHeight: "calc(100vh - 112px)" }}
    >
      <div className="w-full flex flex-col">
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            rowGap: 10,
            padding: "14px 20px",
            borderBottom: "1px solid hsl(var(--foreground))",
            background: "hsl(var(--card))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
            <button type="button" onClick={onClose} className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 h-8 px-3 bg-card border border-foreground text-foreground hover:bg-primary/10 transition-colors">
              <ArrowLeft size={12} /> Back
            </button>
            <div
              style={{ width: 1, height: 28, background: "hsl(var(--foreground) / 0.2)" }}
            />
            <div>
              <h2
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isEdit ? (
                  <Edit3 size={17} style={{ color: "hsl(var(--primary))" }} />
                ) : (
                  <FileText
                    size={17}
                    style={{ color: "hsl(var(--primary))" }}
                  />
                )}
                {isEdit
                  ? `Edit BOQ — ${record!.BoqNo}`
                  : "New Bill of Quantities"}
              </h2>
              <p
                style={{
                  fontSize: 12,
                  color: "hsl(var(--muted-foreground))",
                  marginTop: 2,
                }}
              >
                {isEdit
                  ? "Modify header, items and activities."
                  : "Fill in the header, then add items and/or activities."}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center h-9 px-4 bg-card border border-foreground text-foreground hover:bg-primary/10 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] bg-foreground text-card border border-foreground px-4 py-1.5 h-9"
            >
              {saving ? (
                <RefreshCw className="animate-spin" size={14} />
              ) : (
                <Save size={14} />
              )}
              {isEdit ? "Update BOQ" : "Create BOQ"}
            </Button>
          </div>
        </div>

        {/* ── Body ── */}
        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* Section 1: Header */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid hsl(var(--border))",
                paddingBottom: 8,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: "hsl(var(--primary) / 0.1)",
                  color: "hsl(var(--primary))",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                1
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                BOQ Header
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field label="Financial Year" required error={errors.FinYear}>
                <Select
                  value={form.FinYear}
                  onValueChange={handleFinYearChange}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.FinYear ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="Select financial year" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {finYears
                      .filter((fy) => fy.status === "Active" && !fy.locked)
                      .sort((a, b) => b.year.localeCompare(a.year))
                      .map((fy) => (
                      <SelectItem
                        key={String(fy.id ?? fy.year)}
                        value={fy.year}
                      >
                        {fy.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Document Type" required error={errors.DocTypeId}>
                {onlyDocType ? (
                  <Input
                    value={`${onlyDocType.code}${onlyDocType.description ? ` — ${onlyDocType.description}` : ""}`}
                    readOnly
                    aria-readonly="true"
                    className="h-10 bg-card text-muted-foreground cursor-not-allowed"
                  />
                ) : (
                <Select
                  value={form.DocTypeId}
                  onValueChange={handleDocTypeChange}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.DocTypeId ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select type —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {docTypes.map((dt) => (
                      <SelectItem key={String(dt.id)} value={String(dt.id)}>
                        {dt.code}
                        {dt.description ? ` — ${dt.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                )}
              </Field>

              <Field label="BOQ No">
                <Input
                  value={form.BoqNo || ""}
                  readOnly
                  placeholder="Auto generated"
                  className="h-10 bg-card text-muted-foreground cursor-not-allowed"
                />
              </Field>

              <Field label="BOQ Date" required error={errors.BoqDate}>
                <div className="relative">
                  <CalendarIcon
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    size={14}
                  />
                  <DateInput
                    value={form.BoqDate}
                    onChange={(e) => set("BoqDate", e.target.value)}
                    className={`w-full pl-8 pr-3 py-2 text-sm bg-card border text-foreground focus:outline-none transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer${errors.BoqDate ? " border-destructive" : " border-foreground/30"}`}
                  />
                </div>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Company" required error={errors.CompanyId}>
                <Select
                  value={form.CompanyId}
                  onValueChange={handleCompanyChange}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.CompanyId ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="— Select company —" />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {companies.map((c) => (
                      <SelectItem key={String(c.id)} value={String(c.id)}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Project" required error={errors.ProjectId}>
                <Select
                  value={form.ProjectId}
                  onValueChange={(v) => { set("ProjectId", v); clearLocation(); }}
                >
                  <SelectTrigger
                    className={`h-10 ${errors.ProjectId ? "border-destructive" : ""}`}
                  >
                    <SelectValue
                      placeholder={
                        form.CompanyId
                          ? "— Select project —"
                          : "— Select company first —"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {filteredProjects.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Where this estimation is for — an activity can be estimated once per block + floor. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Block" required error={errors.BlockId}>
                <Select value={form.BlockId} onValueChange={(v) => setForm((p) => ({ ...p, BlockId: v, FloorNo: "", RoomId: "" }))} disabled={!form.ProjectId}>
                  <SelectTrigger className={`h-10 ${errors.BlockId ? "border-destructive" : ""}`}>
                    <SelectValue placeholder={form.ProjectId ? (locOpts.blocks.length ? "— Select block —" : "No blocks in this project") : "— Select project first —"} />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {locOpts.blocks.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Floor" required error={errors.FloorNo}>
                <Select value={form.FloorNo} onValueChange={(v) => set("FloorNo", v)} disabled={!form.BlockId}>
                  <SelectTrigger className={`h-10 ${errors.FloorNo ? "border-destructive" : ""}`}>
                    <SelectValue placeholder={form.BlockId ? (locOpts.floors.length ? "— Select floor —" : "No floors in this block") : "— Select block first —"} />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {locOpts.floors.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {clashing.length > 0 ? (
              <p className="border border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Already estimated for this block and floor — remove {clashing.length === 1 ? "it" : "them"} or pick another location:{" "}
                {clashing.map((c) => `${c.activityName || c.activityId} (${c.boqNo})`).join(", ")}
              </p>
            ) : usedActivities.length > 0 ? (
              <p className="text-[0.6875rem] text-muted-foreground">
                {usedActivities.length} {usedActivities.length === 1 ? "activity is" : "activities are"} already estimated for this location and left out of the activity list.
              </p>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Scope / Description">
                <Textarea
                  value={form.Description}
                  rows={2}
                  placeholder="Describe the scope of work…"
                  onChange={(e) => set("Description", e.target.value)}
                  className="resize-none"
                />
              </Field>
              <Field label="Remarks">
                <Textarea
                  value={form.Remarks}
                  rows={2}
                  placeholder="Internal notes…"
                  onChange={(e) => set("Remarks", e.target.value)}
                  className="resize-none"
                />
              </Field>
            </div>
          </div>

          {/* Section 2: Line items */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderBottom: "1px solid hsl(var(--border))",
                paddingBottom: 8,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: "hsl(var(--primary) / 0.1)",
                  color: "hsl(var(--primary))",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                2
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Items & Activities
              </span>
            </div>

            <LineEditor
              mode={lineTab === "items" ? "item" : "activity"}
              rows={lineTab === "items" ? items : activities}
              uoms={uoms}
              itemOptions={itemOptions}
              activityOptions={pickableActivities}
              activityGroups={activityGroups}
              boqActivities={activities}
              itemsTotal={itemsTotal}
              activitiesTotal={activitiesTotal}
              onChange={
                lineTab === "items" ? (setItems as any) : (setActivities as any)
              }
              onTabChange={setLineTab}
              onActivitySelected={handleActivitySelected}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
