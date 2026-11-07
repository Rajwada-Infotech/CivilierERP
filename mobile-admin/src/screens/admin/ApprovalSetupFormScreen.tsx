// RN port of src/pages/admin/approvalSetup/ConfigForm.tsx (+ Levels, ModuleGroupSelector): an approval rule as a page
// of the stack, on the drawing sheet, with Cancel / Save along its foot. New approval rule opens it bare; Edit passes the
// rule's id. Three numbered steps, as on the web:
//   1 Give this rule a name
//   2 Where does this rule apply? — every module, grouped (Material, Engineering, Finance, Sales, CRM); a group opens to
//     its modules with a box to tick each, and says how many of its modules are chosen
//   3 Who needs to approve, and in what order? — the steps in order, each with its people, the roles whose holders may
//     approve too, and (with more than one person) whether any one of them or all of them must approve; a step can be
//     moved up or down, edited or removed, and "Add approval step" opens the step editor in place
// The rule is always "sequential" (steps happen in the order shown); each step carries its own any / all. A step's
// roles and any / all are kept on save — dropping them would change who has to approve.
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GitBranch, Pencil, Plus, Trash2, Users } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import type { MainStackParamList } from "@/navigation/MainStack";
import { fetchWorkflows, getUsers, getRoleNames, saveWorkflow, type ApprovalLevel, type ApprovalWorkflow, type User } from "@/api/approvalSetupApi";
import { Body, Field, IconKey, Input, Key, Label, Press } from "@/components/sheet/Sheet";
import { OptionRow } from "@/components/sheet/FormParts";
import { FormPage } from "@/components/sheet/Register";
import { PickerRow } from "@/components/OptionPicker";
import { MODULE_GROUPS, MODULE_OPTIONS, moduleLabel } from "./approvalSetupConfig";
import { UserMultiSelectModal } from "./UserMultiSelectModal";

type StepDraft = { label: string; userIds: number[]; roles: string[]; mode: "any" | "all" };
const sameRole = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function StepNumber({ n }: { n: number }) {
  return (
    <View style={{ width: 26, height: 26, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: fonts.heading.bold, fontSize: 12, color: S.ink }}>{n}</Text>
    </View>
  );
}

/** One numbered section of the form: its number in a square, the question, a line under it, then its controls. */
function FormStep({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <StepNumber n={n} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Body size={14} weight="semibold">{title}</Body>
          <Body size={12} color={S.graphite}>{sub}</Body>
        </View>
      </View>
      {children}
    </View>
  );
}

