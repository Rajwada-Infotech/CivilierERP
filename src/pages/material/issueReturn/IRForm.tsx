import { ArrowLeft, ChevronDown, RotateCcw, Save, X } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { FieldLabel, HEAD, KEY_INK, KEY_LINE, LBL, RULE, TH, ACT, fmtQty, inp, sel } from "./config";
import type { IssueReturnState } from "./useIssueReturn";

// A new or edited return: which issue it returns, and how much of each line comes back.
export function IRForm({ m }: { m: IssueReturnState }) {
  const { editId, form, setForm, companies, filteredProjects, issues, issueItems, saveMut, loadIssueItems, setItemQty, removeItem, backToList, handleSave } = m;
  const chevron = <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />;

  return (
    <div className="space-y-5">
      {/* Title bar */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-3 px-5 py-3.5" style={{ border: RULE }}>
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={backToList} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
            <ArrowLeft size={13} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0">
            <p className={LBL}>Issue return</p>
            <h2 className="font-heading text-base font-bold tracking-tight text-foreground truncate">{editId ? "Edit return" : "New return"}</h2>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={backToList} className={`${KEY_LINE} h-9 px-4`}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saveMut.isPending} className={`${KEY_INK} h-9 px-5`}>
            <Save size={13} /> {saveMut.isPending ? "Saving…" : editId ? "Update" : "Save"}
          </button>
        </div>
      </div>

      {/* Header details */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <h3 className={HEAD}>Header details</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <FieldLabel required>Return date</FieldLabel>
              <DateInput className={inp} value={form.ReturnDate} onChange={(e) => setForm((f) => ({ ...f, ReturnDate: e.target.value }))} />
            </div>
            <div>
              <FieldLabel>Company</FieldLabel>
              <div className="relative">
                <select className={sel} value={form.CompanyId} onChange={(e) => setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", IssueId: "", items: [] }))}>
                  <option value="">— Select company —</option>
                  {(companies as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                {chevron}
              </div>
            </div>
            <div>
              <FieldLabel>Project / site</FieldLabel>
              <div className="relative">
                <select className={sel} value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, IssueId: "", items: [] }))}>
                  <option value="">— Select project —</option>
                  {(filteredProjects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {chevron}
              </div>
            </div>
            <div>
              <FieldLabel required>Issue being returned</FieldLabel>
              <div className="relative">
                <select className={sel} value={form.IssueId} onChange={(e) => setForm((f) => ({ ...f, IssueId: e.target.value, items: [] }))}>
                  <option value="">— Select issue —</option>
                  {issues.map((i) => (
                    <option key={i.IssueId} value={i.IssueId}>
                      {i.DocNo} — {i.IssueDate?.split("T")[0]}
                    </option>
                  ))}
                </select>
                {chevron}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Reason</FieldLabel>
              <input className={inp} placeholder="Reason for return…" value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} />
            </div>
            <div>
              <FieldLabel>Remarks</FieldLabel>
              <input className={inp} placeholder="Additional remarks…" value={form.Remarks} onChange={(e) => setForm((f) => ({ ...f, Remarks: e.target.value }))} />
            </div>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderBottom: RULE }}>
          <h3 className={HEAD}>
            Return items {form.items.length > 0 && <span className="ml-1 font-normal tabular-nums text-muted-foreground">{form.items.length}</span>}
          </h3>
          {form.IssueId && issueItems.length > 0 && (
            <button onClick={loadIssueItems} className={`${KEY_LINE} h-8 px-3`} title="Put back every line still out on this issue">
              <RotateCcw size={11} /> Load from issue
            </button>
          )}
        </div>

        {form.items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-foreground">No items</p>
            <p className="text-xs text-muted-foreground mt-1">
              {!form.IssueId
                ? "Select the issue being returned first."
                : issueItems.length && issueItems.every((ii) => Number(ii.Quantity) - Number(ii.Returned ?? 0) <= 0)
                  ? "Everything on this issue has already been returned."
                  : 'Click "Load from issue" to pull its items.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr style={{ borderBottom: RULE }}>
                  <th className={TH} style={{ width: "40%" }}>Item</th>
                  <th className={`${TH} !text-right`}>Issued</th>
                  <th className={`${TH} !text-right`}>Still out</th>
                  <th className={`${TH} !text-right`}>Return</th>
                  <th className={TH}>UOM</th>
                  <th className={TH} style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/10">
                {form.items.map((item, idx) => {
                  const over = item.maxQty != null && item.Quantity > item.maxQty;
                  return (
                    <tr key={idx}>
                      <td className="px-4 py-2.5 text-sm font-medium truncate">{item.ItemName}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground text-right tabular-nums">{item.issued != null ? fmtQty(item.issued) : "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground text-right tabular-nums">{item.maxQty != null ? fmtQty(item.maxQty) : "—"}</td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          min={0}
                          max={item.maxQty}
                          step="any"
                          className={`${inp} !py-1.5 text-right tabular-nums ${over ? "!border-destructive text-destructive" : ""}`}
                          value={item.Quantity}
                          onChange={(e) => setItemQty(idx, parseFloat(e.target.value) || 0)}
                          aria-invalid={over}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.UOMSymbol || "—"}</td>
                      <td className="px-2 py-2.5 text-right">
                        <button onClick={() => removeItem(idx)} className={`${ACT} hover:text-destructive hover:border-destructive`} title="Remove this line">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
