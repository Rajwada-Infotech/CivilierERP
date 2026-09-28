import { useState } from "react";
import { ScrollView, View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIORITIES, createTask, getAssignableUsers, getDepartments, type Priority } from "@/api/followupApi";
import { Btn, Chip, Label, Picker, TextField } from "@/components/formKit";
import { colors } from "@/theme/colors";

export default function TaskFormScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("Normal");
  const [assignee, setAssignee] = useState<number | null>(null);
  const [dept, setDept] = useState<number | null>(null);
  const users = useQuery({ queryKey: ["assignable-users"], queryFn: getAssignableUsers });
  const depts = useQuery({ queryKey: ["departments"], queryFn: getDepartments });

  const save = useMutation({
    mutationFn: () =>
      createTask({
        Subject: subject.trim(),
        Details: details.trim() || undefined,
        Department: depts.data?.find((d) => d.Id === dept)?.Name,
        DueDate: due.trim() || undefined,
        Priority: priority,
        AssignedTo: assignee ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      nav.goBack();
    },
    onError: (e: Error) => Alert.alert("Could not create task", e.message),
  });

  const submit = () => {
    if (!subject.trim()) return Alert.alert("Subject is required");
    if (due.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(due.trim())) return Alert.alert("Due date must be YYYY-MM-DD");
    save.mutate();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <TextField label="Subject *" value={subject} onChangeText={setSubject} />
      <TextField label="Details" value={details} onChangeText={setDetails} multiline />
      <Picker label="Assign To" value={assignee} options={(users.data ?? []).map((u) => ({ id: u.id, name: u.name }))} onChange={setAssignee} />
      <Picker label="Department" value={dept} options={(depts.data ?? []).map((d) => ({ id: d.Id, name: d.Name }))} onChange={setDept} />
      <TextField label="Due Date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="2026-10-31" autoCapitalize="none" />
      <Label>Priority</Label>
      <View className="flex-row flex-wrap mb-4">
        {PRIORITIES.map((p) => <Chip key={p} label={p} active={priority === p} onPress={() => setPriority(p)} />)}
      </View>
      <Btn label="Create Task" onPress={submit} busy={save.isPending} />
    </ScrollView>
  );
}
