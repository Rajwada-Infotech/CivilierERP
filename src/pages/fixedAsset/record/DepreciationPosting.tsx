// Monthly depreciation for one asset: Depreciation Expense A/c Dr / To Accumulated Depreciation A/c.
// The charge is worked out by the server from the asset's SLM / WDV rate.
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { getAssetDepreciation, postAssetDepreciation } from "@/api/fixedAssetApi";
import { Block, DEP_MONTHS, Field, Figures, INP, KEY_INK, LBL, RULE, RULE_SOFT, fmtCur } from "./config";

export function DepreciationPosting({ assetId, canPost }: { assetId: number; canPost: boolean }) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isFetching } = useQuery({
    queryKey: ["fa-depreciation", assetId, year, month],
    queryFn: () => getAssetDepreciation(assetId, year, month),
  });

  const postMut = useMutation({
    mutationFn: () => postAssetDepreciation(assetId, year, month),
    onSuccess: (r) => {
      toast.success(`Depreciation posted: ${r.voucherNo}`);
      qc.invalidateQueries({ queryKey: ["fa-depreciation", assetId] });
      qc.invalidateQueries({ queryKey: ["fixed-asset", assetId] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      qc.invalidateQueries({ queryKey: ["fixed-asset-dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = data?.plan ?? null;
  const dep = plan?.depreciation;
  // Only live entries: a reversed month has no accounting effect and can be posted again.
  const history = (data?.history ?? []).filter((h) => h.Status !== "Reversed");
  const yearOptions = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 4 + i);
  const period = `${DEP_MONTHS[month - 1]} ${year}`;

  return (
    <Block title="Depreciation posting" note={`One entry a month at the asset's ${dep?.method || "SLM / WDV"} rate`}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month" className="w-28">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={INP}>
            {DEP_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Year" className="w-28">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={INP}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        {canPost && plan && !plan.error && !plan.isPosted && (
          <button onClick={() => postMut.mutate()} disabled={postMut.isPending} className={`${KEY_INK} h-10 px-4`}>
            <Check size={13} /> {postMut.isPending ? "Posting…" : `Post ${period}`}
          </button>
        )}
      </div>

      {isFetching && !data ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</p>
      ) : plan?.error ? (
        <p className="flex items-center gap-2 text-xs text-destructive"><AlertCircle size={14} /> {plan.error}</p>
      ) : dep ? (
        <>
          <Figures
            items={[
              { label: "Opening book value", value: fmtCur(dep.openingBookValue) },
              { label: `Depreciation · ${dep.ratePct}% ${dep.method}`, value: fmtCur(dep.depreciationAmount) },
              { label: "Closing book value", value: fmtCur(dep.closingBookValue), tone: "blue" },
              { label: `Accumulated to ${period}`, value: fmtCur(dep.accumulatedDepreciation) },
            ]}
          />
          <div className="overflow-x-auto">
            <p className={`${LBL} mb-2`}>Journal entry · {period}</p>
            <table className="w-full text-sm min-w-[420px]" style={{ border: RULE }}>
              <thead>
                <tr style={{ borderBottom: RULE }}>
                  <th className={`${LBL} px-3 py-2 text-left`}>Account</th>
                  <th className={`${LBL} px-3 py-2 text-center`}>Dr / Cr</th>
                  <th className={`${LBL} px-3 py-2 text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(plan.entries ?? []).map((e, i) => (
                  <tr key={i} style={i ? { borderTop: RULE_SOFT } : undefined}>
                    <td className="px-3 py-2">{e.account}</td>
                    <td className="px-3 py-2 text-center font-heading text-[0.6875rem] font-bold">{e.debit ? "Dr" : "Cr"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCur(e.debit || e.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.isPosted && (
            <p className="text-[0.6875rem] text-muted-foreground">
              Already posted for {period}{plan.voucherRef ? ` · voucher ${plan.voucherRef}` : ""}.
            </p>
          )}
        </>
      ) : null}

      {history.length > 0 && (
        <div className="overflow-x-auto">
          <p className={`${LBL} mb-2`}>Posted so far</p>
          <table className="w-full text-xs min-w-[520px]" style={{ border: RULE }}>
            <thead>
              <tr style={{ borderBottom: RULE }}>
                {["Period", "Voucher", "Opening", "Depreciation", "Closing"].map((h, i) => (
                  <th key={h} className={`${LBL} px-3 py-2 ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.EntryId} style={i ? { borderTop: RULE_SOFT } : undefined}>
                  <td className="px-3 py-1.5">{DEP_MONTHS[h.PeriodMonth - 1]} {h.PeriodYear}</td>
                  <td className="px-3 py-1.5 font-heading tabular-nums">{h.VoucherNo || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(h.OpeningBookValue)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(h.DepreciationAmount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(h.ClosingBookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}
