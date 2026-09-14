import Webcam from "react-webcam";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TicketShell } from "@/components/ticket/TicketShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { invalidateTicketQueries } from "@/lib/ticketQuerySync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  FolderOpen,
  Loader2,
  Paperclip,
  Phone,
  Send,
  ShieldAlert,
  User,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    value: "Urgent" as const,
    label: "Urgent",
    color: "text-red-600",
    bg: "bg-red-500/10",
    border: "border-red-400/30",
    ring: "ring-red-400/40",
    icon: ShieldAlert,
  },
  {
    value: "High" as const,
    label: "High",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    border: "border-orange-400/30",
    ring: "ring-orange-400/40",
    icon: AlertCircle,
  },
  {
    value: "Medium" as const,
    label: "Medium",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-400/30",
    ring: "ring-amber-400/40",
    icon: AlertCircle,
  },
  {
    value: "Low" as const,
    label: "Low",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-400/30",
    ring: "ring-blue-400/40",
    icon: AlertCircle,
  },
];

// ─── Combobox (shadcn Popover + Command) ──────────────────────────────────────

function Combobox({
  options,
  value,
  onSelect,
  placeholder,
  loading,
  error,
}: {
  options: { value: string; label: string; sub?: string }[];
  value?: string;
  onSelect: (value: string, label: string) => void;
  placeholder: string;
  loading?: boolean;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal h-10",
            !selected && "text-muted-foreground",
            error && "border-red-400 ring-2 ring-red-400/20",
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {options.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.label}
                      onSelect={() => {
                        onSelect(opt.value, opt.label);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === opt.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex flex-col">
                        {opt.label}
                        {opt.sub && (
                          <span className="text-xs text-muted-foreground">
                            {opt.sub}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <Icon size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const CreateTicket = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rights = usePageRights("tickets");

  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [priority, setPriority] = useState<
    "Low" | "Medium" | "High" | "Urgent"
  >("Medium");
  const [subject, setSubject] = useState("");
  const [issueDetails, setIssueDetails] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
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
      return res.json().catch(() => ({})) as Promise<{
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
      const data = await res.json().catch(() => ({}));
      return (Array.isArray(data) ? data : []) as CustomerOption[];
    },
    staleTime: 5 * 60_000,
  });

  const companyOptions = (dropdownData?.companies ?? []).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));
  const projectOptions = (dropdownData?.projects ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
  }));
  const customerOptions = customers.map((c) => ({
    value: String(c.LHeadId),
    label: c.LHeadName,
    sub: c.LHeadPhone ?? undefined,
  }));

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleCustomerSelect = (id: string, label: string) => {
    setCustomerId(id);
    setCustomerName(label);
    const found = customers.find((c) => String(c.LHeadId) === id);
    if (found?.LHeadPhone) setCustomerPhone(found.LHeadPhone);
    if (errors.customerName) setErrors((p) => ({ ...p, customerName: "" }));
  };

  const capturePhoto = () => {
    const img = webcamRef.current?.getScreenshot();
    if (img) {
      setCapturedImages((prev) => [...prev, img]);
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
      // Step 1 — create the ticket first so we have a ticketId to attach files to
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
        }),
      });
      const data = await res.json();
      if (!data.success || !data.ticketId) {
        toast.error(data.error || "Failed to create ticket");
        return;
      }
      const ticketId: number = data.ticketId;

      // Step 2 — upload files (if any) now that we have the ticketId
      // The backend links each attachment to this ticket automatically.
      const token =
        localStorage.getItem("token") || sessionStorage.getItem("token") || "";

      const uploadOne = async (formData: FormData): Promise<void> => {
        formData.append("ticketId", String(ticketId));
        const uploadRes = await fetch("/api/tickets/upload", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          throw new Error(err.error ?? "Failed to upload attachment");
        }
      };

      for (const file of attachmentFiles) {
        const fd = new FormData();
        fd.append("file", file);
        await uploadOne(fd);
      }

      for (let i = 0; i < capturedImages.length; i++) {
        const blob = await fetch(capturedImages[i]).then((r) => r.blob());
        const fd = new FormData();
        fd.append("file", blob, `capture-${i + 1}.jpg`);
        await uploadOne(fd);
      }

      invalidateTicketQueries(queryClient);
      toast.success("Ticket created successfully");
      navigate("/ticket/pending");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <Breadcrumbs items={["Tickets", "Create Ticket"]} />
    <TicketShell
      title="New Support Ticket"
      subtitle="Fill in the details below to raise a ticket"
      icon={Send}
    >
      <div className="space-y-5">
          {/* ── Section 1: Context ── */}
          <Section icon={Building2} title="Context">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Company">
                <Combobox
                  options={companyOptions}
                  value={companyId}
                  onSelect={(id) => setCompanyId(id)}
                  placeholder="Select company"
                  loading={loadingDropdowns}
                />
              </Field>
              <Field label="Project">
                <Combobox
                  options={projectOptions}
                  value={projectId}
                  onSelect={(id) => setProjectId(id)}
                  placeholder="Select project"
                  loading={loadingDropdowns}
                />
              </Field>
            </div>
          </Section>

          {/* ── Section 2: Customer ── */}
          <Section icon={User} title="Customer">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Customer Name" required error={errors.customerName}>
                <Combobox
                  options={customerOptions}
                  value={customerId}
                  onSelect={handleCustomerSelect}
                  placeholder="Select customer"
                  loading={loadingCustomers}
                  error={!!errors.customerName}
                />
              </Field>
              <Field label="Phone Number">
                <div className="relative">
                  <Phone
                    size={13}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Auto-filled from customer"
                    className="pl-9"
                  />
                </div>
              </Field>
            </div>
          </Section>

          {/* ── Section 3: Ticket Details ── */}
          <Section icon={FolderOpen} title="Ticket Details">
            <div className="space-y-4">
              {/* Priority */}
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
                        className={cn(
                          "flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all",
                          active
                            ? `${p.bg} ${p.border} ${p.color} ring-2 ${p.ring}`
                            : "border-border text-muted-foreground hover:bg-muted/50",
                        )}
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
                <Input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    if (errors.subject)
                      setErrors((p) => ({ ...p, subject: "" }));
                  }}
                  placeholder="Brief description of the issue"
                  className={
                    errors.subject
                      ? "border-red-400 ring-2 ring-red-400/20"
                      : ""
                  }
                />
              </Field>

              {/* Issue details */}
              <Field label="Issue Details" required error={errors.issueDetails}>
                <Textarea
                  value={issueDetails}
                  onChange={(e) => {
                    setIssueDetails(e.target.value);
                    if (errors.issueDetails)
                      setErrors((p) => ({ ...p, issueDetails: "" }));
                  }}
                  rows={5}
                  placeholder="Describe the problem in detail — steps to reproduce, error messages, etc."
                  className={cn(
                    "resize-none",
                    errors.issueDetails
                      ? "border-red-400 ring-2 ring-red-400/20"
                      : "",
                  )}
                />
              </Field>
            </div>
          </Section>

          {/* ── Section 4: Attachment ── */}
          <Section icon={Paperclip} title="Attachment">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* File upload */}
              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Files
                </Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    setAttachmentFiles((prev) => {
                      const names = new Set(prev.map((f) => f.name));
                      return [
                        ...prev,
                        ...picked.filter((f) => !names.has(f.name)),
                      ];
                    });
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-all text-sm text-muted-foreground"
                >
                  <Paperclip size={14} />
                  {attachmentFiles.length > 0
                    ? `${attachmentFiles.length} file${attachmentFiles.length > 1 ? "s" : ""} selected — add more`
                    : "Choose files…"}
                </button>
              </div>

              {/* Camera */}
              <div>
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Camera
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setCameraError(null);
                    setShowCamera(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-border hover:bg-muted/30 transition-all text-sm text-muted-foreground"
                >
                  <Camera size={14} />
                  {capturedImages.length > 0
                    ? `${capturedImages.length} photo${capturedImages.length > 1 ? "s" : ""} captured — take more`
                    : "Open camera"}
                </button>
              </div>
            </div>

            {/* Previews */}
            {(attachmentFiles.length > 0 || capturedImages.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-4">
                {attachmentFiles.map((file, i) => (
                  <Badge
                    key={`file-${i}`}
                    variant="secondary"
                    className="gap-1.5 pr-1"
                  >
                    <Paperclip size={11} />
                    <span className="max-w-[160px] truncate">{file.name}</span>
                    <button
                      onClick={() =>
                        setAttachmentFiles((prev) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                      }
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </Badge>
                ))}
                {capturedImages.map((img, i) => (
                  <div key={`cap-${i}`} className="relative inline-block">
                    <img
                      src={img}
                      alt={`Capture ${i + 1}`}
                      className="h-20 w-auto rounded-lg border border-border object-cover"
                    />
                    <button
                      onClick={() =>
                        setCapturedImages((prev) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                      }
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Submit row ── */}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => navigate("/ticket")}
              className="gap-2"
            >
              <ArrowLeft size={13} /> Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="gap-2 px-6"
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
            </Button>
          </div>
        </div>
      {/* ── Camera modal ── */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Camera size={15} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Capture Photo
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowCamera(false)}
              >
                <XCircle size={15} />
              </Button>
            </div>

            <div className="p-4">
              {cameraError ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                  <XCircle size={32} className="text-red-400" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <p className="text-xs text-muted-foreground/60">
                    Please allow camera access in your browser settings and try
                    again.
                  </p>
                </div>
              ) : (
                <Webcam
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  className="rounded-xl w-full"
                  width={640}
                  height={480}
                  mirrored={true}
                  videoConstraints={{
                    width: 640,
                    height: 480,
                    facingMode: { ideal: "environment" },
                  }}
                  onUserMediaError={(err) => {
                    const msg =
                      err instanceof Error ? err.message : String(err);
                    setCameraError(
                      msg.toLowerCase().includes("permission")
                        ? "Camera permission denied."
                        : "Could not access camera: " + msg,
                    );
                  }}
                />
              )}
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <Button
                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={capturePhoto}
                disabled={!!cameraError}
              >
                <CheckCircle2 size={14} /> Capture
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowCamera(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </TicketShell>
    </>
  );
};

export default CreateTicket;