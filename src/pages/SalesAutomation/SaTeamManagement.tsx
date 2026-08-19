import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { UserPlus, UserMinus, ArrowRightLeft, TrendingUp, TrendingDown, Users, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/sa/teams";

async function fetchTeams() {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error("Failed to fetch teams");
  return r.json().catch(() => ({}));
}
async function fetchAllUsers() {
  const r = await fetchWithAuth(`${API}/all-sa-users`);
  if (!r.ok) throw new Error("Failed to fetch users");
  return r.json().catch(() => ({}));
}
async function fetchUnassigned() {
  const r = await fetchWithAuth(`${API}/unassigned`);
  if (!r.ok) throw new Error("Failed to fetch unassigned users");
  return r.json().catch(() => ({}));
}

const roleBadge = (role: string) => {
  if (role === "sales_team_lead") return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-purple-500/10 text-purple-600">Team Lead</span>;
  return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-blue-500/10 text-blue-600">Sales Person</span>;
};

const SaTeamManagement: React.FC = () => {
  usePageRights("sa-teams");
  const { canDoAction } = useAuth();
  const canManageTeam = canDoAction("sa-teams", "create");
  const qc = useQueryClient();
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [addMemberDialog, setAddMemberDialog] = useState<{ teamLeadId: number; teamLeadName: string } | null>(null);
  const [transferDialog, setTransferDialog] = useState<{ memberId: number; memberName: string } | null>(null);
  const [selectedAddUser, setSelectedAddUser] = useState("");
  const [selectedTransferLead, setSelectedTransferLead] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const { data: teams = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["sa-teams"], queryFn: fetchTeams, staleTime: 30_000 });
  const { data: allUsers = [] } = useQuery({ queryKey: ["sa-all-users"], queryFn: fetchAllUsers, staleTime: 30_000 });
  const { data: unassigned = [] } = useQuery({ queryKey: ["sa-unassigned"], queryFn: fetchUnassigned, staleTime: 30_000 });

  const teamLeads = (allUsers as any[]).filter((u: any) => u.Role === "sales_team_lead");

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["sa-teams"] }),
    qc.invalidateQueries({ queryKey: ["sa-all-users"] }),
    qc.invalidateQueries({ queryKey: ["sa-unassigned"] }),
  ]);

  const toggleTeam = (id: number) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddMember = async () => {
    if (!addMemberDialog || !selectedAddUser) return toast.error("Select a user");
    setLoading("add");
    try {
      const r = await fetchWithAuth(`${API}/${addMemberDialog.teamLeadId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: parseInt(selectedAddUser) }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast.success("Member added to team");
      setAddMemberDialog(null);
      setSelectedAddUser("");
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setLoading(null); }
  };

  const handleRemoveMember = async (teamLeadId: number, memberId: number, memberName: string) => {
    setLoading(`remove-${memberId}`);
    try {
      const r = await fetchWithAuth(`${API}/${teamLeadId}/members/${memberId}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast.success(`${memberName} removed from team`);
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setLoading(null); }
  };

  const handleTransfer = async () => {
    if (!transferDialog || !selectedTransferLead) return toast.error("Select a team lead");
    setLoading("transfer");
    try {
      const r = await fetchWithAuth(`${API}/${transferDialog.memberId}/transfer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTeamLeadId: parseInt(selectedTransferLead) }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast.success(`${transferDialog.memberName} transferred`);
      setTransferDialog(null);
      setSelectedTransferLead("");
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setLoading(null); }
  };

  const handlePromote = async (userId: number, name: string) => {
    if (!confirm(`Promote ${name} to Sales Team Lead? They will leave their current team.`)) return;
    setLoading(`promote-${userId}`);
    try {
      const r = await fetchWithAuth(`${API}/${userId}/promote`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      toast.success(data.message);
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setLoading(null); }
  };

  const handleDemote = async (userId: number, name: string) => {
    if (!confirm(`Demote ${name} to Sales Person? All their team members will become unassigned.`)) return;
    setLoading(`demote-${userId}`);
    try {
      const r = await fetchWithAuth(`${API}/${userId}/demote`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      toast.success(data.message);
      await invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setLoading(null); }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading teams...</div>;

  return (
    <SalesAutoShell title="Sales Team Management" subtitle="Manage team leads and their salespersons — add, remove, transfer, promote or demote"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <Breadcrumbs items={["Sales Automation", "Team Management"]} />
      <div className="space-y-6">

        {/* Teams */}
        <div className="space-y-3">
          {(teams as any[]).length === 0 ? (
            <div className="rounded-lg border border-border p-8 text-center text-muted-foreground text-sm">
              No team leads found. Create users with the Sales Team Lead role to see teams here.
            </div>
          ) : (teams as any[]).map((team: any) => {
            const expanded = expandedTeams.has(team.Id);
            return (
              <div key={team.Id} className="rounded-lg border border-border overflow-hidden">
                {/* Team header */}
                <div
                  className="flex items-center justify-between px-4 py-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleTeam(team.Id)}
                >
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                    <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600">
                      <Users size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{team.Name}</p>
                      <p className="text-xs text-muted-foreground">{team.Email}</p>
                    </div>
                    {roleBadge(team.Role)}
                    <span className="text-xs text-muted-foreground">
                      {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {canManageTeam && (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { setAddMemberDialog({ teamLeadId: team.Id, teamLeadName: team.Name }); setSelectedAddUser(""); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <UserPlus size={12} /> Add Member
                    </button>
                    <button
                      onClick={() => handleDemote(team.Id, team.Name)}
                      disabled={loading === `demote-${team.Id}`}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                    >
                      <TrendingDown size={12} /> Demote
                    </button>
                  </div>
                  )}
                </div>

                {/* Members list */}
                {expanded && (
                  <div>
                    {team.members.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground">No members assigned to this team yet.</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-muted/10">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Role</th>
                            {canManageTeam && <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {team.members.map((m: any) => (
                            <tr key={m.MemberUserId} className="border-t border-border hover:bg-muted/10 transition-colors">
                              <td className="px-4 py-2.5 font-medium text-foreground">{m.MemberName}</td>
                              <td className="px-4 py-2.5 text-muted-foreground text-xs">{m.MemberEmail}</td>
                              <td className="px-4 py-2.5">{roleBadge(m.MemberRole)}</td>
                              <td className="px-4 py-2.5">
                                {canManageTeam ? (
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => { setTransferDialog({ memberId: m.MemberUserId, memberName: m.MemberName }); setSelectedTransferLead(""); }}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
                                  >
                                    <ArrowRightLeft size={11} /> Transfer
                                  </button>
                                  <button
                                    onClick={() => handlePromote(m.MemberUserId, m.MemberName)}
                                    disabled={loading === `promote-${m.MemberUserId}`}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                                  >
                                    <TrendingUp size={11} /> Promote
                                  </button>
                                  <button
                                    onClick={() => handleRemoveMember(team.Id, m.MemberUserId, m.MemberName)}
                                    disabled={loading === `remove-${m.MemberUserId}`}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border text-red-500 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                                  >
                                    <UserMinus size={11} /> Remove
                                  </button>
                                </div>
                                ) : <span className="text-xs text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Unassigned Sales Persons */}
        {(unassigned as any[]).filter((u: any) => u.Role === "sales_person").length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">
              Unassigned Sales Persons ({(unassigned as any[]).filter((u: any) => u.Role === "sales_person").length})
            </h3>
            <p className="text-xs text-muted-foreground mb-3">These sales persons are not in any team. Assign them to a team lead.</p>
            <div className="flex flex-wrap gap-2">
              {(unassigned as any[]).filter((u: any) => u.Role === "sales_person").map((u: any) => (
                <div key={u.Id} className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-1.5">
                  <span className="text-sm text-foreground">{u.Name}</span>
                  <span className="text-xs text-muted-foreground">{u.Email}</span>
                  <button
                    onClick={() => handlePromote(u.Id, u.Name)}
                    disabled={loading === `promote-${u.Id}`}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                  >
                    <TrendingUp size={10} /> Promote
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog open={!!addMemberDialog} onOpenChange={(o) => { if (!o) { setAddMemberDialog(null); setSelectedAddUser(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Add Member to {addMemberDialog?.teamLeadName}'s Team</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Select Sales Person</label>
              <select
                value={selectedAddUser}
                onChange={(e) => setSelectedAddUser(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
              >
                <option value="">Choose a user...</option>
                {(unassigned as any[]).map((u: any) => (
                  <option key={u.Id} value={u.Id}>{u.Name} ({u.Role.replace(/_/g, " ")})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setAddMemberDialog(null); setSelectedAddUser(""); }}
                className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
              >Cancel</button>
              <button
                onClick={handleAddMember}
                disabled={!selectedAddUser || loading === "add"}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >{loading === "add" ? "Adding..." : "Add to Team"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={!!transferDialog} onOpenChange={(o) => { if (!o) { setTransferDialog(null); setSelectedTransferLead(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Transfer {transferDialog?.memberName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Transfer to Team Lead</label>
              <select
                value={selectedTransferLead}
                onChange={(e) => setSelectedTransferLead(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
              >
                <option value="">Choose a team lead...</option>
                {teamLeads.map((tl: any) => (
                  <option key={tl.Id} value={tl.Id}>{tl.Name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setTransferDialog(null); setSelectedTransferLead(""); }}
                className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted transition-colors"
              >Cancel</button>
              <button
                onClick={handleTransfer}
                disabled={!selectedTransferLead || loading === "transfer"}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >{loading === "transfer" ? "Transferring..." : "Transfer"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default SaTeamManagement;
