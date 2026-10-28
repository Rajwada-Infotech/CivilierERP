import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap, Settings2, X } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { DateInput } from "@/components/ui/date-input";
import {
  getConnections, saveConnectionCredentials, testConnection,
  type ConnectionProvider, type IntegrationConnection,
} from "@/api/integrationsApi";
import { FIELD, HEAD, KEY_INK, KEY_LINE, LBL, RULE, SOFT_RULE, TAG, daysUntil, fmtDate } from "./styles";

const QK = ["integration-connections"];

// Labels for the provider-specific settings the server says a provider needs.
const SETTING_LABELS: Record<string, { label: string; secret: boolean }> = {
  developerToken: { label: "Developer token", secret: true },
  loginCustomerId: { label: "Login customer ID (manager account)", secret: false },
};

const EditForm: React.FC<{ c: IntegrationConnection; providers: ConnectionProvider[]; onDone: () => void }> = ({ c, providers, onDone }) => {
  const qc = useQueryClient();
  const [provider, setProvider] = useState(c.Provider || providers[0]?.id || "");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expires, setExpires] = useState(c.TokenExpiresAt ? c.TokenExpiresAt.slice(0, 10) : "");
  const [settings, setSettings] = useState<Record<string, string>>({ loginCustomerId: c.LoginCustomerId });
  const needs = providers.find((p) => p.id === provider)?.settings ?? [];
  const save = useMutation({
    mutationFn: () => saveConnectionCredentials(c.Id, {
      provider, accessToken, refreshToken, tokenExpiresAt: expires || null,
      ...Object.fromEntries(needs.map((k) => [k, settings[k] ?? ""])),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK }); onDone(); },
  });

  return (
    <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div>
        <label className={`${LBL} block mb-1`} htmlFor={`prov-${c.Id}`}>Provider</label>
        <select id={`prov-${c.Id}`} className={FIELD} value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className={`${LBL} block mb-1`} htmlFor={`tok-${c.Id}`}>Access token</label>
        <input id={`tok-${c.Id}`} className={FIELD} type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
          placeholder={c.HasAccessToken ? "Saved — paste a new one to replace it" : "Paste the token"} />
      </div>
      <div>
        <label className={`${LBL} block mb-1`} htmlFor={`ref-${c.Id}`}>Refresh token</label>
        <input id={`ref-${c.Id}`} className={FIELD} type="password" autoComplete="off" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)}
          placeholder={c.HasRefreshToken ? "Saved — paste a new one to replace it" : "Optional"} />
      </div>
      <div>
        <label className={`${LBL} block mb-1`}>Token expires on</label>
        <DateInput className={FIELD} value={expires} onChange={(e) => setExpires(e.target.value)} />
      </div>
      {needs.map((k) => {
        const meta = SETTING_LABELS[k] ?? { label: k, secret: false };
        const saved = k === "developerToken" && c.HasDeveloperToken;
        return (
          <div key={k}>
            <label className={`${LBL} block mb-1`} htmlFor={`${k}-${c.Id}`}>{meta.label}</label>
            <input id={`${k}-${c.Id}`} className={FIELD} type={meta.secret ? "password" : "text"} autoComplete="off"
              value={settings[k] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [k]: e.target.value }))}
              placeholder={saved ? "Saved — paste a new one to replace it" : ""} />
          </div>
        );
      })}
      {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" className={`${KEY_INK} h-9 px-3`} disabled={save.isPending || !provider}>
          {save.isPending && <Loader2 size={12} className="animate-spin" />} Save
        </button>
        <button type="button" className={`${KEY_LINE} h-9 px-3`} onClick={onDone}><X size={12} /> Cancel</button>
      </div>
    </form>
  );
};