/** The step editor (web: AddLevelRow), in place: the step's name, its people, its roles, and any / all. */
function StepEditor({
  number, users, roleNames, initial, onConfirm, onCancel,
}: { number: number; users: User[]; roleNames: string[]; initial?: StepDraft; onConfirm: (s: StepDraft) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [userIds, setUserIds] = useState<number[]>(initial?.userIds ?? []);
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? []);
  const [mode, setMode] = useState<"any" | "all">(initial?.mode ?? "any");
  const [pickOpen, setPickOpen] = useState(false);
  // A stored role no longer in Role Master still shows, so it can be removed.
  const roleChoices = [...roleNames, ...roles.filter((r) => !roleNames.some((n) => sameRole(n, r)))];
  const names = users.filter((u) => userIds.includes(u.id)).map((u) => u.name);
  const ready = !!label.trim() && (userIds.length > 0 || roles.length > 0);

  return (
    <View style={{ borderWidth: 1.5, borderColor: S.ink, padding: 12, gap: 14 }}>
      <Label color={S.ink}>{initial ? `Edit step ${number}` : `Step ${number}`}</Label>
      <Field label="Step name" required>
        <Input value={label} onChangeText={setLabel} placeholder="e.g. Site Manager, Finance Head, Director…" />
      </Field>
      <View>
        <PickerRow label="Who approves this step" value={names.length ? names.join(", ") : ""} placeholder="Choose people…" onPress={() => setPickOpen(true)} />
      </View>
      <Field label="…and everyone with these roles">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {roleChoices.length === 0 ? (
            <Body size={12} color={S.graphite}>No roles found in Role Master.</Body>
          ) : (
            roleChoices.map((r) => {
              const on = roles.some((x) => sameRole(x, r));
              return (
                <Press
                  key={r}
                  onPress={() => setRoles((prev) => (on ? prev.filter((x) => !sameRole(x, r)) : [...prev, r]))}
                  style={(pressed) => ({ paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: on ? S.ink : S.line40, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
                >
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: on ? S.paper : S.graphite }}>{r.replace(/_/g, " ")}</Text>
                </Press>
              );
            })
          )}
        </View>
      </Field>
      {userIds.length > 1 && (
        <Field label="How many of them need to approve?">
          <View style={{ gap: 8 }}>
            {([
              { id: "any" as const, Icon: Users, label: "Any one of them", desc: "The first person to approve settles this step." },
              { id: "all" as const, Icon: GitBranch, label: "All of them", desc: "Every person assigned here must approve before it moves on." },
            ]).map((o) => {
              const on = mode === o.id;
              return (
                <Press key={o.id} onPress={() => setMode(o.id)} style={(pressed) => ({ padding: 10, gap: 3, borderWidth: on ? 2 : 1, borderColor: on ? S.ink : S.line40, backgroundColor: pressed ? S.blueWash : "transparent" })}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <o.Icon size={13} color={on ? S.ink : S.graphite} />
                    <Body size={12.5} weight="semibold">{o.label}</Body>
                  </View>
                  <Body size={11} color={S.graphite}>{o.desc}</Body>
                </Press>
              );
            })}
          </View>
        </Field>
      )}
      {!ready && <Body size={11.5} color={S.graphite}>Give the step a name, and choose at least one person or role.</Body>}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Key label="Cancel" onPress={onCancel} />
        <Key
          tone="ink"
          label={initial ? "Save step" : "Add step"}
          onPress={() => onConfirm({ label: label.trim(), userIds, roles, mode: userIds.length > 1 ? mode : "any" })}
          disabled={!ready}
          style={{ flex: 1 }}
        />
      </View>
      <UserMultiSelectModal visible={pickOpen} users={users} selectedIds={userIds} onChange={setUserIds} onClose={() => setPickOpen(false)} />
    </View>
  );
}

export default function ApprovalSetupFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "ApprovalSetupForm">>();
  const editId = route.params?.id ?? null;
  const qc = useQueryClient();

  const { data: workflows = [], isLoading: loadingRules } = useQuery({ queryKey: ["approval-workflows"], queryFn: fetchWorkflows, staleTime: 30_000, enabled: editId != null });
  const { data: users = [] } = useQuery({ queryKey: ["approval-setup-users"], queryFn: getUsers, staleTime: 60_000 });
  const { data: roleNames = [] } = useQuery({ queryKey: ["roles-list-names"], queryFn: getRoleNames, staleTime: 5 * 60_000 });
  const initial: ApprovalWorkflow | undefined = editId != null ? (Array.isArray(workflows) ? workflows : []).find((w) => w.id === editId) : undefined;

  const [name, setName] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const nextId = useRef(Date.now());
  const filled = useRef(false);

  // Editing: the saved rule fills the form once.
  useEffect(() => {
    if (!initial || filled.current) return;
    filled.current = true;
    setName(initial.name);
    setModules(initial.modules ?? []);
    setLevels((initial.levels ?? []).map((l) => ({ ...l, roles: l.roles ?? [], mode: l.mode ?? "any" })));
  }, [initial]);

  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const toggleModule = (id: string) => setModules((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const move = (idx: number, by: -1 | 1) =>
    setLevels((prev) => {
      const a = [...prev];
      [a[idx], a[idx + by]] = [a[idx + by], a[idx]];
      return a;
    });

  const save = async () => {
    if (!name.trim()) return Alert.alert("Check the rule", "Give this approval rule a name.");
    if (!modules.length) return Alert.alert("Check the rule", "Choose at least one area where it applies.");
    if (!levels.length) return Alert.alert("Check the rule", "Add at least one approval step.");
    setSaving(true);
    try {
      await saveWorkflow(
        {
          name: name.trim(),
          type: "sequential",
          modules,
          levels: levels.map((l) => ({ id: l.id, label: l.label, userIds: l.userIds, roles: l.roles ?? [], mode: l.mode ?? "any" })),
          active: initial?.active ?? true,
          ...(initial?.description ? { description: initial.description } : {}),
        },
        editId ?? undefined,
      );
      qc.invalidateQueries({ queryKey: ["approval-workflows"] });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert("Could not save", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const missing = editId != null && !loadingRules && !initial;

  return (
    <FormPage
      asScreen
      onClose={() => navigation.goBack()}
      eyebrow="CivilierERP · Approvals · Approval rule"
      title={editId != null ? "Edit approval rule" : "New approval rule"}
      subtitle="Follow the steps below — it only takes a minute."
      loading={editId != null && loadingRules}
      saving={saving}
      onSave={save}
      saveLabel={editId != null ? "Save changes" : "Save rule"}
      saveDisabled={missing || adding || editingLevel !== null}
    >
      {missing ? (
        <Body color={S.graphite}>This rule no longer exists. It may have been deleted on the web.</Body>
      ) : (
        <>
          <FormStep n={1} title="Give this rule a name" sub="Something clear, so your team knows what it's for.">
            <Input value={name} onChangeText={setName} placeholder="e.g. Site Manager Approval, Finance Sign-off…" />
          </FormStep>

          <FormStep n={2} title="Where does this rule apply?" sub="The areas of the system that need this approval before going ahead.">
            <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
              {MODULE_GROUPS.map((g) => {
                const open = openGroup === g.id;
                const chosen = g.modules.filter((m) => modules.includes(m)).length;
                return (
                  <View key={g.id} style={{ borderBottomWidth: 1, borderBottomColor: S.line15 }}>
                    <Press
                      onPress={() => setOpenGroup(open ? null : g.id)}
                      style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, backgroundColor: pressed ? S.blueWash : "transparent" })}
                    >
                      {open ? <ChevronDown size={13} color={S.graphite} /> : <ChevronRight size={13} color={S.graphite} />}
                      <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: S.ink }}>{g.label}</Text>
                      <Label color={chosen ? S.ink : S.graphite}>{chosen ? `${chosen} of ${g.modules.length}` : `${g.modules.length}`}</Label>
                    </Press>
                    {open &&
                      g.modules.map((m) => {
                        const opt = MODULE_OPTIONS.find((o) => o.id === m);
                        return <OptionRow key={m} check selected={modules.includes(m)} label={opt?.label ?? m} sub={opt?.desc} onPress={() => toggleModule(m)} />;
                      })}
                  </View>
                );
              })}
            </View>
            {modules.length > 0 && <Body size={12} weight="medium">{`${modules.length} area${modules.length > 1 ? "s" : ""} chosen: ${modules.map(moduleLabel).join(", ")}`}</Body>}
          </FormStep>

          <FormStep
            n={3}
            title="Who needs to approve, and in what order?"
            sub="Add the steps in order. Name the people who approve each step, tick roles whose holders may approve it, or both — with more than one person, choose whether any one of them or all of them must approve."
          >
            {levels.length === 0 && !adding && (
              <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: S.line40, padding: 16, alignItems: "center", gap: 4 }}>
                <Body size={13} weight="medium">No approval steps yet</Body>
                <Body size={11.5} color={S.graphite} style={{ textAlign: "center" }}>Example: Step 1 → Head Engineer, Step 2 → Director 1 & Director 2 (all must approve).</Body>
              </View>
            )}

            {levels.map((lv, idx) =>
              editingLevel === lv.id ? (
                <StepEditor
                  key={lv.id}
                  number={idx + 1}
                  users={users}
                  roleNames={roleNames}
                  initial={{ label: lv.label, userIds: lv.userIds, roles: lv.roles ?? [], mode: lv.mode ?? "any" }}
                  onConfirm={(s) => {
                    setLevels((prev) => prev.map((p) => (p.id === lv.id ? { ...s, id: lv.id } : p)));
                    setEditingLevel(null);
                  }}
                  onCancel={() => setEditingLevel(null)}
                />
              ) : (
                <View key={lv.id} style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <StepNumber n={idx + 1} />
                    <Body size={13.5} weight="semibold" style={{ flex: 1 }}>{lv.label}</Body>
                    {lv.mode === "all" && lv.userIds.length > 1 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: S.line40, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <GitBranch size={10} color={S.ink} />
                        <Label color={S.ink}>All must approve</Label>
                      </View>
                    )}
                  </View>
                  <Body size={12} color={S.ink2}>{lv.userIds.length ? lv.userIds.map((id) => userName.get(id) ?? `User #${id}`).join(", ") : "No one named"}</Body>
                  {(lv.roles ?? []).length > 0 && <Body size={11.5} color={S.graphite}>{`and everyone with: ${(lv.roles ?? []).map((r) => r.replace(/_/g, " ")).join(", ")}`}</Body>}
                  <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                    <IconKey size={32} onPress={() => move(idx, -1)} disabled={idx === 0}>
                      <ArrowUp size={14} color={S.ink} />
                    </IconKey>
                    <IconKey size={32} onPress={() => move(idx, 1)} disabled={idx === levels.length - 1}>
                      <ArrowDown size={14} color={S.ink} />
                    </IconKey>
                    <IconKey size={32} onPress={() => setEditingLevel(lv.id)}>
                      <Pencil size={14} color={S.ink} />
                    </IconKey>
                    <IconKey size={32} red onPress={() => setLevels((prev) => prev.filter((_, i) => i !== idx))}>
                      <Trash2 size={14} color={S.red} />
                    </IconKey>
                  </View>
                </View>
              ),
            )}

            {adding ? (
              <StepEditor
                number={levels.length + 1}
                users={users}
                roleNames={roleNames}
                onConfirm={(s) => {
                  setLevels((prev) => [...prev, { ...s, id: nextId.current++ }]);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : editingLevel === null ? (
              <Key label={levels.length ? "Add another step" : "Add approval step"} icon={<Plus size={13} color={S.ink} />} onPress={() => setAdding(true)} style={{ alignSelf: "flex-start" }} />
            ) : null}
          </FormStep>
        </>
      )}
    </FormPage>
  );
}

