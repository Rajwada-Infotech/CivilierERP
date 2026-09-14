// RN port of ApprovalSetup.tsx's ConfigForm (web) — same four steps (name,
// where it applies, approval style, approval steps/levels), laid out as one
// continuous scroll instead of web's positioned-dropdown module selector
// (RN has no reliable analogue for that), using UserMultiSelectModal for
// picking approvers per level instead of the inline positioned dropdown.
import { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Plus, Check, Trash2, ChevronUp, ChevronDown, AlertCircle, ShieldCheck } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { MODULE_OPTIONS, MODULE_GROUPS, APPROVAL_TYPES } from "./approvalSetupConfig";
import { UserMultiSelectModal } from "./UserMultiSelectModal";
import { saveWorkflow, type ApprovalWorkflow, type ApprovalLevel, type User } from "@/api/approvalSetupApi";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function StepHeader({ number, title, subtitle }: { number: number; title: string; subtitle?: string }) {
  return (
    <View className="flex-row items-center gap-2.5 mb-3">
      <View className="w-6 h-6 rounded-full items-center justify-center" style={{ borderWidth: 2, borderColor: `${colors.primary}4d`, backgroundColor: `${colors.primary}1a` }}>
        <Text style={{ color: colors.primary, fontSize: 10.5, fontFamily: fonts.heading.bold }}>{number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{title}</Text>
        {subtitle && <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{subtitle}</Text>}
      </View>
    </View>
  );
}

export function ApprovalSetupFormModal({
  visible, editing, users, onClose, onSaved,
}: {
  visible: boolean;
  editing: ApprovalWorkflow | null;
  users: User[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [type, setType] = useState<"sequential" | "any" | "parallel">("sequential");
  const [modules, setModules] = useState<string[]>([]);
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [saving, setSaving] = useState(false);

  const [addingLevel, setAddingLevel] = useState(false);
  const [newLevelLabel, setNewLevelLabel] = useState("");
  const [newLevelUserIds, setNewLevelUserIds] = useState<number[]>([]);
  const [pickerForLevel, setPickerForLevel] = useState<number | "new" | null>(null);
  const nextId = useRef(Date.now());

  useEffect(() => {
    if (!visible) return;
    setName(editing?.name ?? "");
    setType(editing?.type ?? "sequential");
    setModules(editing?.modules ?? []);
    setLevels(editing?.levels ?? []);
    setAddingLevel(false);
    setNewLevelLabel("");
    setNewLevelUserIds([]);
  }, [visible, editing]);

  const toggleModule = (id: string) => {
    setModules((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const moveLevel = (idx: number, dir: -1 | 1) => {
    setLevels((prev) => {
      const a = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= a.length) return a;
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });
  };

  const confirmAddLevel = () => {
    if (!newLevelLabel.trim()) {
      Alert.alert("Step name required", "Give this approval step a name.");
      return;
    }
    setLevels((prev) => [...prev, { id: nextId.current++, label: newLevelLabel.trim(), userIds: newLevelUserIds }]);
    setAddingLevel(false);
    setNewLevelLabel("");
    setNewLevelUserIds([]);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Give this approval rule a name.");
      return;
    }
    if (modules.length === 0) {
      Alert.alert("Pick where it applies", "Select at least one area.");
      return;
    }
    if (levels.length === 0) {
      Alert.alert("Add a step", "Add at least one approval step.");
      return;
    }
    setSaving(true);
    try {
      await saveWorkflow({ name: name.trim(), type, modules, levels, active: editing?.active ?? true }, editing?.id);
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const activePicker = pickerForLevel === "new" ? { ids: newLevelUserIds, set: setNewLevelUserIds } : pickerForLevel != null
    ? {
        ids: levels.find((l) => l.id === pickerForLevel)?.userIds ?? [],
        set: (ids: number[]) => setLevels((prev) => prev.map((l) => (l.id === pickerForLevel ? { ...l, userIds: ids } : l))),
      }
    : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 14.5, fontFamily: fonts.heading.semibold }}>
            {editing ? "Edit Approval Rule" : "New Approval Rule"}
          </Text>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 18, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          {/* Step 1 */}
          <StepHeader number={1} title="Give this rule a name" subtitle="Something clear so your team knows what it's for" />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Site Manager Approval, Finance Sign-off…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 22 }}
          />

          {/* Step 2 */}
          <StepHeader number={2} title="Where does this rule apply?" subtitle="Choose the areas of the system that need this approval" />
          {MODULE_GROUPS.map((group) => (
            <View key={group.id} style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, marginBottom: 6 }}>
                {group.icon} {group.label}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {MODULE_OPTIONS.filter((m) => (group.modules as readonly string[]).includes(m.id)).map((m) => {
                  const active = modules.includes(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => toggleModule(m.id)}
                      className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full"
                      style={{ borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}14` : "transparent" }}
                    >
                      <Text style={{ fontSize: 12 }}>{m.icon}</Text>
                      <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{m.label}</Text>
                      {active && <Check size={11} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {modules.length > 0 && (
            <Text style={{ color: colors.primary, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 8 }}>
              ✓ {modules.length} area{modules.length > 1 ? "s" : ""} selected
            </Text>
          )}
          <View style={{ height: 10 }} />

          {/* Step 3 */}
          <StepHeader number={3} title="How should approvals work?" subtitle="Choose how approvers respond when a request comes in" />
          <View style={{ gap: 8, marginBottom: 22 }}>
            {APPROVAL_TYPES.map((t) => {
              const selected = type === t.id;
              const Icon = t.icon;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setType(t.id)}
                  style={{ padding: 12, borderRadius: 14, borderWidth: 2, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? `${colors.primary}0d` : `${colors.card}66` }}
                >
                  <View className="flex-row items-center gap-2 mb-1.5">
                    <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: selected ? `${colors.primary}26` : colors.muted }}>
                      <Icon size={14} color={selected ? colors.primary : colors.mutedForeground} />
                    </View>
                    <Text style={{ color: selected ? colors.primary : colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, flex: 1 }}>{t.label}</Text>
                    {selected && <Check size={15} color={colors.primary} />}
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, lineHeight: 15 }}>{t.desc}</Text>
                  <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 10, marginTop: 4, fontFamily: fonts.body.regular }}>{t.example}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Step 4 */}
          <StepHeader number={4} title="Who needs to approve, and in what order?" subtitle="Add approval steps — each is one person or group that must sign off" />

          {levels.length === 0 && !addingLevel && (
            <View style={{ borderWidth: 2, borderStyle: "dashed", borderColor: colors.border, borderRadius: 16, paddingVertical: 24, alignItems: "center", marginBottom: 12 }}>
              <View className="w-11 h-11 rounded-full items-center justify-center mb-2" style={{ backgroundColor: colors.muted }}>
                <AlertCircle size={18} color={`${colors.mutedForeground}66`} />
              </View>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>No approval steps yet</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 3, textAlign: "center", paddingHorizontal: 20 }}>
                Tap below to add your first approver.
              </Text>
            </View>
          )}

          {levels.map((lv, idx) => {
            const levelUsers = users.filter((u) => lv.userIds.includes(u.id));
            return (
              <View key={lv.id} className="flex-row items-stretch gap-2.5 mb-2.5">
                <View className="items-center" style={{ width: 26 }}>
                  <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary }}>
                    <Text style={{ color: "#fff", fontSize: 10.5, fontFamily: fonts.heading.bold }}>{idx + 1}</Text>
                  </View>
                  {idx < levels.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: `${colors.primary}4d`, marginTop: 4 }} />}
                </View>
                <View style={{ flex: 1, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80`, padding: 12 }}>
                  <View className="flex-row items-start justify-between gap-2">
                    <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, flex: 1 }}>{lv.label}</Text>
                    <View className="flex-row items-center gap-1">
                      <Pressable onPress={() => moveLevel(idx, -1)} disabled={idx === 0} hitSlop={6} style={{ opacity: idx === 0 ? 0.3 : 1 }}>
                        <ChevronUp size={14} color={colors.mutedForeground} />
                      </Pressable>
                      <Pressable onPress={() => moveLevel(idx, 1)} disabled={idx === levels.length - 1} hitSlop={6} style={{ opacity: idx === levels.length - 1 ? 0.3 : 1 }}>
                        <ChevronDown size={14} color={colors.mutedForeground} />
                      </Pressable>
                      <Pressable onPress={() => setLevels((prev) => prev.filter((l) => l.id !== lv.id))} hitSlop={6}>
                        <Trash2 size={14} color={colors.destructive} />
                      </Pressable>
                    </View>
                  </View>
                  <Pressable onPress={() => setPickerForLevel(lv.id)} className="flex-row flex-wrap items-center gap-1.5 mt-2">
                    {levelUsers.length === 0 ? (
                      <View className="flex-row items-center gap-1 px-2 py-0.5 rounded-full" style={{ backgroundColor: "#f59e0b1a", borderWidth: 1, borderColor: "#f59e0b40" }}>
                        <AlertCircle size={9} color="#f59e0b" />
                        <Text style={{ color: "#f59e0b", fontSize: 10 }}>Tap to assign approvers</Text>
                      </View>
                    ) : (
                      levelUsers.map((u) => (
                        <View key={u.id} className="flex-row items-center gap-1 px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
                          <View className="w-3.5 h-3.5 rounded-full items-center justify-center" style={{ backgroundColor: `hsl(${(u.id * 47) % 360} 60% 40% / 0.3)` }}>
                            <Text style={{ color: `hsl(${(u.id * 47) % 360} 60% 65%)`, fontSize: 6.5, fontFamily: fonts.heading.bold }}>{initials(u.name)}</Text>
                          </View>
                          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{u.name}</Text>
                        </View>
                      ))
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}

          {addingLevel ? (
            <View style={{ borderWidth: 2, borderColor: `${colors.primary}4d`, borderRadius: 14, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                New approval step
              </Text>
              <TextInput
                autoFocus
                value={newLevelLabel}
                onChangeText={setNewLevelLabel}
                placeholder="e.g. Site Manager, Finance Head, Director…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 10 }}
              />
              <Pressable onPress={() => setPickerForLevel("new")} className="flex-row flex-wrap items-center gap-1.5 px-3 py-2.5 rounded-lg mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
                {newLevelUserIds.length === 0 ? (
                  <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 12 }}>Choose approvers…</Text>
                ) : (
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{newLevelUserIds.length} approver{newLevelUserIds.length > 1 ? "s" : ""} selected</Text>
                )}
              </Pressable>
              <View className="flex-row gap-2">
                <Pressable onPress={confirmAddLevel} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-lg" style={{ backgroundColor: colors.primary }}>
                  <Check size={13} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>Add this step</Text>
                </Pressable>
                <Pressable onPress={() => { setAddingLevel(false); setNewLevelLabel(""); setNewLevelUserIds([]); }} className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <X size={13} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setAddingLevel(true)}
              className="flex-row items-center justify-center gap-2 py-2.5 rounded-xl"
              style={{ borderWidth: 2, borderStyle: "dashed", borderColor: colors.border, marginBottom: 12 }}
            >
              <Plus size={14} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.medium }}>
                {levels.length === 0 ? "Add first approval step" : "Add another step"}
              </Text>
            </Pressable>
          )}
        </ScrollView>

        <View className="flex-row gap-3 px-4 py-3" style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }}>
          <Pressable onPress={onClose} className="flex-1 items-center py-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Discard</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <ShieldCheck size={15} color="#fff" />}
            <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>{editing ? "Save Changes" : "Save Rule"}</Text>
          </Pressable>
        </View>
      </View>

      {activePicker && (
        <UserMultiSelectModal
          visible={pickerForLevel !== null}
          users={users}
          selectedIds={activePicker.ids}
          onChange={activePicker.set}
          onClose={() => setPickerForLevel(null)}
        />
      )}
    </Modal>
  );
}
