import Webcam from "react-webcam";
import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  Loader2,
  Paperclip,
  Phone,
  Search,
  Send,
  ShieldAlert,
  User,
  X,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DropdownOption {
  id: number | string;
  name: string;
}

interface CustomerOption {
  LHeadId: number;
  LHeadName: string;
  LHeadPhone: string | null;
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITIES = [
  {
    value: "Urgent",
    label: "Urgent",
    color: "text-red-600",
    bg: "bg-red-500/10",
    border: "border-red-400/30",
    ring: "ring-red-400/40",
    icon: ShieldAlert,
  },
  {
    value: "High",
    label: "High",
    color: "text-orange-600",
    bg: "bg-orange-500/10",
    border: "border-orange-400/30",
    ring: "ring-orange-400/40",
    icon: AlertCircle,
  },
  {
    value: "Medium",
    label: "Medium",
    color: "text-amber-600",
    bg: "bg-amber-500/10",
    border: "border-amber-400/30",
    ring: "ring-amber-400/40",
    icon: AlertCircle,
  },
  {
    value: "Low",
    label: "Low",
    color: "text-blue-600",
    bg: "bg-blue-500/10",
    border: "border-blue-400/30",
    ring: "ring-blue-400/40",
    icon: AlertCircle,
  },
] as const;

// ─── Searchable Select ────────────────────────────────────────────────────────

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  loading,
}: {
  options: { id: number | string; label: string; sub?: string }[];
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(q.toLowerCase()),
  );

  const selected = options.find((o) => String(o.id) === value);

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-sm transition-all
          ${open ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-muted-foreground/40"}
          bg-background text-foreground`}
      >
        <span
          className={selected ? "text-foreground" : "text-muted-foreground"}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={13} className="text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
            />
            {q && (
              <button onClick={() => setQ("")}>
                <X
                  size={12}
                  className="text-muted-foreground hover:text-foreground"
                />
              </button>
            )}
          </div>
          <div className="max-h-52 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No results
              </div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(String(o.id), o.label);
                    setOpen(false);
                    setQ("");
                  }}
                  className={`w-full flex flex-col items-start px-3.5 py-2.5 text-sm hover:bg-muted/60 transition-colors text-left
                    ${String(o.id) === value ? "bg-primary/8 text-primary font-medium" : "text-foreground"}`}
                >
                  {o.label}
                  {o.sub && (
                    <span className="text-[11px] text-muted-foreground mt-0.5">
                      {o.sub}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
  error,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const CreateTicket = () => {
  const navigate = useNavigate();

  // Form state
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [priority, setPriority] = useState<
    "Low" | "Medium" | "High" | "Urgent"
  >("Medium");
  const [subject, setSubject] = useState("");
  const [issueDetails, setIssueDetails] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const webcamRef = useRef<Webcam>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: dropdownData, isLoading: loadingDropdowns } = useQuery({
    queryKey: ["business-dropdown"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/business/dropdown");
      if (!res.ok) throw new Error("Failed to load dropdowns");
      return res.json() as Promise<{
        companies: DropdownOption[];
        projects: DropdownOption[];
      }>;
    },
    staleTime: 5 * 60_000,
  });

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ["account-head-customers"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/account-head?type=A");
      if (!res.ok) throw new Error("Failed to load customers");
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as CustomerOption[];
    },
    staleTime: 5 * 60_000,
  });

  const companies = dropdownData?.companies ?? [];
  const projects = dropdownData?.projects ?? [];

  const companyOptions = companies.map((c) => ({ id: c.id, label: c.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, label: p.name }));
  const customerOptions = customers.map((c) => ({
    id: c.LHeadId,
    label: c.LHeadName,
    sub: c.LHeadPhone ?? undefined,
  }));

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleCustomerSelect = (id: string, label: string) => {
    setCustomerName(label);
    const found = customers.find((c) => String(c.LHeadId) === id);
    if (found?.LHeadPhone) setCustomerPhone(found.LHeadPhone);
    if (errors.customerName) setErrors((p) => ({ ...p, customerName: "" }));
  };

  const capturePhoto = () => {
    const img = webcamRef.current?.getScreenshot();
    if (img) {
      setCapturedImage(img);
      setShowCamera(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!subject.trim()) e.subject = "Subject is required";
    if (!customerName.trim()) e.customerName = "Customer is required";
    if (!issueDetails.trim()) e.issueDetails = "Issue details are required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/tickets/create", {
        method: "POST",
        body: JSON.stringify({
          subject: subject.trim(),
          priority,
          issue_details: issueDetails.trim(),
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          company_id: companyId || null,
          project_id: projectId || null,
          attachment_path: capturedImage ?? null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Ticket created successfully");
        navigate("/ticket/pending");
      } else {
        toast.error(data.error || "Failed to create ticket");
      }
    } catch {
      toast.error("Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Tickets", "Create Ticket"]} />

      <div className="max-w-3xl mx-auto pb-10">
        {/* ── Page header ── */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/ticket")}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              New Support Ticket
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fill in the details below to raise a ticket
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {/* ── Section 1: Context ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
              <Building2 size={13} className="text-muted-foreground" />
              <span className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                Context
              </span>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Company">
                <SearchableSelect
                  options={companyOptions}
                  value={companyId}
                  onChange={(id) => setCompanyId(id)}
                  placeholder="Select company"
                  loading={loadingDropdowns}
                />
              </Field>
              <Field label="Project">
                <SearchableSelect
                  options={projectOptions}
                  value={projectId}
                  onChange={(id) => setProjectId(id)}
                  placeholder="Select project"
                  loading={loadingDropdowns}
                />
              </Field>
            </div>
          </div>

          {/* ── Section 2: Customer ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
              <User size={13} className="text-muted-foreground" />
              <span className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                Customer
              </span>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Customer Name" required error={errors.customerName}>
                <SearchableSelect
                  options={customerOptions}
                  value={
                    customers.find((c) => c.LHeadName === customerName)
                      ? String(
                          customers.find((c) => c.LHeadName === customerName)!
                            .LHeadId,
                        )
                      : ""
                  }
                  onChange={handleCustomerSelect}
                  placeholder="Select customer"
                  loading={loadingCustomers}
                />
              </Field>
              <Field label="Phone Number">
                <div className="relative">
                  <Phone
                    size={13}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Auto-filled from customer"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* ── Section 3: Ticket Details ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
              <FolderOpen size={13} className="text-muted-foreground" />
              <span className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                Ticket Details
              </span>
            </div>
            <div className="p-5 space-y-4">
              {/* Priority selector */}
              <Field label="Priority">
                <div className="grid grid-cols-4 gap-2">
                  {PRIORITIES.map((p) => {
                    const Icon = p.icon;
                    const active = priority === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPriority(p.value)}
                        className={`flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-heading font-medium transition-all
                          ${
                            active
                              ? `${p.bg} ${p.border} ${p.color} ring-2 ${p.ring}`
                              : "border-border text-muted-foreground hover:bg-muted/50"
                          }`}
                      >
                        <Icon size={14} />
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Subject */}
              <Field label="Subject" required error={errors.subject}>
                <input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    if (errors.subject)
                      setErrors((p) => ({ ...p, subject: "" }));
                  }}
                  placeholder="Brief description of the issue"
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground/50 bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all
                    ${errors.subject ? "border-red-400 ring-2 ring-red-400/20" : "border-border"}`}
                />
              </Field>

              {/* Issue details */}
              <Field label="Issue Details" required error={errors.issueDetails}>
                <textarea
                  value={issueDetails}
                  onChange={(e) => {
                    setIssueDetails(e.target.value);
                    if (errors.issueDetails)
                      setErrors((p) => ({ ...p, issueDetails: "" }));
                  }}
                  rows={5}
                  placeholder="Describe the problem in detail — steps to reproduce, error messages, etc."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm text-foreground placeholder:text-muted-foreground/50 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all
                    ${errors.issueDetails ? "border-red-400 ring-2 ring-red-400/20" : "border-border"}`}
                />
              </Field>
            </div>
          </div>

          {/* ── Section 4: Attachment ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
              <Paperclip size={13} className="text-muted-foreground" />
              <span className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                Attachment
              </span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* File upload */}
                <div>
                  <p className="text-[11px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                    File
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) =>
                      setAttachmentFile(e.target.files?.[0] ?? null)
                    }
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-all text-sm text-muted-foreground"
                  >
                    <Paperclip size={14} />
                    {attachmentFile ? (
                      <span className="text-foreground truncate">
                        {attachmentFile.name}
                      </span>
                    ) : (
                      "Choose file…"
                    )}
                  </button>
                </div>

                {/* Camera */}
                <div>
                  <p className="text-[11px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Camera
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCamera(true)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-border hover:bg-muted/30 transition-all text-sm text-muted-foreground"
                  >
                    <Camera size={14} />
                    {capturedImage ? "Retake photo" : "Open camera"}
                  </button>
                </div>
              </div>

              {/* Captured image preview */}
              {capturedImage && (
                <div className="mt-4 relative inline-block">
                  <img
                    src={capturedImage}
                    alt="Captured"
                    className="h-28 w-auto rounded-xl border border-border object-cover"
                  />
                  <button
                    onClick={() => setCapturedImage(null)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Submit ── */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate("/ticket")}
              className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-2"
            >
              <ArrowLeft size={13} /> Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-heading font-semibold hover:opacity-90 disabled:opacity-60 transition-all flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Submitting…
                </>
              ) : (
                <>
                  <Send size={13} /> Submit Ticket
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Camera modal ── */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Camera size={15} className="text-muted-foreground" />
                <h2 className="text-sm font-heading font-semibold text-foreground">
                  Capture Photo
                </h2>
              </div>
              <button
                onClick={() => setShowCamera(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-4">
              <Webcam
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                className="rounded-xl w-full"
                videoConstraints={{ facingMode: "environment" }}
              />
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={capturePhoto}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-emerald-600 text-white text-sm font-heading font-semibold hover:bg-emerald-700 transition-colors"
              >
                <CheckCircle2 size={14} /> Capture
              </button>
              <button
                onClick={() => setShowCamera(false)}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CreateTicket;
