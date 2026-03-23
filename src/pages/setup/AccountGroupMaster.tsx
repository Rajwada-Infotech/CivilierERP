import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ColumnDef } from "@/components/MasterPage";
import { Search, Edit2, Trash2, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { FieldDef } from "@/components/MasterPage";

// Master sub-form field definitions
const contractorFields: FieldDef[] = [
  { name: "ct_name", label: "Contractor Name", type: "text", required: true },
  { name: "ct_contact", label: "Contact Person", type: "text" },
  { name: "ct_phone", label: "Phone Number", type: "text" },
  { name: "ct_email", label: "Email Address", type: "text" },
  { name: "ct_gst", label: "GST Number", type: "text", uppercase: true },
  { name: "ct_pan", label: "PAN Number", type: "text", uppercase: true },
  { name: "ct_type", label: "Contractor Type", type: "select", options: ["Civil", "Electrical", "Mechanical", "Plumbing", "General"] },
  { name: "ct_paymentTerms", label: "Payment Terms", type: "select", options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"] },
  { name: "ct_address", label: "Address", type: "textarea", fullWidth: true },
  { name: "ct_status", label: "Status", type: "toggle", defaultValue: true },
];

const supplierFields: FieldDef[] = [
  { name: "sp_name", label: "Supplier Name", type: "text", required: true },
  { name: "sp_contact", label: "Contact Person", type: "text" },
  { name: "sp_phone", label: "Phone Number", type: "text" },
  { name: "sp_email", label: "Email Address", type: "text" },
  { name: "sp_gst", label: "GST Number", type: "text", uppercase: true },
  { name: "sp_pan", label: "PAN Number", type: "text", uppercase: true },
  { name: "sp_category", label: "Supplier Category", type: "select", options: ["Material", "Equipment", "Labour", "Services", "Transport"] },
  { name: "sp_paymentTerms", label: "Payment Terms", type: "select", options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"] },
  { name: "sp_creditLimit", label: "Credit Limit (₹)", type: "number", prefix: "₹" },
  { name: "sp_address", label: "Address", type: "textarea", fullWidth: true },
  { name: "sp_status", label: "Status", type: "toggle", defaultValue: true },
];

const bankFields: FieldDef[] = [
  { name: "bk_bankName", label: "Bank Name", type: "text", required: true },
  { name: "bk_branch", label: "Branch Name", type: "text" },
  { name: "bk_accountNo", label: "Account Number", type: "text", required: true },
  { name: "bk_ifsc", label: "IFSC Code", type: "text", uppercase: true, required: true },
  { name: "bk_accountType", label: "Account Type", type: "select", options: ["Current", "Savings", "Overdraft (OD)", "Cash Credit"] },
  { name: "bk_bankType", label: "Bank Type", type: "select", options: ["Nationalized", "Private", "Co-operative", "Foreign", "Regional Rural"] },
  { name: "bk_holderName", label: "Account Holder Name", type: "text" },
  { name: "bk_openingBalance", label: "Opening Balance (₹)", type: "number", prefix: "₹" },
  { name: "bk_address", label: "Address", type: "textarea", fullWidth: true },
  { name: "bk_status", label: "Status", type: "toggle", defaultValue: true },
];

const expensesFields: FieldDef[] = [
  { name: "ex_name", label: "Expense Name", type: "text", required: true },
  { name: "ex_code", label: "Expense Code", type: "text" },
  { name: "ex_category", label: "Expense Category", type: "select", options: ["Direct", "Indirect", "Administrative", "Capital", "Operational"] },
  { name: "ex_linkedHead", label: "Linked Account Head", type: "select", options: ["Office Expenses", "Site Expenses", "Labour Cost", "Material Cost"] },
  { name: "ex_tax", label: "Tax Applicable", type: "select", options: ["None", "GST 5%", "GST 12%", "GST 18%", "GST 28%"] },
  { name: "ex_description", label: "Description", type: "textarea", fullWidth: true },
  { name: "ex_status", label: "Status", type: "toggle", defaultValue: true },
];

const accountHeadFields: FieldDef[] = [
  { name: "ah_name", label: "Account Head Name", type: "text", required: true },
  { name: "ah_code", label: "Account Code", type: "text", required: true },
  { name: "ah_group", label: "Account Group", type: "select", options: ["Fixed Assets", "Current Liabilities", "Revenue", "Direct Expenses"], required: true },
  { name: "ah_type", label: "Account Type", type: "select", options: ["Bank", "Cash", "Receivable", "Payable", "Revenue", "Expense", "Capital"] },
  { name: "ah_openingBalance", label: "Opening Balance (₹)", type: "number", prefix: "₹" },
  { name: "ah_balanceType", label: "Balance Type", type: "select", options: ["Debit", "Credit"] },
  { name: "ah_description", label: "Description", type: "textarea", fullWidth: true },
  { name: "ah_status", label: "Status", type: "toggle", defaultValue: true },
];

const masterFieldsMap: Record<string, { label: string; fields: FieldDef[] }> = {
  "Account Head Master": { label: "Account Head Master Details", fields: accountHeadFields },
  "Contractor Master": { label: "Contractor Master Details", fields: contractorFields },
  "Supplier Master": { label: "Supplier Master Details", fields: supplierFields },
  "Bank Master": { label: "Bank Master Details", fields: bankFields },
  "Expenses Master": { label: "Expenses Master Details", fields: expensesFields },
};

// Main form fields
const mainFields: FieldDef[] = [
  { name: "groupName", label: "Group Name", type: "text", required: true },
  { name: "groupCode", label: "Group Code", type: "text", required: true },
  { name: "groupType", label: "Group Type", type: "select", required: true, options: ["Asset", "Liability", "Income", "Expense", "Equity", "Capital"] },
  { name: "description", label: "Description", type: "textarea", fullWidth: true },
  { name: "applicableMasters", label: "Applicable Masters", type: "multiselect", options: ["Account Head Master", "Contractor Master", "Supplier Master", "Bank Master", "Expenses Master"], fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "groupName", label: "Group Name" },
  { key: "groupCode", label: "Group Code" },
  { key: "groupType", label: "Group Type" },
  { key: "applicableMasters", label: "Applicable Masters" },
  { key: "status", label: "Status" },
];

const initialData = [
  { groupName: "Fixed Assets", groupCode: "FA-001", groupType: "Asset", description: "All fixed assets", applicableMasters: ["Account Head Master", "Contractor Master"], status: true },
  { groupName: "Current Liabilities", groupCode: "CL-001", groupType: "Liability", description: "Short-term obligations", applicableMasters: ["Account Head Master", "Supplier Master"], status: true },
  { groupName: "Revenue", groupCode: "RV-001", groupType: "Income", description: "Revenue accounts", applicableMasters: ["Account Head Master"], status: true },
];

function getDefaults(fields: FieldDef[]): Record<string, any> {
  const d: Record<string, any> = {};
  fields.forEach((f) => {
    if (f.type === "toggle") d[f.name] = f.defaultValue ?? true;
    else if (f.type === "multiselect") d[f.name] = f.defaultValue ?? [];
    else d[f.name] = f.defaultValue ?? "";
  });
  return d;
}

function getAllDefaults(): Record<string, any> {
  let d = getDefaults(mainFields);
  Object.values(masterFieldsMap).forEach((m) => {
    d = { ...d, ...getDefaults(m.fields) };
  });
  return d;
}

const FieldRenderer: React.FC<{
  field: FieldDef;
  form: Record<string, any>;
  errors: Record<string, boolean>;
  updateField: (name: string, value: any, field: FieldDef) => void;
}> = ({ field, form, errors, updateField }) => {
  const isFullWidth = field.fullWidth || field.type === "textarea";
  return (
    <div className={isFullWidth ? "md:col-span-2" : ""}>
      <label className="block text-xs font-heading text-muted-foreground mb-1">
        {field.label} {field.required && <span className="text-destructive">*</span>}
      </label>
      {field.type === "text" || field.type === "number" ? (
        <div className="relative">
          {field.prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{field.prefix}</span>}
          <input
            type={field.type === "number" ? "number" : "text"}
            value={form[field.name] || ""}
            onChange={(e) => updateField(field.name, e.target.value, field)}
            className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${field.prefix ? "pl-7" : ""} ${errors[field.name] ? "border-destructive" : "border-border"}`}
          />
        </div>
      ) : field.type === "select" ? (
        <select
          value={form[field.name] || ""}
          onChange={(e) => updateField(field.name, e.target.value, field)}
          className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${errors[field.name] ? "border-destructive" : "border-border"}`}
        >
          <option value="">Select...</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          value={form[field.name] || ""}
          onChange={(e) => updateField(field.name, e.target.value, field)}
          rows={3}
          className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${errors[field.name] ? "border-destructive" : "border-border"}`}
        />
      ) : field.type === "toggle" ? (
        <button
          type="button"
          onClick={() => updateField(field.name, !form[field.name], field)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form[field.name] ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform ${form[field.name] ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      ) : field.type === "multiselect" ? (
        <div className="flex flex-wrap gap-2">
          {field.options?.map((o) => {
            const selected = (form[field.name] as string[] || []).includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  const current = form[field.name] as string[] || [];
                  const next = selected ? current.filter((x: string) => x !== o) : [...current, o];
                  updateField(field.name, next, field);
                }}
                className={`px-3 py-1 rounded-full text-xs font-heading border transition-all ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary"}`}
              >
                {o}
              </button>
            );
          })}
        </div>
      ) : null}
      {errors[field.name] && <p className="text-xs text-destructive mt-1">{field.label} is required</p>}
    </div>
  );
};

