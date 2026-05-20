import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
  ArrowLeft,
  Loader2,
  Send,
  Paperclip,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateTicketPayload {
  subject: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  issue_details: string;
  customer_name: string;
  customer_phone: string;
}

// ─── CreateTicket form ────────────────────────────────────────────────────────

const CreateTicket: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<CreateTicketPayload>({
    subject: "",
    priority: "Medium",
    issue_details: "",
    customer_name: "",
    customer_phone: "",
  });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<CreateTicketPayload>>({});

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    const errs: Partial<CreateTicketPayload> = {};
    if (!form.subject.trim()) errs.subject = "Subject is required";
    if (!form.customer_name.trim()) errs.customer_name = "Name is required";
    if (!form.issue_details.trim())
      errs.issue_details = "Issue details are required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Submit mutation ─────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async (payload: CreateTicketPayload) => {
      let body: BodyInit;
      let headers: Record<string, string> = {};

      if (attachment) {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        fd.append("attachment", attachment);
        body = fd;
      } else {
        body = JSON.stringify(payload);
        headers["Content-Type"] = "application/json";
      }

      const res = await fetchWithAuth("/api/tickets", {
        method: "POST",
        headers,
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Ticket created successfully!");
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      navigate("/ticket/my-tickets");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create ticket");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    mutation.mutate(form);
  };

  const set = (field: keyof CreateTicketPayload, value: string) => {
    setForm((p) => ({ ...p, [field]: value }));
    if (errors[field]) setErrors((p) => ({ ...p, [field]: undefined }));
  };

  return (
    <>
      <Breadcrumbs items={["Tickets", "Create Ticket"]} />

      <div className="max-w-2xl mx-auto pb-10 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/ticket")}
          >
            <ArrowLeft size={14} />
          </Button>
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Create Ticket
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submit a new support request
            </p>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          {/* Subject */}
          <div className="space-y-1.5">
            <label className="text-sm font-heading font-medium text-foreground">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
              placeholder="Brief summary of your issue"
              className={`w-full px-3 py-2.5 rounded-xl border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                errors.subject ? "border-red-400" : "border-border"
              }`}
            />
            {errors.subject && (
              <p className="text-xs text-red-500">{errors.subject}</p>
            )}
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="text-sm font-heading font-medium text-foreground">
              Priority
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(["Low", "Medium", "High", "Urgent"] as const).map((p) => {
                const colors: Record<string, string> = {
                  Low: "border-blue-400/30 text-blue-600 bg-blue-500/10",
                  Medium: "border-amber-400/30 text-amber-600 bg-amber-500/10",
                  High: "border-orange-400/30 text-orange-600 bg-orange-500/10",
                  Urgent: "border-red-400/30 text-red-600 bg-red-500/10",
                };
                const active = form.priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => set("priority", p)}
                    className={`py-2 rounded-xl border text-xs font-heading font-medium transition-all ${
                      active
                        ? colors[p]
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Customer Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-heading font-medium text-foreground">
              Your Name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.customer_name}
              onChange={(e) => set("customer_name", e.target.value)}
              placeholder="Full name"
              className={`w-full px-3 py-2.5 rounded-xl border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                errors.customer_name ? "border-red-400" : "border-border"
              }`}
            />
            {errors.customer_name && (
              <p className="text-xs text-red-500">{errors.customer_name}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <label className="text-sm font-heading font-medium text-foreground">
              Phone Number
            </label>
            <input
              value={form.customer_phone}
              onChange={(e) => set("customer_phone", e.target.value)}
              placeholder="Contact number (optional)"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>

          {/* Issue Details */}
          <div className="space-y-1.5">
            <label className="text-sm font-heading font-medium text-foreground">
              Issue Details <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.issue_details}
              onChange={(e) => set("issue_details", e.target.value)}
              placeholder="Describe your issue in detail…"
              rows={5}
              className={`w-full px-3 py-2.5 rounded-xl border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none ${
                errors.issue_details ? "border-red-400" : "border-border"
              }`}
            />
            {errors.issue_details && (
              <p className="text-xs text-red-500">{errors.issue_details}</p>
            )}
          </div>

          {/* Attachment */}
          <div className="space-y-1.5">
            <label className="text-sm font-heading font-medium text-foreground">
              Attachment
            </label>
            {attachment ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-muted/30">
                <Paperclip size={13} className="text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground flex-1 truncate">
                  {attachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border hover:bg-muted/30 cursor-pointer transition-colors">
                <Paperclip size={13} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Click to attach a file (optional)
                </span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => navigate("/ticket")}
              className="px-4 py-2 rounded-xl border border-border text-sm font-heading text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-heading font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {mutation.isPending ? "Submitting…" : "Submit Ticket"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CreateTicket;