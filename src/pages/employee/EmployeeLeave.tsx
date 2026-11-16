// Leave: this year's balances, the application form, and every application with its status and HR's remark.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyPortalLeave, getPortalLeaveBalances, getPortalLeaves, withdrawPortalLeave } from "@/api/employeePortalApi";
import { Card, Loading, Mark, Note, PageHeader, fieldCls, fmtDate, keyInk, keyLine, labelCls } from "./employeeUi";

const TYPES = ["Casual", "Sick", "Earned", "Unpaid"];
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;

export default function EmployeeLeave() {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const balances = useQuery({ queryKey: ["ep-balances", year], queryFn: () => getPortalLeaveBalances(year), staleTime: 60_000 });
  const leaves = useQuery({ queryKey: ["ep-leaves"], queryFn: getPortalLeaves, staleTime: 60_000 });
  const [form, setForm] = useState({ LeaveType: "Casual", FromDate: "", ToDate: "", Reason: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v, ...(k === "FromDate" && (!f.ToDate || f.ToDate < v) ? { ToDate: v } : {}) }));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ep-leaves"] }); qc.invalidateQueries({ queryKey: ["ep-balances"] }); };

  const apply = useMutation({
    mutationFn: () => applyPortalLeave(form),
    onSuccess: (r) => { toast.success(r.message); setForm({ LeaveType: "Casual", FromDate: "", ToDate: "", Reason: "" }); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const withdraw = useMutation({
    mutationFn: (id: number) => withdrawPortalLeave(id),
    onSuccess: (r) => { toast.success(r.message); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = form.FromDate && form.ToDate && form.Reason.trim();
  const days = form.FromDate && form.ToDate && form.ToDate >= form.FromDate ? daysBetween(form.FromDate, form.ToDate) : 0;

  return (
    <>
      <PageHeader title="Leave" subtitle={`Balances for ${year}, applications and their approval status`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {(balances.data?.Balances ?? []).map((b) => (
          <div key={b.LeaveType} className="ep-card p-4">
            <p className={labelCls}>{b.LeaveType}</p>
            {b.Entitled == null ? (
              <><p className="font-heading text-2xl font-bold mt-1 tabular-nums">{Number(b.Used)}</p><p className="text-xs text-muted-foreground">days taken · no limit</p></>
            ) : (
              <><p className="font-heading text-2xl font-bold mt-1 tabular-nums">{b.Balance}<span className="text-sm text-muted-foreground font-normal"> / {b.Entitled}</span></p>
                <p className="text-xs text-muted-foreground">{Number(b.Used)} taken{Number(b.Pending) ? ` · ${Number(b.Pending)} pending` : ""}</p></>
            )}
          </div>
        ))}
        {balances.isLoading && <Loading />}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Card title="Apply for leave" className="lg:col-span-2 self-start">
          <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) apply.mutate(); }}>
            <div><label className={labelCls} htmlFor="lv-type">Leave type</label>
              <select id="lv-type" className={fieldCls} value={form.LeaveType} onChange={(e) => set("LeaveType", e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls} htmlFor="lv-from">From</label><input id="lv-from" type="date" className={fieldCls} value={form.FromDate} onChange={(e) => set("FromDate", e.target.value)} /></div>
              <div><label className={labelCls} htmlFor="lv-to">To</label><input id="lv-to" type="date" className={fieldCls} min={form.FromDate} value={form.ToDate} onChange={(e) => set("ToDate", e.target.value)} /></div>
            </div>
            <div><label className={labelCls} htmlFor="lv-reason">Reason</label>
              <textarea id="lv-reason" rows={3} maxLength={500} className={`${fieldCls} h-auto py-2`} value={form.Reason} onChange={(e) => set("Reason", e.target.value)} /></div>
            {days > 0 && <p className="text-xs text-muted-foreground">{days} day{days > 1 ? "s" : ""} (calendar days)</p>}
            <button type="submit" className={keyInk} disabled={!ready || apply.isPending}>{apply.isPending ? "Submitting…" : "Submit application"}</button>
          </form>
        </Card>

        <Card title="My applications" className="lg:col-span-3">
          {leaves.isLoading && <Loading />}
          {leaves.isError && <Note tone="error">{(leaves.error as Error).message}</Note>}
          {leaves.data && leaves.data.length === 0 && <Note>You haven't applied for any leave yet.</Note>}
          {leaves.data && leaves.data.length > 0 && (
            <ul className="divide-y divide-foreground/15">
              {leaves.data.map((l) => (
                <li key={l.LeaveId} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{l.LeaveType} · {fmtDate(l.FromDate)}{l.FromDate !== l.ToDate ? ` – ${fmtDate(l.ToDate)}` : ""} <span className="text-muted-foreground">({l.TotalDays}d)</span></span>
                    <span className="flex items-center gap-2"><Mark text={l.Status} />
                      {l.Status === "Pending" && <button className={keyLine} onClick={() => withdraw.mutate(l.LeaveId)} disabled={withdraw.isPending}>Withdraw</button>}</span>
                  </div>
                  {l.Reason && <p className="text-muted-foreground mt-1">{l.Reason}</p>}
                  {l.HrRemarks && <p className="mt-1"><span className={labelCls}>HR remark </span>{l.HrRemarks}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