const SubSection: React.FC<{
  masterKey: string;
  form: Record<string, any>;
  errors: Record<string, boolean>;
  updateField: (name: string, value: any, field: FieldDef) => void;
}> = ({ masterKey, form, errors, updateField }) => {
  const [expanded, setExpanded] = useState(true);
  const master = masterFieldsMap[masterKey];
  if (!master) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden animate-fade-in">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
      >
        <span className="font-heading text-sm font-semibold text-foreground">{master.label}</span>
        {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="p-4 border-t border-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {master.fields.map((field) => (
              <FieldRenderer key={field.name} field={field} form={form} errors={errors} updateField={updateField} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AccountGroupMaster: React.FC = () => {
  const [data, setData] = useState<Record<string, any>[]>(initialData);
  const [form, setForm] = useState<Record<string, any>>(getAllDefaults);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const updateField = (name: string, value: any, field: FieldDef) => {
    let v = value;
    if (field.uppercase && typeof v === "string") v = v.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: v }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: false }));
  };

  const validate = () => {
    const errs: Record<string, boolean> = {};
    // Validate main fields
    mainFields.forEach((f) => {
      if (f.required && (!form[f.name] || (typeof form[f.name] === "string" && !form[f.name].trim()))) errs[f.name] = true;
    });
    // Validate sub-form required fields for selected masters
    const selectedMasters = (form.applicableMasters as string[]) || [];
    selectedMasters.forEach((masterKey) => {
      const master = masterFieldsMap[masterKey];
      if (master) {
        master.fields.forEach((f) => {
          if (f.required && (!form[f.name] || (typeof form[f.name] === "string" && !form[f.name].trim()))) errs[f.name] = true;
        });
      }
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (editingId !== null) {
      setData((prev) => prev.map((row, i) => (i === editingId ? { ...form } : row)));
      setEditingId(null);
      toast.success("Account Group record saved successfully ✓");
    } else {
      setData((prev) => [...prev, { ...form }]);
      toast.success("Account Group record saved successfully ✓");
    }
    setForm(getAllDefaults());
  };

  const handleEdit = (index: number) => {
    setForm({ ...getAllDefaults(), ...data[index] });
    setEditingId(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (index: number) => {
    setData((prev) => prev.filter((_, i) => i !== index));
    setDeleteConfirm(null);
    if (editingId === index) { setEditingId(null); setForm(getAllDefaults()); }
    toast.success("Record deleted");
  };

  const handleReset = () => {
    setForm(getAllDefaults());
    setEditingId(null);
    setErrors({});
  };

  const filtered = data.filter((row) => {
    if (!search) return true;
    return Object.values(row).some((v) => String(v).toLowerCase().includes(search.toLowerCase()));
  });

  const selectedMasters = (form.applicableMasters as string[]) || [];

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Setup", "Account Group"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Account Group</h1>

      {/* Form */}
      <div className="rounded-xl bg-card border border-border p-5 mb-6">
        <h2 className="font-heading font-semibold text-foreground text-lg mb-4">
          {editingId !== null ? "Edit Account Group" : "Add Account Group"}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {mainFields.map((field) => (
            <FieldRenderer key={field.name} field={field} form={form} errors={errors} updateField={updateField} />
          ))}
        </div>

        {/* Inline Master Sub-forms */}
        {selectedMasters.length > 0 && (
          <div className="mt-6 space-y-4">
            <div className="border-t border-border pt-4">
              <p className="text-xs font-heading text-muted-foreground uppercase tracking-wider mb-3">Linked Master Details</p>
            </div>
            {selectedMasters.map((masterKey) => (
              <SubSection key={masterKey} masterKey={masterKey} form={form} errors={errors} updateField={updateField} />
            ))}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} className="px-5 py-2 rounded-lg font-heading text-sm font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all">
            {editingId !== null ? "Update" : "Save"}
          </button>
          <button onClick={handleReset} className="px-5 py-2 rounded-lg font-heading text-sm border border-border text-muted-foreground hover:bg-muted transition-all">
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search records..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold">#</th>
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold">{col.label}</th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} className={`border-b border-border transition-colors hover:bg-muted/50 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                  <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-foreground">
                      {col.key === "status" ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-heading ${row[col.key] ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {row[col.key] ? "Active" : "Inactive"}
                        </span>
                      ) : Array.isArray(row[col.key]) ? (
                        (row[col.key] as string[]).join(", ")
                      ) : (
                        String(row[col.key] ?? "")
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {deleteConfirm === i ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Sure?</span>
                        <button onClick={() => handleDelete(i)} className="text-destructive hover:bg-destructive/10 p-1 rounded"><Check size={14} /></button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-muted-foreground hover:bg-muted p-1 rounded"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEdit(i)} className="p-1.5 rounded hover:bg-muted transition-colors text-primary"><Edit2 size={14} /></button>
                        <button onClick={() => setDeleteConfirm(i)} className="p-1.5 rounded hover:bg-muted transition-colors text-destructive"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={columns.length + 2} className="px-4 py-8 text-center text-muted-foreground">No records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
};

export default AccountGroupMaster;
