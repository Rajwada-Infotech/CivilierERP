import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Grid3x3, Layers } from "lucide-react";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API = "/api/unit-matrix";

interface Option {
  Id: number;
  Name: string;
}

interface MatrixUnit {
  Id: number;
  UnitName: string;
  FloorNo: number | null;
  BlockId: number | null;
  BlockName: string | null;
  Status: "Available" | "Booked" | "Blocked";
  BookingId: number | null;
  BookingNo: string | null;
  ApplicantName: string | null;
  Mobile: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  Available: "bg-emerald-500/15 text-emerald-600 border border-emerald-400/30",
  Booked: "bg-rose-500/15 text-rose-600 border border-rose-400/30",
  Blocked: "bg-muted text-muted-foreground border border-border",
};

async function fetchOptions<T>(url: string): Promise<T[]> {
  const res = await fetchWithAuth(url);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchMatrix(projectId: string, blockId: string): Promise<MatrixUnit[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  const res = await fetchWithAuth(`${API}?${params}`);
  if (!res.ok) throw new Error("Failed to load unit matrix");
  return res.json();
}

const NONE = "__none__";

export function UnitMatrixPage() {
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["unit-matrix-projects"],
    queryFn: () => fetchOptions<Option>(`${API}/projects`),
  });

  const { data: blocks = [] } = useQuery({
    queryKey: ["unit-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });

  const { data: units = [], isLoading } = useQuery({
    queryKey: ["unit-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  const grouped = useMemo(() => {
    const byFloor = new Map<string, MatrixUnit[]>();
    for (const u of units) {
      const key = u.FloorNo != null ? `Floor ${u.FloorNo}` : "Floor —";
      if (!byFloor.has(key)) byFloor.set(key, []);
      byFloor.get(key)!.push(u);
    }
    return Array.from(byFloor.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [units]);

  const stats = useMemo(() => {
    const total = units.length;
    const available = units.filter((u) => u.Status === "Available").length;
    const booked = units.filter((u) => u.Status === "Booked").length;
    const blocked = units.filter((u) => u.Status === "Blocked").length;
    return { total, available, booked, blocked };
  }, [units]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Unit Matrix", path: "/followup/sales/unit-matrix" },
        ]}
      />
      <FollowupShell title="Unit Matrix" icon={Grid3x3}>
        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="min-w-56 space-y-1.5">
            <label className="text-xs text-muted-foreground">Project</label>
            <Select
              value={projectId || NONE}
              onValueChange={(v) => {
                setProjectId(v === NONE ? "" : v);
                setBlockId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.Id} value={String(p.Id)}>
                    {p.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48 space-y-1.5">
            <label className="text-xs text-muted-foreground">Block</label>
            <Select
              value={blockId || NONE}
              onValueChange={(v) => setBlockId(v === NONE ? "" : v)}
              disabled={!projectId}
            >
              <SelectTrigger>
                <SelectValue placeholder="All blocks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All blocks</SelectItem>
                {blocks.map((b) => (
                  <SelectItem key={b.Id} value={String(b.Id)}>
                    {b.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!projectId ? (
          <div className="py-20 text-center text-muted-foreground text-sm">
            Select a project to view its unit matrix
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Units", value: stats.total, dot: "bg-blue-400" },
                { label: "Available", value: stats.available, dot: "bg-emerald-500" },
                { label: "Booked", value: stats.booked, dot: "bg-rose-500" },
                { label: "Blocked", value: stats.blocked, dot: "bg-muted-foreground" },
              ].map(({ label, value, dot }) => (
                <div key={label} className="rounded-xl border border-border bg-card p-4">
                  <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
                  <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>

            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground text-sm">Loading matrix...</div>
            ) : units.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground text-sm">No units found for this selection</div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([floor, floorUnits]) => (
                  <div key={floor}>
                    <div className="flex items-center gap-2 mb-2.5 text-sm font-semibold text-foreground">
                      <Layers size={14} className="text-muted-foreground" />
                      {floor}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {floorUnits.map((u) => (
                        <div
                          key={u.Id}
                          className="bg-card border border-border rounded-xl p-3.5 hover:border-primary/30 transition-colors"
                          title={u.BlockName ? `${u.BlockName} — ${u.UnitName}` : u.UnitName}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="font-bold text-sm text-foreground truncate">{u.UnitName}</span>
                            <span
                              className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${STATUS_STYLE[u.Status]}`}
                            >
                              {u.Status}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {u.Status === "Booked" ? (u.ApplicantName || u.BookingNo || "—") : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </FollowupShell>
    </>
  );
}

export default UnitMatrixPage;
