import React from "react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { MasterPage, type DataChangeEvent, type FieldDef, type RecordWithId } from "@/components/MasterPage"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  getExpenseBookings,
  addExpenseBooking,
  updateExpenseBooking,
  deleteExpenseBooking,
} from "@/api/expenseBookingApi"
import { toast } from "sonner"

interface DbExpenseBooking {
  EId: string
  EProjectName: string | null
  EDocumentType: string | null
  EDocDate: string | null
  EAmount: number | null
  EDocNo: string | null
  EEmiPayment: boolean | null
  EReminder: string | null
  ERemarks: string | null
  EStatus: string | null
  ECompanyName: string | null
}

type ExpenseStatus = "Pending" | "Approved" | "Rejected"

const toPayload = (r: Record<string, unknown>) => ({
  EProjectName:  (r.projectName  as string) || null,
  EDocumentType: (r.documentType as string) || null,
  EDocDate:      (r.docDate      as string) || null,
  EAmount:       r.amount ? Number(r.amount) : null,
  EDocNo:        (r.docNo        as string) || null,
  EEmiPayment:   r.emiPayment === true,
  EReminder:     (r.reminder     as string) || null,
  ERemarks:      (r.remarks      as string) || null,
  EStatus:       (r.status       as string) || "Pending",
  ECompanyName:  (r.companyName  as string) || null,
})

// ── Status badge renderer ──────────────────────────────────────────────────────
function statusRenderer(value: unknown) {
  const v = (value as ExpenseStatus) || "Pending"
  const map: Record<ExpenseStatus, { bg: string; dot: string }> = {
    Pending:  { bg: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",   dot: "bg-amber-500" },
    Approved: { bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    Rejected: { bg: "bg-destructive/10 border-destructive/20 text-destructive",                 dot: "bg-destructive" },
  }
  const s = map[v] ?? map["Pending"]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${s.dot}`} />
      {v}
    </span>
  )
}

// ── Status radio renderer ──────────────────────────────────────────────────────
function StatusRadioRenderer({
  value, onChange, error,
}: {
  value: unknown
  onChange: (v: unknown) => void
  error: boolean
  field: FieldDef
}) {
  const current = (value as ExpenseStatus) || "Pending"
  const options: { value: ExpenseStatus; label: string; color: string; dot: string }[] = [
    { value: "Pending",  label: "Pending",  color: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",         dot: "bg-amber-500" },
    { value: "Approved", label: "Approved", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
    { value: "Rejected", label: "Rejected", color: "border-destructive/40 bg-destructive/10 text-destructive",                       dot: "bg-destructive" },
  ]
  return (
    <div className={`flex gap-2 flex-wrap ${error ? "ring-1 ring-destructive rounded-lg p-1" : ""}`}>
      {options.map(opt => {
        const isSelected = current === opt.value
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-heading transition-all
              ${isSelected ? opt.color + " shadow-sm scale-[1.02]" : "border-border bg-muted text-muted-foreground hover:border-primary/40"}`}
          >
            <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center
              ${isSelected ? "border-current" : "border-muted-foreground/40"}`}>
              {isSelected && <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />}
            </span>
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
const ExpenseBooking: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["expense-bookings"],
    queryFn: getExpenseBookings,
  })

  const dbItems: DbExpenseBooking[] = Array.isArray(dbData) ? dbData : []

  const mappedData = dbItems.map(item => ({
    _id:          item.EId,
    projectName:  item.EProjectName  || "",
    companyName:  item.ECompanyName  || "",
    documentType: item.EDocumentType || "",
    docDate:      item.EDocDate?.slice(0, 10) || "",
    amount:       item.EAmount ?? "",
    docNo:        item.EDocNo        || "",
    emiPayment:   item.EEmiPayment   ?? false,
    reminder:     item.EReminder?.slice(0, 10) || "",
    remarks:      item.ERemarks      || "",
    status:       item.EStatus       || "Pending",
  }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addExpenseBooking(toPayload(event.record))
        toast.success("Expense booked!")
        await queryClient.invalidateQueries({ queryKey: ["expense-bookings"] })
      } catch (err: any) {
        toast.error("Save failed: " + err.message)
      }
    }
    if (event.action === "update") {
      try {
        await updateExpenseBooking(event.id, toPayload(event.record))
        toast.success("Expense updated!")
        await queryClient.invalidateQueries({ queryKey: ["expense-bookings"] })
      } catch (err: any) {
        toast.error("Update failed: " + err.message)
      }
    }
    if (event.action === "delete") {
      try {
        await deleteExpenseBooking(event.id)
        toast.success("Expense deleted!")
        await queryClient.invalidateQueries({ queryKey: ["expense-bookings"] })
      } catch (err: any) {
        toast.error("Delete failed: " + err.message)
      }
    }
  }

  const columnRenderers: Record<string, (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode> = {
    status: (value) => statusRenderer(value),
    amount: (value) => (
      <span className="font-mono text-sm">
        ₹{Number(value || 0).toLocaleString("en-IN")}
      </span>
    ),
    emiPayment: (value) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
        value ? "bg-primary/10 border-primary/20 text-primary" : "bg-muted border-border text-muted-foreground"
      }`}>
        {value ? "Yes" : "No"}
      </span>
    ),
    remarks: (value) => (
      <span className="text-muted-foreground text-xs italic truncate max-w-[140px] block">
        {String(value || "—")}
      </span>
    ),
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>
  if (error)     return <div className="p-6 text-red-500">Failed to load expense bookings.</div>

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Transactions", "Expense Booking"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Expense Booking</h1>
      <MasterPage
        title="Expense"
        fields={[
          { name: "projectName",  label: "Project Name",   type: "select",  required: true, options: ["Civilier Infrastructure Pvt Ltd", "Apex Constructions Ltd", "SiteCraft Engineers", "Raj Builders & Co", "Metro Rail Project"] },
          { name: "companyName",  label: "Company Name",   type: "text" },
          { name: "documentType", label: "Document Type",  type: "select",  required: true, options: ["Invoice", "Bill", "Receipt", "Voucher", "Credit Note", "Debit Note"] },
          { name: "docNo",        label: "Doc No",         type: "text",    required: true, uppercase: true },
          { name: "docDate",      label: "Doc Date",       type: "text",    required: true },
          { name: "amount",       label: "Amount (₹)",     type: "number",  required: true },
          { name: "emiPayment",   label: "EMI Payment",    type: "toggle",  defaultValue: false },
          { name: "reminder",     label: "Reminder Date",  type: "text" },
          { name: "status",       label: "Status",         type: "custom",  required: true, defaultValue: "Pending", render: StatusRadioRenderer as FieldDef["render"] },
          { name: "remarks",      label: "Remarks",        type: "textarea", fullWidth: true },
        ]}
        columns={[
          { key: "docNo",        label: "Doc No" },
          { key: "projectName",  label: "Project",       hideOnMobile: true },
          { key: "documentType", label: "Type",          hideOnMobile: true },
          { key: "docDate",      label: "Date" },
          { key: "amount",       label: "Amount" },
          { key: "emiPayment",   label: "EMI",           hideOnMobile: true },
          { key: "status",       label: "Status" },
          { key: "remarks",      label: "Remarks",       hideOnMobile: true },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default ExpenseBooking