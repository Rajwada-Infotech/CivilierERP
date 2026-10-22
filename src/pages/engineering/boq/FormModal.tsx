// New / edit BOQ: header, lines, totals and save.
import React, { useState } from "react";
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

  // When company changes, reset the project selection
  const handleCompanyChange = (v: string) => {
    set("CompanyId", v);
    set("ProjectId", "");
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
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildPayload(form, items, activities, activityOptions, activityGroups);
      if (isEdit) {
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
            padding: "14px 20px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted px-2 font-semibold text-sm border border-border bg-transparent"
            >
              <ArrowLeft size={15} /> Back
            </Button>
            <div
              style={{ width: 1, height: 28, background: "hsl(var(--border))" }}
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
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving}
              className="font-semibold text-sm px-5 py-2 h-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gradient-engineering inline-flex items-center gap-1.5 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg h-auto"
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
              </Field>

              <Field label="BOQ No">
                <Input
                  value={form.BoqNo || ""}
                  readOnly
                  placeholder="Auto generated"
                  className="h-10 bg-muted/50 text-muted-foreground cursor-not-allowed focus-visible:ring-0"
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
                    className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer${errors.BoqDate ? " border-destructive" : " border-border"}`}
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
                  onValueChange={(v) => set("ProjectId", v)}
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
              activityOptions={activityOptions}
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
