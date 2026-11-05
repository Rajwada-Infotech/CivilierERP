import React, { useId, useMemo, useState } from "react";
import { Search, X, Trash2, AlertTriangle, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { MasterPage, type DataChangeEvent, type FieldDef, type RecordWithId } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Sales teams master — "Team A, led by X, members Y and Z" — on the same
// MasterPage as every other SA master. Saving moves people's open leads with
// them (see "Leads follow the person" in backend/routes/saTeams.js).
//
// People change outside this page (switched off, or given another role in
// Users). Such a lead or member is flagged rather than hidden, so the team can
// still be opened and fixed; on save the server drops members who are no
// longer active salespeople.

const API = "/api/sa/teams";

const get = async (path: string) => {
  const r = await fetchWithAuth(path);
  if (!r.ok) throw new Error("Failed to load");
  return r.json();
};

const send = async (path: string, method: string, body?: unknown) => {
  const r = await fetchWithAuth(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(translateError(data.error || "Failed"));
  return data;
};

type Person = { Id: number; Name: string; Email?: string; TeamId?: number | null; TeamName?: string | null; Active?: boolean };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

const Avatar: React.FC<{ name: string; muted?: boolean; size?: "sm" | "md" }> = ({ name, muted, size = "md" }) => (
  <span className={`rounded-full font-semibold flex items-center justify-center shrink-0 ${size === "sm" ? "w-5 h-5 text-[0.625rem]" : "w-7 h-7 text-[0.6875rem]"} ${muted ? "bg-muted/60 text-muted-foreground" : "bg-muted text-foreground"}`}>
    {initials(name)}
  </span>
);

// A person as a small chip: names are not unique (two users can both be
// "Sales Person 1"), so the email is on hover. Inactive people are struck out.
const PersonChip: React.FC<{ person: Person }> = ({ person }) => (
  <span
    title={person.Active === false ? `${person.Email || person.Name} — no longer an active salesperson` : person.Email || person.Name}
    className={`inline-flex items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 py-0.5 text-xs max-w-[14rem] ${person.Active === false ? "border-amber-500/50 text-muted-foreground line-through" : "border-border bg-background text-foreground"}`}
  >
    <Avatar name={person.Name} size="sm" muted={person.Active === false} />
    <span className="truncate">{person.Name}</span>
  </span>
);

// Members picker, built to scale to hundreds of salespeople: the form lists
// only this team's members (each removable), and others are added by search —
// a short list of matches, each saying which team the person is in now, so
// moving someone out of another team is never silent. Works from the keyboard:
// arrows move through matches, Enter adds, Escape clears.
const MAX_MATCHES = 8;

const MemberPicker: React.FC<{
  people: Person[];
  departed: Map<string, Person>;
  value: string[];
  onChange: (v: string[]) => void;
  thisTeamId?: number | null;
}> = ({ people, departed, value, onChange, thisTeamId }) => {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const byId = useMemo(() => new Map(people.map((p) => [String(p.Id), p])), [people]);
  const members = value.map((id) => byId.get(id) ?? departed.get(id)).filter(Boolean) as Person[];
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? people
        .filter((p) => !value.includes(String(p.Id)))
        .filter((p) => p.Name.toLowerCase().includes(needle) || (p.Email || "").toLowerCase().includes(needle))
        // Free people first — adding them moves no one.
        .sort((a, b) => Number(!!a.TeamId) - Number(!!b.TeamId) || a.Name.localeCompare(b.Name))
    : [];
  const shown = matches.slice(0, MAX_MATCHES);
  const from = (p: Person) => (p.TeamId && p.TeamId !== thisTeamId ? p.TeamName : null);
  const add = (id: string) => { onChange([...value, id]); setQ(""); setCursor(0); };
  const remove = (id: string) => onChange(value.filter((x) => x !== id));
  const leaving = members.filter((m) => m.Active === false).length;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[cursor]) add(String(shown[cursor].Id)); }
    else if (e.key === "Escape") { setQ(""); setCursor(0); }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="relative border-b border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <Search size={14} className="text-muted-foreground shrink-0" aria-hidden />
          <input
            role="combobox"
            aria-expanded={!!needle}
            aria-controls={listId}
            aria-activedescendant={shown[cursor] ? `${listId}-${shown[cursor].Id}` : undefined}
            aria-label="Add a salesperson"
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={onKey}
            placeholder="Add a salesperson — search by name or email"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {needle && (
          <ul id={listId} role="listbox" className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No active salesperson matches "{q}".</li>}
            {shown.map((p, i) => (
              <li
                key={p.Id}
                id={`${listId}-${p.Id}`}
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => { e.preventDefault(); add(String(p.Id)); }}
                onMouseEnter={() => setCursor(i)}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${i === cursor ? "bg-muted" : ""}`}
              >
                <Avatar name={p.Name} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground truncate">{p.Name}</span>
                  <span className="block text-xs text-muted-foreground truncate">{p.Email}</span>
                </span>
                <span className={`text-xs shrink-0 ${from(p) ? "text-amber-600" : "text-muted-foreground"}`}>
                  {from(p) ? `Moves from ${from(p)}` : "Not in a team"}
                </span>
              </li>
            ))}
            {matches.length > MAX_MATCHES && (
              <li className="px-3 py-1.5 text-xs text-muted-foreground border-t border-border">{matches.length - MAX_MATCHES} more — keep typing to narrow down</li>
            )}
          </ul>
        )}
      </div>

      {members.length === 0 ? (
        <p className="px-3 py-6 text-sm text-center text-muted-foreground">No members yet. Search above to add salespeople.</p>
      ) : (
        <ul className="divide-y divide-border max-h-72 overflow-y-auto">
          {members.map((p) => (
            <li key={p.Id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={p.Name} muted={p.Active === false} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm truncate ${p.Active === false ? "text-muted-foreground line-through" : "text-foreground"}`}>{p.Name}</span>
                <span className="block text-xs text-muted-foreground truncate">{p.Email}</span>
              </span>
              {p.Active === false
                ? <span className="text-xs text-amber-600 shrink-0">No longer active — leaves on save</span>
                : from(p) && <span className="text-xs text-amber-600 shrink-0">Moves from {from(p)}</span>}
              <button type="button" onClick={() => remove(String(p.Id))} aria-label={`Remove ${p.Name}`} title="Remove from team" className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
        {members.length - leaving} member{members.length - leaving === 1 ? "" : "s"}
        {leaving > 0 && ` · ${leaving} no longer active`}
        {" · removed members' open leads go back to the team lead for redistribution"}
      </p>
    </div>
  );
};

const columns = [
  { key: "name", label: "Team" },
  { key: "teamLeadName", label: "Team lead" },
  { key: "memberNames", label: "Members" },
  { key: "openLeads", label: "Open leads" },
  { key: "toDistribute", label: "Waiting to be handed out", hideOnMobile: true },
];

const exportColumns: ExportColumn[] = [
  { header: "Team", accessor: "name" },
  { header: "Team lead", accessor: "teamLeadName" },
  { header: "Members", accessor: "memberNames" },
  { header: "Open leads", accessor: "openLeads" },
  { header: "Waiting to be handed out", accessor: "toDistribute" },
];

// What's wrong with a team, in words — drives the table flags and the banner.
const issuesOf = (row: RecordWithId) => {
  const out: string[] = [];
  if (!row.leadActive) out.push("lead no longer active");
  const gone = ((row.members as Person[]) ?? []).filter((m) => m.Active === false).length;
  if (gone) out.push(`${gone} member${gone === 1 ? "" : "s"} no longer active`);
  return out;
};

const SaTeamManagement: React.FC = () => {
  usePageRights("sa-teams");
  const { canDoAction } = useAuth();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<RecordWithId | null>(null);
  const [busy, setBusy] = useState(false);

  const teams = useQuery({ queryKey: ["sa-teams"], queryFn: () => get(API), staleTime: 30_000 });
  const options = useQuery({ queryKey: ["sa-team-options"], queryFn: () => get(`${API}/options`), staleTime: 30_000 });
  const { data: me } = useQuery({ queryKey: ["sa-teams-me"], queryFn: () => get(`${API}/me`), staleTime: 5 * 60_000 });

  // Mirrors the server: SA admins manage every team; a team lead may only
  // change the members of their own team.
  const isAdmin = !!me?.isSaAdmin;
  const leads: Person[] = options.data?.leads ?? [];
  const salespeople: Person[] = options.data?.salespeople ?? [];

  const rows: RecordWithId[] = useMemo(() => (Array.isArray(teams.data) ? teams.data : []).map((t: any) => ({
    _id: String(t.Id),
    name: t.Name ?? "",
    teamLeadUserId: String(t.TeamLeadUserId),
    teamLeadName: t.TeamLeadName ?? "",
    teamLeadEmail: t.TeamLeadEmail ?? "",
    leadActive: !!t.LeadActive,
    members: t.Members ?? [],
    memberIds: (t.Members ?? []).map((m: any) => String(m.Id)),
    memberNames: (t.Members ?? []).map((m: any) => m.Name).join(", "),
    openLeads: t.OpenLeads ?? 0,
    toDistribute: t.ToDistribute ?? 0,
  })), [teams.data]);

  // Members who are still in a team but no longer active salespeople — the
  // picker needs them to show (and let you remove) what the options list omits.
  const departed = useMemo(() => {
    const m = new Map<string, Person>();
    rows.forEach((r) => ((r.members as Person[]) ?? []).forEach((p) => { if (p.Active === false) m.set(String(p.Id), p); }));
    return m;
  }, [rows]);

  const needsAttention = rows.filter((r) => issuesOf(r).length);

  const fields: FieldDef[] = [
    { name: "name", label: "Team name", type: "text", required: true, placeholder: "e.g. Team A", disabledWhen: () => !isAdmin },
    {
      name: "teamLeadUserId",
      label: "Team lead",
      type: "select",
      required: true,
      // A lead can head one team: offer active leads with no team, plus this
      // team's own. A lead who is no longer active isn't offered, so the field
      // comes up empty and the team can't be saved until a new lead is chosen.
      optionsProvider: (_data, currentId) => leads
        .filter((l) => !l.TeamId || String(l.TeamId) === currentId)
        .map((l) => ({ value: String(l.Id), label: l.Email ? `${l.Name} — ${l.Email}` : l.Name })),
      // Add Team stays available like on every other master page; when no
      // lead is free, the form says so here instead of the button vanishing.
      disabledWhen: (form) => !isAdmin || (!form.teamLeadUserId && leads.every((l) => !!l.TeamId)),
      disabledPlaceholder: isAdmin
        ? "No free team lead — give a user the Sales Team Lead role in Users first"
        : "Only an SA admin can change the team lead",
    },
    {
      name: "memberIds",
      label: "Members",
      type: "custom",
      fullWidth: true,
      defaultValue: [],
      // This team = the team the chosen lead heads (none yet for a new team).
      render: ({ value, onChange, formData }) => (
        <MemberPicker
          people={salespeople}
          departed={departed}
          value={(Array.isArray(value) ? value : []) as string[]}
          onChange={onChange}
          thisTeamId={leads.find((l) => String(l.Id) === String(formData.teamLeadUserId))?.TeamId ?? null}
        />
      ),
    },
  ];

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["sa-teams"] }),
    qc.invalidateQueries({ queryKey: ["sa-team-options"] }),
    qc.invalidateQueries({ queryKey: ["sa-dashboard"] }),
  ]);

  const onDataEvent = async (event: DataChangeEvent) => {
    const body = (r: Record<string, unknown>) => ({
      Name: r.name,
      TeamLeadUserId: Number(r.teamLeadUserId),
      MemberIds: ((r.memberIds as string[]) ?? []).map(Number),
    });
    // MasterPage shows its own "saved" toast.
    if (event.action === "add") await send(API, "POST", body(event.record));
    if (event.action === "update") await send(`${API}/${event.id}`, "PUT", body(event.record));
    await refresh();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const data = await send(`${API}/${deleting._id}`, "DELETE");
      toast.success(data?.message || "Team deleted");
      await refresh();
      setDeleting(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (teams.isLoading || options.isLoading) return <div className="p-6 text-muted-foreground">Loading teams…</div>;
  if (teams.error || options.error) return <div className="p-6 text-destructive">Couldn't load teams. Reload the page, and if it keeps happening, check that migration 581 has been applied.</div>;

  const freeLeads = leads.filter((l) => !l.TeamId).length;
  const notInTeam = salespeople.filter((p) => !p.TeamId).length;
  const canDelete = isAdmin && canDoAction("sa-teams", "delete");
  const deletingMembers = ((deleting?.members as Person[]) ?? []).filter((m) => m.Active !== false);

  return (
    <SalesAutoShell
      breadcrumbs={["Sales Automation", "Teams"]}
      title="Teams"
      subtitle={`${rows.length} team${rows.length === 1 ? "" : "s"} · ${salespeople.length - notInTeam} of ${salespeople.length} salespeople in a team${notInTeam ? ` · ${notInTeam} not in any team` : ""}`}
    >
      {isAdmin && freeLeads === 0 && (
        <div role="note" className="flex gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <Info size={16} className="text-muted-foreground shrink-0 mt-0.5" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Every team lead already heads a team, so a new team can't be saved yet. Give another user the <span className="text-foreground font-medium">Sales Team Lead</span> role in Users, then add the team here.
          </p>
        </div>
      )}

      {needsAttention.length > 0 && (
        <div role="status" className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {needsAttention.length} team{needsAttention.length === 1 ? " needs" : "s need"} attention
            </p>
            <p className="text-muted-foreground mt-0.5">
              {needsAttention.map((r) => `${r.name}: ${issuesOf(r).join(", ")}`).join(" · ")}. Open the team with Edit to fix it.
            </p>
          </div>
        </div>
      )}

      <MasterPage
        title="Team"
        fields={fields}
        columns={columns}
        initialData={rows}
        onDataEvent={onDataEvent}
        canCreate={isAdmin && canDoAction("sa-teams", "create")}
        canEdit={canDoAction("sa-teams", "edit")}
        canDelete={false}
        collapsibleAddForm
        isRowLocked={(row) => (!isAdmin && row.teamLeadUserId !== String(me?.userId) ? "Another team lead's team" : null)}
        rowActions={(row) => canDelete ? (
          <button
            type="button"
            onClick={() => setDeleting(row)}
            aria-label={`Delete ${row.name}`}
            title="Delete team"
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={14} />
          </button>
        ) : null}
        columnRenderers={{
          name: (v) => <span className="font-medium text-foreground">{String(v)}</span>,
          teamLeadName: (v, row) => (
            <span className="flex flex-col">
              <span className={row.leadActive ? "text-foreground" : "text-muted-foreground line-through"}>{String(v)}</span>
              {row.leadActive
                ? <span className="text-xs text-muted-foreground">{String(row.teamLeadEmail)}</span>
                : <span className="text-xs text-amber-600">No longer active — choose a new lead</span>}
            </span>
          ),
          memberNames: (_v, row) => {
            const ms = (row.members as Person[]) ?? [];
            if (!ms.length) return <span className="text-xs text-muted-foreground">No members yet</span>;
            return (
              <span className="flex flex-wrap gap-1">
                {ms.slice(0, 4).map((m) => <PersonChip key={m.Id} person={m} />)}
                {ms.length > 4 && <span className="text-xs text-muted-foreground self-center">+{ms.length - 4} more</span>}
              </span>
            );
          },
          openLeads: (v) => <span className="tabular-nums">{String(v)}</span>,
          toDistribute: (v) => Number(v) ? <span className="text-amber-600 font-medium tabular-nums">{String(v)}</span> : <span className="tabular-nums">0</span>,
        }}
        exportConfig={{ title: "Sales Teams", filename: "sales-teams", columns: exportColumns }}
        viewConfig={{
          title: "Team",
          fields: [
            { key: "name", label: "Team" },
            { key: "teamLeadName", label: "Team lead" },
            { key: "memberNames", label: "Members" },
            { key: "openLeads", label: "Open leads" },
            { key: "toDistribute", label: "Waiting to be handed out" },
          ],
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !busy) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {String(deleting?.name ?? "")}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {deletingMembers.length
                    ? `${deletingMembers.map((m) => m.Name).join(", ")} will leave the team and won't be in any team.`
                    : "The team has no active members."}
                  {" "}Their open leads go back to {String(deleting?.teamLeadName ?? "")} to be handed out again.
                </p>
                <p>{String(deleting?.teamLeadName ?? "")} stays a team lead and can be given a new team. The team is switched off, not erased.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesAutoShell>
  );
};

export default SaTeamManagement;
