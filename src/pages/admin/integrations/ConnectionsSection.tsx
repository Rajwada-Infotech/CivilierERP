import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, LogIn, PlugZap, Settings2, X, Zap } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { DateInput } from "@/components/ui/date-input";
import {
  getConnections, saveConnectionCredentials, testConnection, startConnect, turnOnInstantLeads, oauthRedirectUri, metaLeadsUrl,
  type ConnectionProvider, type IntegrationConnection,
} from "@/api/integrationsApi";
import { FIELD, HEAD, KEY_INK, KEY_LINE, LBL, RULE, SOFT_RULE, TAG, daysUntil, fmtDate } from "./styles";

const QK = ["integration-connections"];

const EditForm: React.FC<{ c: IntegrationConnection; providers: ConnectionProvider[]; onDone: () => void }> = ({ c, providers, onDone }) => {
  const qc = useQueryClient();
  const [provider, setProvider] = useState(c.Provider || providers[0]?.id || "");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expires, setExpires] = useState(c.TokenExpiresAt ? c.TokenExpiresAt.slice(0, 10) : "");
  const [settings, setSettings] = useState<Record<string, string>>({ ...c.Settings });
  const def = providers.find((p) => p.id === provider);
  const needs = def?.settings ?? [];
  const autoRenew = !!def?.autoRenew;
  const save = useMutation({
    mutationFn: () => saveConnectionCredentials(c.Id, {
      provider, accessToken, refreshToken,
      // A renewing token's expiry is kept by the server; a pasted token's is entered here.
      tokenExpiresAt: autoRenew ? null : expires || null,
      settings: Object.fromEntries(needs.map((d) => [d.key, settings[d.key] ?? ""])),
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
      {autoRenew ? (
        <div>
          <label className={`${LBL} block mb-1`} htmlFor={`ref-${c.Id}`}>Refresh token</label>
          <input id={`ref-${c.Id}`} className={FIELD} type="password" autoComplete="off" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)}
            placeholder={c.HasRefreshToken ? "Saved — paste a new one to replace it" : "Paste the refresh token"} />
          <p className="text-xs text-muted-foreground mt-1">The short-lived access token is renewed from this automatically — nothing to paste again.</p>
        </div>
      ) : (
        <>
          <div>
            <label className={`${LBL} block mb-1`} htmlFor={`tok-${c.Id}`}>Access token</label>
            <input id={`tok-${c.Id}`} className={FIELD} type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
              placeholder={c.HasAccessToken ? "Saved — paste a new one to replace it" : "Paste the system user token"} />
          </div>
          <div>
            <label className={`${LBL} block mb-1`}>Token expires on</label>
            <DateInput className={FIELD} value={expires} onChange={(e) => setExpires(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Leave blank for a token set to never expire.</p>
          </div>
        </>
      )}
      {needs.map((d) => (
        <div key={d.key}>
          <label className={`${LBL} block mb-1`} htmlFor={`${d.key}-${c.Id}`}>{d.label}</label>
          <input id={`${d.key}-${c.Id}`} className={FIELD} type={d.secret ? "password" : "text"} autoComplete="off"
            value={settings[d.key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [d.key]: e.target.value }))}
            placeholder={d.secret && c.SavedSecrets.includes(d.key) ? "Saved — paste a new one to replace it" : ""} />
        </div>
      ))}
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

const CopyLine: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [done, setDone] = useState(false);
  return (
    <div>
      <span className={`${LBL} block mb-1`}>{label}</span>
      <div className="flex gap-2 items-center">
        <code className="flex-1 min-w-0 truncate text-xs bg-muted px-2 py-2 font-mono">{value}</code>
        <button type="button" className={`${KEY_LINE} h-8 px-2.5 shrink-0`} aria-label={`Copy ${label}`}
          onClick={() => navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => toast.error("Copy failed — select and copy it"))}>
          {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
};

const ConnectionCard: React.FC<{ c: IntegrationConnection; providers: ConnectionProvider[] }> = ({ c, providers }) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const test = useMutation({ mutationFn: () => testConnection(c.Id), onSettled: () => qc.invalidateQueries({ queryKey: QK }) });
  const connect = useMutation({ mutationFn: () => startConnect(c.Id), onSuccess: (url) => { window.location.href = url; } });
  const instant = useMutation({
    mutationFn: () => turnOnInstantLeads(c.Id),
    onSuccess: (r) => {
      const failed = r.pages.filter((pg) => !pg.ok);
      if (failed.length) toast.warning(`Instant leads on for ${r.pages.length - failed.length} Page(s); not for ${failed.map((pg) => pg.name).join(", ")}`);
      else toast.success(`Instant leads on for ${r.pages.map((pg) => pg.name).join(", ")}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  });
  const providerDef = providers.find((p) => p.id === c.Provider);
  const providerLabel = providerDef?.label;
  // A renewing connection (refresh token) never needs a new token pasted, so its expiry isn't a warning.
  const renews = !!providers.find((p) => p.id === c.Provider)?.autoRenew && !!c.HasRefreshToken;
  const hasCredentials = !!c.HasAccessToken || renews;
  const days = renews ? null : daysUntil(c.TokenExpiresAt);
  const expired = days !== null && days < 0;
  const ready = !!c.Provider && hasCredentials && !expired;

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
          : !hasCredentials ? <span className={`${TAG} text-muted-foreground border-foreground/40`}>No token</span>
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
                {renews ? "Never — renews itself"
                  : !c.TokenExpiresAt && c.HasAccessToken ? "Never"
                  : `${fmtDate(c.TokenExpiresAt)}${days !== null && days >= 0 && days <= 7 ? ` · ${days} day${days === 1 ? "" : "s"} left` : ""}`}
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
            {providerDef?.instantLeads && (
              <div className="pt-2 space-y-1.5" style={{ borderTop: SOFT_RULE }}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={LBL}>Instant leads</span>
                  <span className="text-sm text-foreground text-right">
                    {c.WebhookOnAt ? `On since ${fmtDate(c.WebhookOnAt)} · ${c.WebhookLeads} received` : "Off — leads only come in when imported"}
                  </span>
                </div>
                {c.LastWebhookAt && (
                  <p className={`text-xs break-words ${c.LastWebhookOk === false ? "text-destructive" : "text-muted-foreground"}`}>
                    Last delivery {fmtDate(c.LastWebhookAt)}: {c.LastWebhookMessage}
                  </p>
                )}
                <button type="button" className={`${KEY_LINE} h-8 px-3 w-full`} disabled={!hasCredentials || instant.isPending} onClick={() => instant.mutate()}>
                  {instant.isPending ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} {c.WebhookOnAt ? "Re-check Pages" : "Turn on instant leads"}
                </button>
                {instant.isError && <p className="text-xs text-destructive break-words">{(instant.error as Error).message}</p>}
              </div>
            )}
          </>
        )}
      </div>

      {!editing && c.Provider && (
        <div className="px-4 pt-3" style={{ borderTop: SOFT_RULE }}>
          <button type="button" className={`${KEY_INK} h-9 px-3 w-full`} disabled={connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />} {hasCredentials ? "Reconnect" : "Connect"} with {providerLabel}
          </button>
          {connect.isError && <p className="pt-2 text-xs text-destructive break-words">{(connect.error as Error).message}</p>}
        </div>
      )}
      {!editing && (
        <div className="px-4 py-3 flex gap-2" style={c.Provider ? undefined : { borderTop: SOFT_RULE }}>
          <button type="button" className={`${KEY_LINE} h-9 px-3 flex-1`} disabled={!c.Provider || !hasCredentials || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Test
          </button>
          <button type="button" className={`${KEY_LINE} h-9 px-3 flex-1`} onClick={() => setEditing(true)}>
            <Settings2 size={12} /> {hasCredentials ? "Credentials" : "Set up"}
          </button>
        </div>
      )}
      {test.isError && <p className="px-4 pb-3 text-xs text-destructive">{(test.error as Error).message}</p>}
    </div>
  );
};

/** Meta / Google logins that Sales Automation's social media platforms use. */
export const ConnectionsSection: React.FC = () => {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: getConnections, retry: false });
  const forbidden = (error as { status?: number } | null)?.status === 403;

  // Back from "Connect with ...": say how it went, then tidy the address.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("connectError");
    if (!ok && !err) return;
    if (ok) toast.success("Connected — press Test to check it");
    else toast.error(`Not connected: ${err}`);
    qc.invalidateQueries({ queryKey: QK });
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("connectError");
    setParams(next, { replace: true });
  }, [params, setParams, qc]);

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
        {!forbidden && !error && (
          <details className="text-sm">
            <summary className="cursor-pointer text-foreground font-medium">Addresses to give Meta and Google</summary>
            <div className="mt-2 space-y-2.5">
              <CopyLine label="Sign-in return address (Google OAuth client → Authorised redirect URIs; Meta app → Valid OAuth redirect URIs)" value={oauthRedirectUri()} />
              {data?.channels.filter((c) => data.providers.find((p) => p.id === c.Provider)?.instantLeads).map((c) => (
                <CopyLine key={c.Id} label={`Instant leads address for ${c.Label} (set automatically by Turn on instant leads)`} value={metaLeadsUrl(c.Id)} />
              ))}
              <p className="text-xs text-muted-foreground">Meta and Google only accept https:// addresses (localhost aside) — connect from the live site.</p>
            </div>
          </details>
        )}
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
