// RN port of src/pages/admin/ApprovalSetup.tsx's list, on the drawing sheet as the web draws it: the title block with
// New approval rule; the figures (rules, on, modules covered by a rule that is on); and the rule register — one ruled row
// per rule with its On / Off mark, name, how many steps need everyone, the modules it covers (four, then "+n more"),
// its step count, a square on / off switch and Edit / Delete (each with its right). New and Edit open the rule as its
// own page (ApprovalSetupFormScreen).
import { View, Text, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { fetchWorkflows, toggleWorkflow, deleteWorkflow, type ApprovalWorkflow } from "@/api/approvalSetupApi";
import { Body, Key, Label, Notice, Press, RegisterHead, SheetMark, SheetShell, StatRow } from "@/components/sheet/Sheet";
import { RecordRow, RegisterBox, RegisterLoading, RowKeys, SheetPage } from "@/components/sheet/Register";
import { moduleLabel } from "./approvalSetupConfig";

/** The web's square on / off key, in place of the round switch. */
export function SquareSwitch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Press onPress={() => onChange(!on)} disabled={disabled} hitSlop={8} style={() => ({ width: 34, height: 20, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : S.paper, opacity: disabled ? 0.4 : 1 })}>
      <View style={{ position: "absolute", top: 3, left: on ? 17 : 3, width: 12, height: 12, backgroundColor: on ? S.paper : S.ink }} />
    </Press>
  );
}

export default function ApprovalSetupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const { canDoAction } = useAuth();
  const canCreate = canDoAction("admin_approval_setup", "create");
  const canEdit = canDoAction("admin_approval_setup", "edit");
  const canDelete = canDoAction("admin_approval_setup", "delete");

  const { data: workflows = [], isLoading, isError, isFetching, refetch } = useQuery({ queryKey: ["approval-workflows"], queryFn: fetchWorkflows, staleTime: 30_000 });
  const list = Array.isArray(workflows) ? workflows : [];
  const on = list.filter((w) => w.active);

  const handleToggle = async (wf: ApprovalWorkflow) => {
    try {
      await toggleWorkflow(wf.id);
      queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
    } catch (e: any) {
      Alert.alert("Could not switch it", e.message || "Something went wrong.");
    }
  };
  const confirmDelete = (wf: ApprovalWorkflow) =>
    Alert.alert("Delete approval rule?", `"${wf.name}" will be permanently removed. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteWorkflow(wf.id);
            queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
          } catch (e: any) {
            Alert.alert("Could not delete", e.message || "Something went wrong.");
          }
        },
      },
    ]);

  return (
    <SheetPage refreshing={isFetching && !isLoading} onRefresh={() => void refetch()}>
      <SheetShell
        eyebrow="CivilierERP · Approvals"
        title="Approval rules"
        subtitle="Who has to approve a request before it goes through — purchase orders, expenses and the rest — level by level."
        action={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {canCreate && <Key tone="ink" label="New approval rule" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("ApprovalSetupForm")} />}
            <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => void refetch()} disabled={isFetching} />
          </View>
        }
      >
        <StatRow
          items={[
            { label: "Rules", value: isLoading ? "…" : String(list.length), note: "set up" },
            { label: "On", value: isLoading ? "…" : String(on.length), note: "sending requests for approval" },
            { label: "Modules covered", value: isLoading ? "…" : String(new Set(on.flatMap((w) => w.modules)).size), note: "by a rule that is on" },
          ]}
        />

        <RegisterBox>
          <RegisterHead title="Approval rules" count={list.length} unit={["rule", "rules"]} />
          {isLoading ? (
            <RegisterLoading />
          ) : isError ? (
            <Notice>Could not load the approval rules. Pull down to try again.</Notice>
          ) : list.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 22, gap: 6 }}>
              <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, color: S.ink }}>No approval rules yet</Text>
              <Body size={12.5} color={S.graphite} style={{ textAlign: "center" }}>
                Once you create a rule, any matching request is sent for approval before it's processed.
              </Body>
              {canCreate && <Key tone="ink" label="Create your first rule" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("ApprovalSetupForm")} style={{ marginTop: 8 }} />}
            </View>
          ) : (
            <>
              <Body size={12} color={S.graphite}>{`${list.length} rule${list.length > 1 ? "s" : ""} — switch them on or off`}</Body>
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {list.map((wf, i) => {
                  const allSteps = wf.levels.filter((l) => l.mode === "all" && l.userIds.length > 1).length;
                  const mods = wf.modules.slice(0, 4).map(moduleLabel);
                  return (
                    <RecordRow
                      key={wf.id}
                      last={i === list.length - 1}
                      title={wf.name}
                      onPress={canEdit ? () => navigation.navigate("ApprovalSetupForm", { id: wf.id }) : undefined}
                      lines={[
                        <View key="m" style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                          {mods.map((m) => (
                            <View key={m} style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.ink2 }}>{m}</Text>
                            </View>
                          ))}
                          {wf.modules.length > 4 && (
                            <View style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{`+${wf.modules.length - 4} more`}</Text>
                            </View>
                          )}
                        </View>,
                        <View key="s" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                          <Body size={11.5} color={S.graphite}>{`${wf.levels.length} approval step${wf.levels.length !== 1 ? "s" : ""}`}</Body>
                          {allSteps > 0 && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: S.line40, paddingHorizontal: 5, paddingVertical: 1 }}>
                              <GitBranch size={10} color={S.ink} />
                              <Label color={S.ink}>{`${allSteps} step${allSteps > 1 ? "s" : ""} need everyone`}</Label>
                            </View>
                          )}
                        </View>,
                      ]}
                      marks={
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <SquareSwitch on={wf.active} onChange={() => handleToggle(wf)} disabled={!canEdit} />
                          {wf.active ? <SheetMark text="On" tone="done" /> : <Label>Off</Label>}
                        </View>
                      }
                      actions={
                        <RowKeys
                          onEdit={canEdit ? () => navigation.navigate("ApprovalSetupForm", { id: wf.id }) : undefined}
                          onDelete={canDelete ? () => confirmDelete(wf) : undefined}
                        />
                      }
                    />
                  );
                })}
              </View>
            </>
          )}
        </RegisterBox>
      </SheetShell>
    </SheetPage>
  );
}
