import { useState } from "react";
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
import { CheckCircle2, SendHorizonal, XCircle, Loader2 } from "lucide-react";

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

function isApprover(): boolean {
  const role = getUserRole();
  return role !== null && APPROVER_ROLES.includes(role);
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface ApprovalActionsProps {
  status: string | null | undefined;
  recordId: number | string;
  endpoint: string; // e.g. "/api/purchase-orders"
  onSuccess?: (action: "submit" | "approve" | "reject") => void;
  className?: string;
  /** When true, only the Submit button is shown. Approve/Reject are reserved
   *  for the Admin Approval Inbox and will not render on this component. */
  submitOnly?: boolean;
}

export function ApprovalActions({
  status,
  recordId,
  endpoint,
  onSuccess,
  className,
  submitOnly = false,
}: ApprovalActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const approver = isApprover();

  // ── Action handler ──────────────────────────────────────────────────────────
  async function handleAction(action: "submit" | "approve" | "reject") {
    setLoading(action);
    try {
      const body = action === "reject" ? { note: rejectNote } : undefined;
      await authFetch(`${endpoint}/${recordId}/${action}`, "PUT", body);
      toast.success(
        action === "submit"
          ? "Submitted for approval"
          : action === "approve"
            ? "Record approved"
            : "Record rejected",
      );
      if (action === "reject") {
        setRejectOpen(false);
        setRejectNote("");
      }
      onSuccess?.(action);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(null);
    }
  }

  // ── Render logic ────────────────────────────────────────────────────────────
  // No actions on terminal states
  if (status === "Approved" || status === "Fully Received") return null;

  const showSubmit =
    status === "Draft" ||
    status === "Issued" ||
    status === "Partially Received";
  const showApproveReject = !submitOnly && status === "Pending" && approver;

  if (!showSubmit && !showApproveReject) return null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {/* Submit button — visible to all users on Draft/Issued */}
      {showSubmit && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
          disabled={loading !== null}
          onClick={() => handleAction("submit")}
        >
          {loading === "submit" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <SendHorizonal className="w-3.5 h-3.5" />
          )}
          Submit for Approval
        </Button>
      )}

      {/* Approve/Reject — visible only to approver roles when Pending */}
      {showApproveReject && (
        <>
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

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
            disabled={loading !== null}
            onClick={() => setRejectOpen(true)}
          >
            <XCircle className="w-3.5 h-3.5" />
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
