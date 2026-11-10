import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getPortalApis, savePortalApi, testPortalApi, type PortalApiLink, type PortalApiSettings, type PortalResult } from "@/api/legalPortalApi";
import { FIELD, HEAD, KEY_INK, KEY_LINE, LBL, RULE, SOFT_RULE, TAG, fmtDate } from "./styles";
import { PortalResultView } from "@/components/legal/PortalFetch";

const SAMPLE = { district: "North 24 Parganas", mouza: "Rajarhat", jlNo: "105", rsDag: "418", lrDag: "1376", rsKhatian: "92", lrKhatian: "2215" };

/** API connection for each Government Site Link (Setup → Government Site Links): Land Enquiry / Land page "Fetch". */
export const LandPortalApiSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-portal-apis"], queryFn: getPortalApis });
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3" style={{ borderBottom: RULE }}>
        <p className={HEAD}>Government land site APIs</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Connect a site from Setup → Government Site Links (Banglarbhumi, a paid land-records provider…) to its API. Land Enquiry and the Land page
          then get a <b>Fetch</b> button for it. The key stays on the server.
        </p>
      </div>
      <div className="p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && !data.ready && <p className="text-sm text-amber-600">Run migration 628 on this server to set up site APIs.</p>}
        {data?.ready && !data.links.length && <p className="text-sm text-muted-foreground">No site links yet — add them in Setup → Government Site Links.</p>}
        {data?.ready && data.links.map((l) => (
          <div key={l.LinkId} className="py-2" style={{ borderTop: SOFT_RULE }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{l.LinkLabel}</span>
              <span className="text-xs text-muted-foreground">{l.ServiceType}</span>
              <span className={`${TAG} ${l.IsEnabled ? "border-emerald-600 text-emerald-700" : "border-foreground/30 text-muted-foreground"}`}>
                {l.IsEnabled ? "API on" : l.UrlTemplate ? "API off" : "No API"}
              </span>
              {l.UpdatedAt && <span className="text-[0.6875rem] text-muted-foreground">saved {fmtDate(l.UpdatedAt)}{l.UpdatedByName ? ` by ${l.UpdatedByName}` : ""}</span>}
              <button className={`${KEY_LINE} ml-auto h-7 px-2.5`} onClick={() => setOpen(open === l.LinkId ? null : l.LinkId)}>
                {open === l.LinkId ? "Close" : canEdit ? "Set up API" : "View"}
              </button>
            </div>
            {open === l.LinkId && <PortalForm link={l} placeholders={data.placeholders} canEdit={canEdit} />}
          </div>
        ))}
      </div>
    </div>
  );
};

const PortalForm: React.FC<{ link: PortalApiLink; placeholders: string[]; canEdit: boolean }> = ({ link, placeholders, canEdit }) => {
  const qc = useQueryClient();
  const [f, setF] = useState<PortalApiSettings>({
    IsEnabled: !!link.IsEnabled, Method: link.Method ?? "GET", UrlTemplate: link.UrlTemplate ?? "", AuthType: link.AuthType ?? "None",
    AuthHeader: link.AuthHeader ?? "", Username: link.Username ?? "", Secret: "", BodyTemplate: link.BodyTemplate ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PortalResult | null>(null);
  const set = <K extends keyof PortalApiSettings>(k: K, v: PortalApiSettings[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      toast.success((await savePortalApi(link.LinkId, f)).message);
      set("Secret", "");
      await qc.invalidateQueries({ queryKey: ["legal-portal-apis"] });
      qc.invalidateQueries({ queryKey: ["legal-portal-enabled"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setResult(null);
    try { setResult(await testPortalApi(link.LinkId, SAMPLE)); } catch (e) { toast.error(e instanceof Error ? e.message : "Test failed"); } finally { setBusy(false); }
  };

  return (
    <fieldset disabled={!canEdit || busy} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2 flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={f.IsEnabled} onChange={(e) => set("IsEnabled", e.target.checked)} /> API switched on (shows the Fetch button)
      </label>
      <div className="sm:col-span-2">
        <p className={LBL}>API URL (https)</p>
        <div className="mt-1 flex gap-2">
          <select className={`${FIELD} w-24`} value={f.Method} onChange={(e) => set("Method", e.target.value as "GET" | "POST")}><option>GET</option><option>POST</option></select>
          <input className={FIELD} value={f.UrlTemplate} onChange={(e) => set("UrlTemplate", e.target.value)} placeholder="https://api.example.com/ror?district={district}&mouza={mouza}&dag={lrDag}" />
        </div>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">Land details you can put in: {placeholders.map((p) => `{${p}}`).join(" ")}</p>
      </div>
      {f.Method === "POST" && (
        <div className="sm:col-span-2">
          <p className={LBL}>Request body (JSON)</p>
          <textarea className={`${FIELD} mt-1 h-20 py-1.5 font-mono text-xs`} value={f.BodyTemplate} onChange={(e) => set("BodyTemplate", e.target.value)} placeholder='{"district": "{district}", "mouza": "{mouza}", "dag": "{lrDag}"}' />
        </div>
      )}
      <div>
        <p className={LBL}>Sign-in</p>
        <select className={`${FIELD} mt-1`} value={f.AuthType} onChange={(e) => set("AuthType", e.target.value as PortalApiSettings["AuthType"])}>
          <option value="None">None</option><option value="Header">API key in a header</option><option value="Bearer">Bearer token</option><option value="Basic">Username + password</option>
        </select>
      </div>
      {f.AuthType === "Header" && (
        <div><p className={LBL}>Header name</p><input className={`${FIELD} mt-1`} value={f.AuthHeader} onChange={(e) => set("AuthHeader", e.target.value)} placeholder="x-api-key" /></div>
      )}
      {f.AuthType === "Basic" && (
        <div><p className={LBL}>Username</p><input className={`${FIELD} mt-1`} value={f.Username} onChange={(e) => set("Username", e.target.value)} /></div>
      )}
      {f.AuthType !== "None" && (
        <div>
          <p className={LBL}>{f.AuthType === "Basic" ? "Password" : f.AuthType === "Bearer" ? "Token" : "API key"}</p>
          <input type="password" autoComplete="new-password" className={`${FIELD} mt-1`} value={f.Secret} onChange={(e) => set("Secret", e.target.value)}
            placeholder={link.HasSecret ? "Saved — leave blank to keep" : "Paste it here"} />
        </div>
      )}
      {canEdit && (
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button type="button" className={`${KEY_INK} h-8 px-3`} onClick={save}>Save</button>
          <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={test} disabled={!link.UrlTemplate}>Test with sample land</button>
          {!link.UrlTemplate && <span className="self-center text-[0.6875rem] text-muted-foreground">Save first, then test.</span>}
        </div>
      )}
      {result && <div className="sm:col-span-2"><PortalResultView r={result} /></div>}
    </fieldset>
  );
};
