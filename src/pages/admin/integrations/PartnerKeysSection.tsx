import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SheetMark } from "@/components/sheet/Sheet";
import { apiUrl } from "@/lib/apiBase";
import { createPartnerKey, getPartnerKeys, revokePartnerKey } from "@/api/integrationsApi";
import { FIELD, HEAD, KEY_INK, KEY_LINE, LBL, RULE, SOFT_RULE, TAG, fmtDate } from "./styles";

const QK = ["partner-api-keys"];
const ENDPOINT_PATH = "/api/public/partner-leads";

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`${KEY_LINE} h-8 px-2.5 shrink-0`} aria-label={label}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => toast.error("Copy failed — select and copy it"))}>
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
    </button>
  );
};

/** API keys a channel partner's own system uses to send leads straight into Sales Automation. */
export const PartnerKeysSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: getPartnerKeys });
  const [partnerId, setPartnerId] = useState("");
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ key: string; partnerName: string } | null>(null);
  const endpoint = new URL(apiUrl(ENDPOINT_PATH), window.location.origin).href;

  const create = useMutation({
    mutationFn: () => createPartnerKey(Number(partnerId), label.trim()),
    onSuccess: (r) => { setFresh(r); setPartnerId(""); setLabel(""); qc.invalidateQueries({ queryKey: QK }); },
  });
  const revoke = useMutation({
    mutationFn: revokePartnerKey,
    onSuccess: () => { toast.success("Key revoked — it stops working now"); qc.invalidateQueries({ queryKey: QK }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const example = `curl -X POST ${endpoint} \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: <the partner's key>" \\
  -d '{"CustomerName":"Asha Rao","Mobile":"9876543210","Email":"asha@example.com","CustomerRemarks":"2BHK, ready to move"}'`;

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: RULE }}>
        <span className={HEAD}>Channel partner lead API</span>
        <Link to="/sales-automation/channel-partners" className={`${KEY_LINE} h-8 px-3`}>Channel partners</Link>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          A partner's own system sends leads here with its key. Each lead is checked like a manual entry (a mobile already
          in Sales Automation is turned away), tagged to the partner as a Referral, and the customer gets the welcome message.
        </p>

        {fresh && (
          <div className="border border-foreground p-3 space-y-2" role="status">
            <p className="text-sm text-foreground font-medium">New key for {fresh.partnerName} — copy it now; it is never shown again.</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 min-w-0 truncate text-xs bg-muted px-2 py-2 font-mono">{fresh.key}</code>
              <CopyButton text={fresh.key} label="Copy the new key" />
            </div>
            <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => setFresh(null)}>I've saved it</button>
          </div>
        )}

        {canEdit && (
          <form className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (partnerId) create.mutate(); }}>
            <div>
              <label className={`${LBL} block mb-1`} htmlFor="pk-partner">Partner</label>
              <select id="pk-partner" className={FIELD} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">Choose a channel partner</option>
                {data?.partners.map((p) => <option key={p.Id} value={p.Id}>{p.Name}{p.PartnerCode ? ` (${p.PartnerCode})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={`${LBL} block mb-1`} htmlFor="pk-label">Label</label>
              <input id="pk-label" className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Their CRM" maxLength={100} />
            </div>
            <button type="submit" className={`${KEY_INK} h-9 px-3`} disabled={!partnerId || create.isPending}>
              {create.isPending ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Make key
            </button>
            {create.isError && <p className="md:col-span-3 text-xs text-destructive">{(create.error as Error).message}</p>}
          </form>
        )}

        {error ? <p className="text-sm text-destructive">{(error as Error).message}</p>
          : isLoading ? <div className="h-24 border border-dashed border-foreground/30 animate-pulse" />
          : !data?.keys.length ? <p className="text-sm text-muted-foreground">No keys yet.</p>
          : (
            <div className="overflow-x-auto" style={{ border: SOFT_RULE }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ borderBottom: SOFT_RULE }}>
                    {["Partner", "Key", "Leads received", "Last used", "Made", ""].map((h) => <th key={h} className={`${LBL} px-3 py-2 font-semibold`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.keys.map((k) => (
                    <tr key={k.Id} style={{ borderBottom: SOFT_RULE }} className={k.IsActive ? "" : "opacity-60"}>
                      <td className="px-3 py-2">
                        <div className="text-foreground">{k.PartnerName}</div>
                        {k.Label && <div className="text-xs text-muted-foreground">{k.Label}</div>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{k.KeyPrefix}…</td>
                      <td className="px-3 py-2 tabular-nums">{k.LeadsReceived}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDate(k.LastUsedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="tabular-nums">{fmtDate(k.CreatedAt)}</div>
                        {k.CreatedByName && <div className="text-xs text-muted-foreground">{k.CreatedByName}</div>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {k.IsActive ? (
                          canEdit && (
                            <button type="button" className={`${KEY_LINE} h-8 px-2.5`} disabled={revoke.isPending}
                              onClick={() => { if (window.confirm(`Revoke this key for ${k.PartnerName}? Their system stops sending leads until they get a new key.`)) revoke.mutate(k.Id); }}>
                              Revoke
                            </button>
                          )
                        ) : (
                          <span className={`${TAG} text-muted-foreground border-foreground/40`} title={k.RevokedByName ? `By ${k.RevokedByName}` : undefined}>
                            Revoked {fmtDate(k.RevokedAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        {data?.api && <details className="text-sm">
          <summary className="cursor-pointer text-foreground font-medium">How a partner sends leads</summary>
          <div className="mt-2 space-y-2">
            <div className="flex gap-2 items-center">
              <code className="flex-1 min-w-0 truncate text-xs bg-muted px-2 py-2 font-mono">POST {endpoint}</code>
              <CopyButton text={endpoint} label="Copy the address" />
            </div>
            <pre className="text-xs bg-muted p-3 overflow-x-auto font-mono">{example}</pre>
            <p className="text-xs text-muted-foreground">
              Fields: {data.api.fields.map((f) => (data.api.required.includes(f) ? `${f} (required)` : f)).join(", ")}.
              Up to {data.api.maxBatch} at once as {"{ \"leads\": [ … ] }"}.
              Replies: 201 added · 409 mobile already a lead · 400 something missing · 401 key wrong or revoked.
            </p>
            <SheetMark text={`Up to ${data.api.requestsPerMinute} requests a minute per key`} tone="waiting" />
          </div>
        </details>}
      </div>
    </div>
  );
};
