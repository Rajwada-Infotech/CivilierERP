// Leave: this year's balances, apply (the backend checks overlap, balance and dates), history with HR remarks,
// and withdraw while still Pending.
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react-native";
import { api, type LeaveType } from "@/api/employeeApi";
import { Screen } from "@/components/Screen";
import { Chip } from "@/components/Chip";
import { DateField } from "@/components/DateField";
import { Body, Field, Input, Key, Label, Notice, Panel, Seg, Skel, StatGrid } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate, todayIst } from "@/utils/format";

const TYPES: LeaveType[] = ["Casual", "Sick", "Earned", "Unpaid"];
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

export default function LeaveScreen() {
  const qc = useQueryClient();
  const year = Number(todayIst().slice(0, 4));
  const bal = useQuery({ queryKey: ["leave-bal", year], queryFn: () => api.balances(year) });
  const list = useQuery({ queryKey: ["leaves"], queryFn: api.leaves });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LeaveType>("Casual");
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(todayIst());
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["leave-bal"] }); qc.invalidateQueries({ queryKey: ["leaves"] }); qc.invalidateQueries({ queryKey: ["month"] }); };
  const apply = useMutation({
    mutationFn: () => api.applyLeave({ LeaveType: type, FromDate: from, ToDate: to, Reason: reason.trim() }),
    onSuccess: (r) => { setMsg({ ok: true, text: r.message }); setOpen(false); setReason(""); refresh(); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const withdraw = useMutation({ mutationFn: api.withdrawLeave, onSuccess: refresh, onError: (e: Error) => Alert.alert("Could not withdraw", e.message) });
  const b = (t: LeaveType) => bal.data?.Balances.find((x) => x.LeaveType === t);
  const n = to >= from ? days(from, to) : 0;

  return (
    <Screen refreshing={bal.isRefetching || list.isRefetching} onRefresh={() => { bal.refetch(); list.refetch(); }}>
      <Panel title={`Leave balance · ${year}`}>
        {bal.isError && <Notice>{(bal.error as Error).message}</Notice>}
        <StatGrid cols={2} size={18} loading={bal.isLoading} items={(["Casual", "Sick", "Earned"] as LeaveType[]).map((t) => ({
          label: `${t} left`, value: b(t)?.Balance ?? 0, red: (b(t)?.Balance ?? 0) <= 0,
        })).concat([{ label: "Unpaid taken", value: b("Unpaid")?.Used ?? 0, red: false }])} />
        <Body size={11} color={S.graphite}>Balance = entitled − approved − pending, for this calendar year.</Body>
      </Panel>

      {msg && <Notice tone={msg.ok ? "ink" : "red"}>{msg.text}</Notice>}

      {!open ? (
        <Key tone="ink" label="Apply for leave" icon={<Plus size={16} color={S.paper} />} onPress={() => { setOpen(true); setMsg(null); }} />
      ) : (
        <Panel title="Apply for leave">
          <Field label="Leave type">
            <Seg value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: t }))} />
          </Field>
          {type !== "Unpaid" && <Body size={11.5} color={S.graphite}>{b(type)?.Balance ?? 0} day(s) of {type} leave left</Body>}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <DateField label="From" value={from} onChange={(v) => { setFrom(v); if (to < v) setTo(v); }} style={{ flex: 1 }} />
            <DateField label="To" value={to} onChange={setTo} min={from} style={{ flex: 1 }} />
          </View>
          <Body size={12}>{n > 0 ? `${n} day(s)` : "To date is before From date"}</Body>
          <Field label="Reason" required>
            <Input value={reason} onChangeText={setReason} placeholder="Reason for the leave" maxLength={500} multiline style={{ minHeight: 70, textAlignVertical: "top" }} />
          </Field>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Key label="Cancel" onPress={() => setOpen(false)} style={{ flex: 1 }} />
            <Key tone="ink" label={apply.isPending ? "Submitting…" : "Submit"} disabled={apply.isPending || n <= 0 || !reason.trim()} onPress={() => apply.mutate()} style={{ flex: 1 }} />
          </View>
        </Panel>
      )}

      <Panel title="My applications">
        {list.isLoading ? <Skel h={60} /> : list.isError ? <Notice>{(list.error as Error).message}</Notice> : !list.data?.length ? (
          <Body color={S.graphite}>No leave applied yet.</Body>
        ) : (
          list.data.map((l) => (
            <View key={l.LeaveId} style={{ borderBottomWidth: 1, borderBottomColor: S.ruleSoft, paddingBottom: 10, gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body weight="semibold">{l.LeaveType} · {l.TotalDays} day(s)</Body>
                <Chip text={l.Status} />
              </View>
              <Body size={12} color={S.ink2}>{fmtDate(l.FromDate)}{l.ToDate !== l.FromDate ? ` – ${fmtDate(l.ToDate)}` : ""}</Body>
              {l.Reason && <Body size={11.5} color={S.graphite}>{l.Reason}</Body>}
              {l.HrRemarks && <Body size={11.5} color={l.Status === "Rejected" ? S.red : S.ink2}>HR: {l.HrRemarks}</Body>}
              {l.Status === "Pending" && (
                <Pressable onPress={() => Alert.alert("Withdraw application?", "It will be removed.", [
                  { text: "Cancel", style: "cancel" }, { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate(l.LeaveId) },
                ])}>
                  <Label color={S.red}>Withdraw</Label>
                </Pressable>
              )}
            </View>
          ))
        )}
      </Panel>
    </Screen>
  );
}
