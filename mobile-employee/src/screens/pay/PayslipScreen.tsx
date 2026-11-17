// One payslip: earnings, deductions, net. Share sends a PDF made on the phone (expo-print) from the same figures.
import { Alert, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Share2 } from "lucide-react-native";
import { api, type Payslip } from "@/api/employeeApi";
import { Screen } from "@/components/Screen";
import { Body, InfoGrid, Key, Label, Notice, Panel, Skel } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate, MONTHS, rupee } from "@/utils/format";
import type { MainParamList } from "@/navigation/MainStack";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function html(p: Payslip) {
  const rows = (t: string, l: Payslip["Earnings"]) => `<h3>${t}</h3><table>${l.map((x) => `<tr><td>${esc(x.HeadName)}</td><td class=r>${rupee(x.Amount)}</td></tr>`).join("")}</table>`;
  return `<html><head><meta name=viewport content="width=device-width"><style>body{font-family:Helvetica;padding:24px;color:#111}table{width:100%;border-collapse:collapse}td{padding:6px;border-bottom:1px solid #ddd}.r{text-align:right}h1{font-size:20px;margin:0}h3{margin:18px 0 6px}</style></head><body>
  <h1>${esc(p.Employee.CompanyName)}</h1><p>Payslip · ${MONTHS[p.PeriodMonth - 1]} ${p.PeriodYear}</p>
  <table><tr><td>Employee</td><td>${esc(p.Employee.EmployeeName)} (${esc(p.Employee.EmployeeCode)})</td></tr><tr><td>Designation</td><td>${esc(p.Employee.Designation)}</td></tr><tr><td>Department</td><td>${esc(p.Employee.Department)}</td></tr><tr><td>Bank</td><td>${esc(p.Employee.BankName)} ${esc(p.Employee.BankAccountNumber)}</td></tr></table>
  ${rows("Earnings", p.Earnings)}${rows("Deductions", p.Deductions)}
  <table><tr><td><b>Gross</b></td><td class=r>${rupee(p.GrossSalary)}</td></tr><tr><td><b>Deductions</b></td><td class=r>${rupee(p.TotalEmployeeDeduction)}</td></tr><tr><td><b>Net pay</b></td><td class=r><b>${rupee(p.NetSalary)}</b></td></tr></table></body></html>`;
}

export default function PayslipScreen({ route }: NativeStackScreenProps<MainParamList, "Payslip">) {
  const q = useQuery({ queryKey: ["payslip", route.params.runId], queryFn: () => api.payslip(route.params.runId) });
  const p = q.data;
  const share = async () => {
    if (!p) return;
    try {
      const { uri } = await Print.printToFileAsync({ html: html(p) });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Payslip" });
    } catch (e) {
      Alert.alert("Could not create the PDF", e instanceof Error ? e.message : "");
    }
  };
  const Lines = ({ l }: { l: Payslip["Earnings"] }) => (
    <>{l.length ? l.map((x, i) => (
      <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}><Body>{x.HeadName}</Body><Body>{rupee(x.Amount)}</Body></View>
    )) : <Body color={S.graphite}>None</Body>}</>
  );

  if (q.isLoading) return <Screen><Skel h={200} /></Screen>;
  if (q.isError || !p) return <Screen><Notice>{(q.error as Error)?.message ?? "Payslip not found"}</Notice></Screen>;
  return (
    <Screen>
      <Panel title={`Payslip · ${MONTHS[p.PeriodMonth - 1]} ${p.PeriodYear}`}>
        <InfoGrid items={[
          { label: "Employee", value: `${p.Employee.EmployeeName} (${p.Employee.EmployeeCode})`, wide: true },
          { label: "Designation", value: p.Employee.Designation ?? "—" },
          { label: "Department", value: p.Employee.Department ?? "—" },
          { label: "Joined", value: fmtDate(p.Employee.JoiningDate) },
          { label: "Bank", value: [p.Employee.BankName, p.Employee.BankAccountNumber].filter(Boolean).join(" ") || "—" },
        ]} />
      </Panel>
      <Panel title="Earnings"><Lines l={p.Earnings} /></Panel>
      <Panel title="Deductions"><Lines l={p.Deductions} /></Panel>
      <Panel title="Net pay">
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label>Gross</Label><Body>{rupee(p.GrossSalary)}</Body></View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label>Deductions</Label><Body>{rupee(p.TotalEmployeeDeduction)}</Body></View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label color={S.ink}>Net pay</Label><Body weight="semibold" size={16}>{rupee(p.NetSalary)}</Body></View>
      </Panel>
      <Key tone="ink" label="Share as PDF" icon={<Share2 size={16} color={S.paper} />} onPress={share} />
    </Screen>
  );
}
