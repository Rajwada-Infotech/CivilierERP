import { useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, SendHorizonal, XCircle, Loader2, ClipboardCheck } from "lucide-react";

// ─── Role check ───────────────────────────────────────────────────────────────
// Reads role from JWT stored in localStorage under "token".
function getUserRole(): string | null {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

const APPROVER_ROLES = ["admin", "super_admin", "dba"];

function isApprover(allowedRoles: string[]): boolean {
  const role = getUserRole();
  return role !== null && allowedRoles.includes(role);
}

// ─── fetchWithAuth helper (inline — avoids import path assumptions) ───────────
async function authFetch(url: string, method: string, body?: object) {
  const token = localStorage.getItem("token");
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON body (e.g. 429 plain text) */
  }
  if (!res.ok) {
    if (res.status === 429)
      throw new Error("Server is busy — please try again in a moment.");
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface ApprovalActionsProps {
  status: string | null | undefined;
  recordId: number | string;
  endpoint: string; // e.g. "/api/purchase-orders"
  onSuccess?: (action: "submit" | "approve" | "reject", data?: any) => void;
  className?: string;
  /** When true, only the Submit button is shown. Approve/Reject are reserved
   *  for the Admin Approval Inbox and will not render on this component. */
  submitOnly?: boolean;
  /** Override which roles may see Approve/Reject (only relevant when this
   *  component renders inside the Approval Inbox, i.e. submitOnly=false).
   *  Defaults to the system-wide APPROVER_ROLES. The backend re-checks
   *  independently via approvalService.js's MODULE_APPROVER_ROLE_OVERRIDES —
   *  this only controls whether the buttons render. */
  approverRoles?: string[];
  /** Inserted between recordId and the action verb — e.g. "date" turns the
   *  call into `${endpoint}/${recordId}/date/${action}`. Used when a record
   *  has more than one independent approval gate (e.g. CRM Agreement's
   *  Senior Approval vs. its separate Date Approval) and each needs its own
   *  route. Omit for the default `${endpoint}/${recordId}/${action}`. */
  actionPathSuffix?: string;
  /** When set, replaces the normal one-click Approve button with this
   *  instead — for a record whose /approve route is gated behind a review
   *  step a single inbox click can never satisfy on its own (e.g. CRM
   *  Application's Level-1 verification checklist: the backend rejects
   *  /approve with a 400 until every checklist item is ticked, so offering
   *  a plain Approve button here just produces a guaranteed-failing click).
   *  Reject is unaffected by this — it stays a normal, direct action since
   *  it has no such gate. Only ever affects rendering here; the backend is
   *  still the real authority on whether /approve succeeds. */
  reviewInstead?: { label: string; onClick: () => void };
  /** Mark modules the backend keeps deliberately role-locked (Journal
   *  Voucher, Fund Transfer, Inter-Company Transfer, CRM Agreement Date /
   *  Sales Deed Director — see MODULE_APPROVER_ROLE_OVERRIDES in
   *  approvalService.js). When true, the "approval-inbox" page-right
   *  fallback below is skipped and only approverRoles can unlock the
   *  buttons, mirroring the backend gate exactly. */
  restricted?: boolean;
}

export function ApprovalActions({
  status,
  recordId,
  endpoint,
  onSuccess,
  className,
  submitOnly = false,
  approverRoles = APPROVER_ROLES,
  actionPathSuffix,
  reviewInstead,
  restricted = false,
}: ApprovalActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  // Fallback: holding "edit" on the "approval-inbox" page via Menu Rights
  // also unlocks the buttons — mirrors the backend's transition() gate in
  // approvalService.js. Not consulted for `restricted` modules, which stay
  // locked to approverRoles on both sides.
  const { canEdit: hasApprovalInboxEdit } = usePageRights("approval-inbox");
  const approver =
    isApprover(approverRoles) || (!restricted && hasApprovalInboxEdit);

  // ── Action handler ──────────────────────────────────────────────────────────
  async function handleAction(action: "submit" | "approve" | "reject") {
    setLoading(action);
    try {
      // Send both field spellings the various backend reject routes read —
      // most (crmSalesDeed, crmAgreements, crmNoc, etc.) read `Remarks`,
      // some older ones read `note`. This component is shared across every
      // module's approval inbox, so a single field name here silently
      // breaks rejection wherever the backend expects the other one: typing
      // a reason and confirming would 400 with "remarks are required" no
      // matter what was entered. Sending both is harmless — every route
      // destructures only the one key it actually reads.
      const body =
        action === "reject" ? { note: rejectNote, Remarks: rejectNote } : undefined;
      const path = actionPathSuffix
        ? `${endpoint}/${recordId}/${actionPathSuffix}/${action}`
        : `${endpoint}/${recordId}/${action}`;
      const data = await authFetch(path, "PUT", body);
      if (
        action === "approve" &&
        data?.newStatus &&
        data.newStatus !== "Approved"
      ) {
        // Multi-level workflow: this was only one level of several — the record
        // is still Pending overall, so don't tell the user it's fully approved.
        toast.success(
          data.message ||
            `Level ${data.level} of ${data.totalLevels} approved — awaiting further approval`,
        );
      } else {
        toast.success(
          action === "submit"
            ? "Submitted for approval"
            : action === "approve"
              ? "Record approved"
              : "Record rejected",
        );
      }
      // Some modules' /approve route auto-triggers a follow-on step (e.g. CRM
      // Applications auto-creating a Booking) that can fail independently of
      // the approval itself — the approval still succeeds and stays committed,
      // but the caller needs to know the follow-on didn't happen instead of it
      // being silently dropped here. Surfaced as a warning, not an error, since
      // nothing about the approve action itself failed.
      if (action === "approve" && data?.bookingError) {
        toast.warning(data.bookingError);
      }
      if (action === "approve" && data?.crmWarning) {
        toast.warning(data.crmWarning);
      }
      if (action === "approve" && data?.brokerWarning) {
        toast.warning(data.brokerWarning);
      }
      if (action === "reject") {
        setRejectOpen(false);
        setRejectNote("");
      }
      onSuccess?.(action, data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed";
      // If the record was already approved/rejected by another session, treat it
      // as success so the stale inbox entry is removed and the cache refreshes.
      const alreadyDone =
        /Cannot (approve|reject|submit) from status/i.test(msg) ||
        /already (approved|rejected)/i.test(msg);
      if (alreadyDone && (action === "approve" || action === "reject")) {
        toast.info("Already processed — refreshing inbox.");
        if (action === "reject") {
          setRejectOpen(false);
          setRejectNote("");
        }
        onSuccess?.(action);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(null);
    }
  }

  // ── Render logic ────────────────────────────────────────────────────────────
  // No actions on terminal states
  if (status === "Approved" || status === "Fully Received") return null;

  // Draft is now auto-submitted on creation — no manual submit needed for new records.
  // Re-submit is still available if a record was Rejected.
  const showSubmit =
    status === "Rejected" ||
    status === "Issued" ||
    status === "Partially Received";
  const showApproveReject = !submitOnly && status === "Pending" && approver;

  if (!showSubmit && !showApproveReject) return null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {/* Submit button — visible to all users on Draft/Issued */}
      {showSubmit && (
        <button
          disabled={loading !== null}
          onClick={() => handleAction("submit")}
          title="Submit for Approval"
          className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-all disabled:opacity-50 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm shadow-violet-500/30 hover:from-violet-500 hover:to-indigo-500 hover:shadow-md hover:shadow-violet-500/40 hover:-translate-y-px active:translate-y-0 active:shadow-sm"
        >
          {loading === "submit" ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <SendHorizonal className="w-3 h-3" />
          )}
          Submit
        </button>
      )}

      {/* Approve/Reject — visible only to approver roles when Pending */}
      {showApproveReject && (
        <>
          {reviewInstead ? (
            <Button
              size="sm"
              className="gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white"
              onClick={reviewInstead.onClick}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              {reviewInstead.label}
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={loading !== null}
              onClick={() => handleAction("approve")}
            >
              {loading === "approve" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              Approve
            </Button>
          )}

          <Button
            size="sm"
            className="gap-1.5 bg-red-600 hover:bg-red-700 text-white border-0"
            disabled={loading !== null}
            onClick={() => setRejectOpen(true)}
          >
            {loading === "reject" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            Reject
          </Button>
        </>
      )}

      {/* Rejection note dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Record</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection (optional but recommended)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={loading === "reject"}
              onClick={() => handleAction("reject")}
            >
              {loading === "reject" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              )}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}