const ConnectionCard: React.FC<{ c: IntegrationConnection; providers: ConnectionProvider[] }> = ({ c, providers }) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const test = useMutation({ mutationFn: () => testConnection(c.Id), onSettled: () => qc.invalidateQueries({ queryKey: QK }) });
  const providerLabel = providers.find((p) => p.id === c.Provider)?.label;
  const days = daysUntil(c.TokenExpiresAt);
  const expired = days !== null && days < 0;
  const ready = !!c.Provider && !!c.HasAccessToken && !expired;

  return (
    <div className={`bg-card flex flex-col border ${ready && c.LastTestOk !== false ? "border-foreground" : "border-dashed border-foreground/50"}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: SOFT_RULE }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 flex items-center justify-center border border-foreground shrink-0"><PlugZap size={15} /></span>
          <div className="min-w-0">
            <p className="font-heading text-base font-bold tracking-tight text-foreground truncate">{c.Label}</p>
            <p className="text-xs text-muted-foreground truncate">{providerLabel || "Provider not chosen"}</p>
          </div>
        </div>
        {!c.IsActive ? <span className={`${TAG} text-muted-foreground border-foreground/40`}>Switched off</span>
          : !c.HasAccessToken ? <span className={`${TAG} text-muted-foreground border-foreground/40`}>No token</span>
          : expired ? <SheetMark text="Token expired" tone="waiting" />
          : c.LastTestOk === false ? <SheetMark text="Test failed" tone="waiting" />
          : c.LastTestOk ? <SheetMark text="Working" tone="done" />
          : <span className={`${TAG} text-muted-foreground border-foreground/40`}>Not tested</span>}
      </div>

      <div className="px-4 py-3 space-y-2.5 flex-1">
        {editing ? <EditForm c={c} providers={providers} onDone={() => setEditing(false)} /> : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className={LBL}>Token expires</span>
              <span className={`text-sm tabular-nums ${expired ? "text-destructive" : days !== null && days <= 7 ? "text-amber-600" : "text-foreground"}`}>
                {fmtDate(c.TokenExpiresAt)}{days !== null && days >= 0 && days <= 7 ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className={LBL}>Last test</span>
              <span className="text-sm text-foreground tabular-nums">{fmtDate(c.LastTestAt)}</span>
            </div>
            {c.LastTestOk === false && c.LastTestMessage && <p className="text-xs text-destructive break-words">{c.LastTestMessage}</p>}
            <div className="flex items-baseline justify-between gap-3">
              <span className={LBL}>Used by</span>
              <span className="text-sm text-foreground text-right">{c.UsedBy.length ? c.UsedBy.join(", ") : "No platform yet"}</span>
            </div>
          </>
        )}
      </div>

      {!editing && (
        <div className="px-4 py-3 flex gap-2" style={{ borderTop: SOFT_RULE }}>
          <button type="button" className={`${KEY_INK} h-9 px-3 flex-1`} disabled={!c.Provider || !c.HasAccessToken || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Test
          </button>
          <button type="button" className={`${KEY_LINE} h-9 px-3 flex-1`} onClick={() => setEditing(true)}>
            <Settings2 size={12} /> {c.HasAccessToken ? "Credentials" : "Set up"}
          </button>
        </div>
      )}
      {test.isError && <p className="px-4 pb-3 text-xs text-destructive">{(test.error as Error).message}</p>}
    </div>
  );
};

/** Meta / Google logins that Sales Automation's social media platforms use. */
export const ConnectionsSection: React.FC = () => {
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: getConnections, retry: false });
  const forbidden = (error as { status?: number } | null)?.status === 403;

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: RULE }}>
        <span className={HEAD}>Social media connections</span>
        <Link to="/admin/masters/integration-channels" className={`${KEY_LINE} h-8 px-3`}>Add or rename</Link>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          The Meta and Google logins Sales Automation uses to push ads, read results and import leads. Each platform in
          Sales Automation → Social Media picks one of these; tokens are kept here only.
        </p>
        {forbidden ? (
          <p className="text-sm text-muted-foreground">Only a super admin can manage connections.</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-56 border border-dashed border-foreground/30 animate-pulse" />)}
          </div>
        ) : !data?.channels.length ? (
          <p className="text-sm text-muted-foreground">No connections yet — use Add or rename to make one, then set up its credentials here.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {data.channels.map((c) => <ConnectionCard key={c.Id} c={c} providers={data.providers} />)}
          </div>
        )}
      </div>
    </div>
  );
};
