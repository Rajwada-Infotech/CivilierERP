import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Users, Check, X, Save, RotateCcw, Download, Upload, FileDown,
} from "lucide-react";

// ── SA pages ─────────────────────────────────────────────────────────────────
const SA_PAGES = [
  { key: "sa-leads",              label: "Leads" },
  { key: "sa-inquiry",            label: "Inquiry" },
  { key: "sa-site-visits",        label: "Site Visits" },
  { key: "sa-campaigns",          label: "Campaigns" },
  { key: "sa-ads",                label: "Advertisements" },
  { key: "sa-marketing-invoices", label: "Marketing Invoices" },
  { key: "sa-social-media",       label: "Social Media" },
  { key: "sa-teams",              label: "Team Management" },
  { key: "sa-lead-distribution",  label: "Lead Distribution" },
  { key: "sa-lead-transfers",     label: "Lead Transfers" },
  { key: "sa-distribution-rules", label: "Distribution Rules" },
];

// ── Actions ───────────────────────────────────────────────────────────────────
const ACTIONS = ["view", "create", "edit", "delete", "print"] as const;
type Action = typeof ACTIONS[number];

const ACTION_LABELS: Record<Action, string> = {
  view: "View", create: "Add", edit: "Edit", delete: "Delete", print: "Print",
};

// CSV column header → action key
const CSV_COL_TO_ACTION: Record<string, Action> = {
  View: "view", Add: "create", Edit: "edit", Delete: "delete", Print: "print",
};

// ── Role styling ──────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  marketing_head:  "text-orange-400 bg-orange-500/10 border-orange-500/30",
  sales_team_lead: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  sales_person:    "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
};
const ROLE_LABELS: Record<string, string> = {
  marketing_head:  "Marketing Head",
  sales_team_lead: "Sales Team Lead",
  sales_person:    "Sales Person",
};

// ── Types ─────────────────────────────────────────────────────────────────────
type PageRights = Record<Action, boolean>;
type RightsMap  = Record<string, PageRights>;

