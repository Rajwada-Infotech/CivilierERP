// One Work Done entry opened: what was certified, against which work order, and its approval.
import React from "react";
import { ArrowLeft, PenSquare, Printer } from "lucide-react";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { type WorkDoneEntry, Block, KEY_INK, KEY_LINE, LBL, RULE, canEditWorkDone, fmt, fmtDate } from "./config";

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className={`${LBL} mb-1`}>{label}</p>
    <p className="text-sm font-medium text-foreground">{value || "—"}</p>
  </div>
);

export const WorkDoneDetail: React.FC<{
  record: WorkDoneEntry;
  canEdit: boolean;
  canPrint: boolean;
  onBack: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onRefresh: () => void;
}> = ({ record: r, canEdit, canPrint, onBack, onEdit, onPrint, onRefresh }) => (
  <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button onClick={onBack} className={`${KEY_LINE} h-9 px-3`}>
        <ArrowLeft size={13} /> Back to list
      </button>
      <div className="flex flex-wrap items-center gap-2">
        {canPrint && (
          <button onClick={onPrint} className={`${KEY_LINE} h-9 px-3`}>
            <Printer size={13} /> Print
          </button>
        )}
        {canEdit && canEditWorkDone(r.Status) && (
          <button onClick={onEdit} className={`${KEY_INK} h-9 px-4`}>
            <PenSquare size={13} /> Edit
          </button>
        )}
        <ApprovalActions status={r.Status} recordId={r.ID} endpoint="/api/engineering/work-done" onSuccess={onRefresh} submitOnly />
      </div>
    </div>

    <div className="bg-card px-5 py-4 flex flex-wrap items-center justify-between gap-3" style={{ border: RULE }}>
      <div>
        <p className={LBL}>Work done</p>
        <p className="font-heading text-xl font-bold tabular-nums text-foreground">{r.DocNo || `#${r.ID}`}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Created by {r.CreatedBy || "—"} · {fmtDate(r.CreatedAt)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <SheetMark text={r.Status || "Draft"} tone={statusTone(r.Status || "Draft")} />
        <ApprovalStatusChain table="WorkDone" recordId={r.ID} />
      </div>
    </div>

    <Block title="Project">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
        <Row label="Company" value={r.CompanyName} />
        <Row label="Project / site" value={r.ProjectName} />
        <Row label="Financial year" value={r.FinYear} />
        <Row label="Date" value={fmtDate(r.DocDate)} />
        <Row label="Work order" value={r.WorkOrderNo} />
        <Row label="Contractor" value={r.ContractorName || r.SupplierName} />
      </div>
    </Block>

    <Block title="Work done">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-5">
        <Row label="Period from" value={fmtDate(r.PeriodFrom)} />
        <Row label="Period to" value={fmtDate(r.PeriodTo)} />
        <Row label="Quantity" value={r.QuantityDone != null ? String(r.QuantityDone) : ""} />
        <Row label="Unit" value={r.Unit} />
        <Row label="Rate per unit" value={fmt(r.RatePerUnit)} />
      </div>
      {r.DescriptionOfWork && (
        <div>
          <p className={`${LBL} mb-1`}>Description of work</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{r.DescriptionOfWork}</p>
        </div>
      )}
      <div className="grid grid-cols-3" style={{ border: RULE }}>
        {[
          { label: "Gross", value: fmt(r.GrossAmount) },
          { label: "Deductions", value: `− ${fmt(r.Deductions)}` },
          { label: "Certified", value: fmt(r.CertifiedAmount) },
        ].map((x, i) => (
          <div key={x.label} className="px-4 py-3" style={i ? { borderLeft: "1px solid hsl(var(--foreground) / 0.2)" } : undefined}>
            <p className={LBL}>{x.label}</p>
            <p className="font-heading text-lg font-bold tabular-nums mt-0.5 text-foreground">{x.value}</p>
          </div>
        ))}
      </div>
    </Block>

    {r.Remarks && (
      <Block title="Remarks">
        <p className="text-sm text-foreground whitespace-pre-wrap">{r.Remarks}</p>
      </Block>
    )}
  </div>
);