function emptyRights(): PageRights {
  return { view: false, create: false, edit: false, delete: false, print: false };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function roleRightsToMap(pages: any[]): RightsMap {
  const map: RightsMap = {};
  for (const p of pages) {
    map[p.subModule] = {
      view:   !!p.canView,
      create: !!p.canAdd,
      edit:   !!p.canEdit,
      delete: !!p.canDelete,
      print:  !!p.canPrint,
    };
  }
  return map;
}

function customRightsToMap(rights: any[]): RightsMap {
  const map: RightsMap = {};
  for (const r of rights) {
    if (!r.page) continue;
    const acts = Array.isArray(r.actions) ? (r.actions as string[]) : [];
    map[r.page] = {
      view:   acts.includes("view"),
      create: acts.includes("create"),
      edit:   acts.includes("edit"),
      delete: acts.includes("delete"),
      print:  acts.includes("print"),
    };
  }
  return map;
}

// Merge role defaults with custom overrides — custom wins per-key
function effectiveMap(roleMap: RightsMap, customMap: RightsMap): RightsMap {
  const merged: RightsMap = {};
  for (const { key } of SA_PAGES) {
    const base     = roleMap[key]   ?? emptyRights();
    const override = customMap[key];
    merged[key] = override ? { ...base, ...override } : { ...base };
  }
  return merged;
}

// Convert editMap back to the [{page, actions}] format stored in UserPageRightsJson
function mapToCustomRights(map: RightsMap): { page: string; actions: string[] }[] {
  return SA_PAGES
    .map(({ key }) => {
      const r       = map[key] ?? emptyRights();
      const actions = ACTIONS.filter((a) => r[a]);
      return { page: key, actions };
    })
    .filter((r) => r.actions.length > 0);
}

// normalise roleRights rows from API into the shape roleRightsToMap expects
function normaliseRoleRightsRows(rows: any[]) {
  return rows.map((r: any) => ({
    subModule: r.SubModule,
    canView:   r.CanView,
    canAdd:    r.CanAdd,
    canEdit:   r.CanEdit,
    canDelete: r.CanDelete,
    canPrint:  r.CanPrint,
  }));
}

// ── CSV utilities ─────────────────────────────────────────────────────────────
const CSV_HEADER = ["Page", "View", "Add", "Edit", "Delete", "Print"];

function buildCSVRows(map: RightsMap): string {
  const lines = [CSV_HEADER.join(",")];
  for (const { key, label } of SA_PAGES) {
    const r = map[key] ?? emptyRights();
    lines.push([
      label,
      r.view   ? "Yes" : "No",
      r.create ? "Yes" : "No",
      r.edit   ? "Yes" : "No",
      r.delete ? "Yes" : "No",
      r.print  ? "Yes" : "No",
    ].join(","));
  }
  return lines.join("\n");
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Parse a CSV string back into a RightsMap.
// Returns null if the file doesn't look like a valid permissions CSV.
function parseCSVToMap(csv: string): RightsMap | null {
  const lines  = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const headers = lines[0].split(",").map((h) => h.trim());
  // Validate that at least the first col is "Page"
  if (headers[0] !== "Page") return null;

  const actionCols: { idx: number; action: Action }[] = [];
  for (let i = 1; i < headers.length; i++) {
    const action = CSV_COL_TO_ACTION[headers[i]];
    if (action) actionCols.push({ idx: i, action });
  }
  if (actionCols.length === 0) return null;

  const map: RightsMap = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols  = line.split(",").map((c) => c.trim());
    const label = cols[0];
    const page  = SA_PAGES.find((p) => p.label === label);
    if (!page) continue;
    const rights = emptyRights();
    for (const { idx, action } of actionCols) {
      rights[action] = cols[idx]?.toLowerCase() === "yes";
    }
    map[page.key] = rights;
  }
  return map;
}

// ── API fetchers ──────────────────────────────────────────────────────────────
async function fetchUsers(): Promise<any[]> {
  try {
    const res = await fetchWithAuth("/api/sa/role-master/users");
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function fetchRoles(): Promise<any[]> {
  try {
    const res = await fetchWithAuth("/api/sa/role-master/roles");
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function fetchUserPerms(userId: number): Promise<any> {
  try {
    const res = await fetchWithAuth(`/api/sa/role-master/user/${userId}/permissions`);
    if (!res.ok) return { roleRights: [], customRights: [] };
    return res.json();
  } catch { return { roleRights: [], customRights: [] }; }
}

// ── Dot (read-only indicator) ─────────────────────────────────────────────────
function Dot({ on }: { on: boolean }) {
  if (on) return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15">
      <Check size={11} className="text-emerald-500" strokeWidth={2.5} />
    </span>
  );
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted/40">
      <X size={10} className="text-muted-foreground/30" strokeWidth={2} />
    </span>
  );
}

// ── Toggle (editable) ─────────────────────────────────────────────────────────
function Toggle({
  on, isCustomGrant, isCustomRevoke, onChange,
}: {
  on: boolean;
  isCustomGrant: boolean;
  isCustomRevoke: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={onChange}
        className={`inline-flex items-center justify-center w-7 h-5 rounded transition-all duration-150
          ${on
            ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
            : "bg-muted/30 text-muted-foreground/40 hover:bg-muted/50"}
          ${isCustomGrant  ? "ring-1 ring-primary/60" : ""}
          ${isCustomRevoke ? "ring-1 ring-red-500/40" : ""}
        `}
      >
        {on ? <Check size={11} strokeWidth={2.5} /> : <X size={10} strokeWidth={2} />}
      </button>
      {isCustomGrant  && <span className="text-[8px] text-primary/70 leading-none">+grant</span>}
      {isCustomRevoke && <span className="text-[8px] text-red-400/70 leading-none">revoked</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 1 — Role Rights (read-only overview + CSV export per role)
// ════════════════════════════════════════════════════════════════════════════
function RoleRightsTab({ roles }: { roles: any[] }) {
  return (
    <div className="space-y-6">
      {roles.length === 0 && (
        <p className="text-sm text-muted-foreground">No role rights found. Run migration 142 to seed defaults.</p>
      )}
      {roles.map((role) => {
        const map = roleRightsToMap(role.pages);
        return (
          <div key={role.RId} className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-muted/10 border-b border-border">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ROLE_COLORS[role.RName] ?? "text-muted-foreground bg-muted/20 border-border"}`}>
                  {ROLE_LABELS[role.RName] ?? role.RName}
                </span>
                <span className="text-xs text-muted-foreground">{role.RDesc}</span>
              </div>
              <button
                onClick={() => downloadCSV(`${role.RName}_role_rights.csv`, buildCSVRows(map))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                title="Export role rights as CSV"
              >
                <FileDown size={11} /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/5">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-48">Page</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">
                        {ACTION_LABELS[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SA_PAGES.map(({ key, label }) => {
                    const r      = map[key];
                    const hasAny = r && ACTIONS.some((a) => r[a]);
                    return (
                      <tr key={key} className={`border-t border-border/40 ${!hasAny ? "opacity-40" : ""}`}>
                        <td className="px-4 py-2 text-xs font-medium text-foreground">{label}</td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="px-3 py-2 text-center">
                            <Dot on={!!r?.[a]} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 2 — User Permissions (custom overrides + import/export CSV)
// ════════════════════════════════════════════════════════════════════════════
function UserPermissionsTab({ users }: { users: any[] }) {
  const rights           = usePageRights("sa-role-master");
  const qc              = useQueryClient();
  const importRef       = useRef<HTMLInputElement>(null);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [editMap, setEditMap]           = useState<RightsMap>({});
  const [dirty, setDirty]               = useState(false);

  const { data: perms, isLoading: loadingPerms } = useQuery({
    queryKey: ["sa-role-master-perms", selectedUser?.id],
    queryFn:  () => fetchUserPerms(selectedUser!.id),
    enabled:  !!selectedUser,
  });

  // Rebuild editMap whenever perms load / user switches
  useEffect(() => {
    if (!perms) return;
    const roleMap   = roleRightsToMap(normaliseRoleRightsRows(perms.roleRights ?? []));
    const customMap = customRightsToMap(perms.customRights ?? []);
    setEditMap(effectiveMap(roleMap, customMap));
    setDirty(false);
  }, [perms]);

  // Role-default map for comparison (to highlight custom overrides)
  const roleDefaultMap = useMemo((): RightsMap => {
    if (!perms?.roleRights) return {};
    return roleRightsToMap(normaliseRoleRightsRows(perms.roleRights));
  }, [perms]);

  const savePerms = useMutation({
    mutationFn: async () => {
      const rights = mapToCustomRights(editMap);
      const res    = await fetchWithAuth(
        `/api/sa/role-master/user/${selectedUser!.id}/permissions`,
        {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ rights }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
    },
    onSuccess: () => {
      toast.success("Permissions saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["sa-role-master-perms", selectedUser?.id] });
    },
    onError: (e: any) => toast.error(translateError(e.message)),
  });

  function handleToggle(pageKey: string, action: Action) {
    setEditMap((prev) => {
      const cur = prev[pageKey] ?? emptyRights();
      return { ...prev, [pageKey]: { ...cur, [action]: !cur[action] } };
    });
    setDirty(true);
  }

  function handleReset() {
    if (!perms) return;
    const roleMap = roleRightsToMap(normaliseRoleRightsRows(perms.roleRights ?? []));
    setEditMap(effectiveMap(roleMap, {}));
    setDirty(false);
  }

  function handleExportCSV() {
    if (!selectedUser) return;
    const filename = `${selectedUser.name.replace(/\s+/g, "_")}_permissions.csv`;
    downloadCSV(filename, buildCSVRows(editMap));
  }

  function handleImportClick() {
    importRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-imported if needed
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const map  = parseCSVToMap(text);
      if (!map) {
        toast.error("Invalid CSV format. Make sure the file was exported from this page.");
        return;
      }
      // Merge imported values onto current editMap so pages not in the CSV keep their state
      setEditMap((prev) => ({ ...prev, ...map }));
      setDirty(true);
      toast.success("CSV imported — review changes and click Save.");
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex gap-5" style={{ minHeight: 480 }}>
      {/* Hidden file input for CSV import */}
      <input
        ref={importRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Left: user list */}
      <div className="w-64 shrink-0 rounded-xl border border-border overflow-hidden flex flex-col">
        <div className="px-4 py-3 bg-muted/10 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">SA Users</p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {users.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">No SA users found.</p>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => { setSelectedUser(u); setDirty(false); }}
              className={`w-full text-left px-4 py-3 transition-colors hover:bg-muted/20
                ${selectedUser?.id === u.id
                  ? "bg-primary/10 border-l-2 border-primary"
                  : "border-l-2 border-transparent"}`}
            >
              <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{u.email}</p>
              <span className={`mt-1.5 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border
                ${ROLE_COLORS[u.RoleName] ?? ROLE_COLORS[u.role] ?? "text-muted-foreground bg-muted/20 border-border"}`}>
                {ROLE_LABELS[u.RoleName] ?? ROLE_LABELS[u.role] ?? u.RoleName ?? u.role}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: permission editor */}
      <div className="flex-1 min-w-0 rounded-xl border border-border overflow-hidden flex flex-col">
        {!selectedUser ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <Users size={32} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Select a user to manage permissions</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Role-level defaults are shown as base. Grant or revoke individual page actions.
            </p>
          </div>
        ) : (
          <>
            {/* Header toolbar */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/10 border-b border-border">
              <div>
                <p className="text-sm font-semibold text-foreground">{selectedUser.name}</p>
                <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  title="Reset to role defaults"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <RotateCcw size={11} /> Reset
                </button>
                <button
                  onClick={handleImportClick}
                  title="Import permissions from CSV"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Upload size={11} /> Import CSV
                </button>
                <button
                  onClick={handleExportCSV}
                  title="Export current permissions as CSV"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Download size={11} /> Export CSV
                </button>
                {rights.canEdit && (
                  <button
                    onClick={() => savePerms.mutate()}
                    disabled={!dirty || savePerms.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  >
                    <Save size={11} /> {savePerms.isPending ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-muted/5 border-b border-border/40 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded bg-emerald-500/20 flex items-center justify-center"><Check size={9} className="text-emerald-400" /></span>
                Allowed (role default)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded ring-1 ring-primary/60 bg-emerald-500/20 flex items-center justify-center"><Check size={9} className="text-emerald-400" /></span>
                Custom grant
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded ring-1 ring-red-500/40 bg-muted/30 flex items-center justify-center"><X size={9} className="text-muted-foreground/40" /></span>
                Custom revoke
              </span>
            </div>

            {loadingPerms ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading permissions…</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/5 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-48">Page</th>
                      {ACTIONS.map((a) => (
                        <th key={a} className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground w-20">
                          {ACTION_LABELS[a]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SA_PAGES.map(({ key, label }) => {
                      const cur = editMap[key]         ?? emptyRights();
                      const def = roleDefaultMap[key]  ?? emptyRights();
                      return (
                        <tr key={key} className="border-t border-border/40 hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-2.5 text-xs font-medium text-foreground">{label}</td>
                          {ACTIONS.map((action) => {
                            const isOn          = cur[action];
                            const isDefault     = def[action];
                            const isCustomGrant  = isOn  && !isDefault;
                            const isCustomRevoke = !isOn && isDefault;
                            return (
                              <td key={action} className="px-3 py-2.5 text-center">
                                <Toggle
                                  on={isOn}
                                  isCustomGrant={isCustomGrant}
                                  isCustomRevoke={isCustomRevoke}
                                  onChange={() => handleToggle(key, action)}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main Page
// ════════════════════════════════════════════════════════════════════════════
const SaRoleMaster: React.FC = () => {
  usePageRights("sa-role-master");
  const [tab, setTab] = useState<"roles" | "users">("roles");

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["sa-role-master-users"],
    queryFn:  fetchUsers,
    staleTime: 5 * 60_000,
  });

  const { data: roles = [], isLoading: loadingRoles } = useQuery({
    queryKey: ["sa-role-master-roles"],
    queryFn:  fetchRoles,
    staleTime: 5 * 60_000,
  });

  return (
    <SalesAutoShell title="Role Master" subtitle="Manage SA module role rights and grant custom page-level permissions per user"
      action={
        <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-primary/10 text-primary border-primary/20">
          {users.length} Users
        </span>
      }
    >
      <Breadcrumbs items={["Sales Automation", "Role Master"]} />
      <div className="flex flex-col gap-6">

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/20 border border-border w-fit">
        {(["roles", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-150
              ${tab === t
                ? "bg-background border border-border shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "roles" ? "Role Rights" : "User Permissions"}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "roles" && (
        loadingRoles
          ? <p className="text-sm text-muted-foreground">Loading role rights…</p>
          : <RoleRightsTab roles={roles} />
      )}
      {tab === "users" && (
        loadingUsers
          ? <p className="text-sm text-muted-foreground">Loading users…</p>
          : <UserPermissionsTab users={users} />
      )}
      </div>
    </SalesAutoShell>
  );
};

export default SaRoleMaster;
