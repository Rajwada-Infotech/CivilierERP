// RN port of src/pages/finance/Contract.tsx's detail view, on the drawing sheet as the web draws it (SheetShell with
// Back / Edit / Print / Delete keys, then ruled panels) — summary tiles,
// Contract Details card, Contract Ledger (advances/adjustments + live
// balance summary — the same transparency view as web, hitting the same
// /api/contract/:id/ledger endpoint), Parties, and Attachments. Edit
// navigates to NewContractScreen in edit mode; Delete confirms then calls
// the real DELETE endpoint; Print renders a plain HTML summary to PDF via
// expo-print and opens the share sheet (same approach as Invoice's Print).
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View, Text, ScrollView, Alert, Linking } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ArrowLeft, FileText, Wallet, Eye, Printer } from "lucide-react-native";
import { getContract, getContractLedger, deleteContract, type ContractDetail, type ContractLedgerEntry, type PartyPill, type Attachment } from "@/api/contractApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, InfoGrid, Key, Label, Notice, Panel, Press, SheetMark, SheetShell, Skel, StatGrid } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmt(n: number | null | undefined) {
  return n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
}

function notBuiltYet(title: string) {
  Alert.alert(title, `The ${title} isn't built on mobile yet. Use the web app for now.`);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Plain, print-safe HTML — mirrors InvoicePreviewScreen's buildInvoiceHtml
// approach: light/ink-cheap rather than trying to match the app's dark UI.
function buildContractHtml(c: ContractDetail, ledger: ContractLedgerEntry[]): string {
  const row = (label: string, value: string) => `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>`;
  const fmtDateHtml = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const fmtAmtHtml = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

  const ledgerRows = ledger.length
    ? `<h3>Contract Ledger</h3><table class="tbl">
        <tr><th>Date</th><th>Type</th><th>Source</th><th>Amount</th></tr>
        ${ledger.map((e) => `<tr><td>${fmtDateHtml(e.CreatedAt)}</td><td>${e.TxnType}</td><td>${e.SourceDocNo || `${e.SourceType} #${e.SourceId}`}</td><td>${e.Amount >= 0 ? "+" : "−"}${fmtAmtHtml(Math.abs(e.Amount))}</td></tr>`).join("")}
      </table>`
    : "";

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 24px; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          h2 { font-size: 13px; color: #555; margin: 0 0 20px; font-weight: normal; }
          h3 { font-size: 13px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #333; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
          td, th { padding: 6px 4px; border-bottom: 1px solid #eee; font-size: 12px; text-align: left; }
          .lbl { color: #666; width: 40%; }
          .val { font-weight: 600; }
          .tbl th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; color: #666; }
        </style>
      </head>
      <body>
        <h1>${c.DocNo || "Contract"}</h1>
        <h2>${c.Status} · ${c.FinYear || ""}</h2>
        <table>
          ${row("Contract Date", fmtDateHtml(c.ContractDate))}
          ${row("Company", c.CompanyName || "—")}
          ${row("Project", c.ProjectName || "—")}
          ${row("Contact Person", c.ContactPerson || "—")}
          ${row("Contract Type", c.NatureOfContract || "—")}
          ${row("Contract Amount", fmtAmtHtml(c.ContractAmount))}
        </table>
        ${c.Reason ? `<h3>Purpose</h3><p style="font-size:12px;">${c.Reason}</p>` : ""}
        ${ledgerRows}
        ${c.TermsAndConditions ? `<h3>Terms &amp; Conditions</h3><p style="font-size:12px; white-space:pre-wrap;">${c.TermsAndConditions}</p>` : ""}
      </body>
    </html>
  `;
}

export default function ContractDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const route = useRoute<RouteProp<MainStackParamList, "ContractDetail">>();
  const { id } = route.params;

  const { data: c, isLoading, isError } = useQuery({
    queryKey: ["contract", id],
    queryFn: () => getContract(id),
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ["contract-ledger", id],
    queryFn: () => getContractLedger(id),
    enabled: !!c,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteContract(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
      navigation.goBack();
    },
    onError: (e: Error) => Alert.alert("Delete failed", e.message),
  });

  const confirmDelete = () => {
    Alert.alert("Delete Contract?", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  };

  const handlePrint = async () => {
    if (!c) return;
    try {
      const html = buildContractHtml(c, ledgerData?.ledger ?? []);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: c.DocNo || "Contract" });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e: any) {
      Alert.alert("Print failed", e?.message ?? "Could not generate the contract PDF.");
    }
  };

  /** Web's StatusBadge. */
  const statusMark = (status: string) => {
    const st = (status || "Draft").toLowerCase();
    const tone = st === "active" || st === "approved" ? "done" : st === "expired" || st === "deleted" || st === "rejected" ? "stopped" : "waiting";
    return <SheetMark text={status || "Draft"} tone={tone} />;
  };

  if (isLoading || isError || !c) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="Contract"
          action={<Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />}
        >
          {isLoading ? (
            <>
              <Skel h={60} />
              <Skel h={120} />
              <Skel h={120} />
            </>
          ) : (
            <Notice>Could not load this contract.</Notice>
          )}
        </SheetShell>
      </ScrollView>
    );
  }

  const attachments = parseJson<Attachment[]>(c.Attachments, []);
  const parties = parseJson<PartyPill[]>(c.Parties, []);
  // As on the web: a contract waiting on approval, or approved, is not edited.
  const canEdit = c.Status !== "Pending" && c.Status !== "Approved";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title={c.DocNo || "Contract"}
        subtitle={`${fmtDate(c.DocDate)} · ${c.FinYear || ""}`}
        action={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} />
            {canEdit && <Key tone="ink" label="Edit" onPress={() => navigation.navigate("NewContract", { id: c.ContractId })} />}
            <Key label="Print" icon={<Printer size={13} color={S.ink} />} onPress={handlePrint} />
            <Key tone="red" label={deleteMutation.isPending ? "Deleting…" : "Delete"} onPress={confirmDelete} disabled={deleteMutation.isPending} />
          </View>
        }
      >
        <InfoGrid
          items={[
            { label: "Status", value: <ApprovalStatusChain table="Contract" recordId={c.ContractId} fallback={statusMark(c.Status)} /> },
            { label: "Doc Date", value: fmtDate(c.DocDate) },
            { label: "Contract Date", value: fmtDate(c.ContractDate) },
            { label: "Financial Year", value: c.FinYear || "—" },
            { label: "Company", value: c.CompanyName || "—" },
            { label: "Project", value: c.ProjectName || "—" },
          ]}
        />

        <Panel title="Contract details">
          <InfoGrid
            items={[
              { label: "Contact Person", value: c.ContactPerson || "—" },
              { label: "Contract Type", value: c.NatureOfContract || "—" },
              { label: "Contract Amount", value: <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{fmtAmt(c.ContractAmount)}</Text> },
              {
                label: "Period",
                wide: true,
                value:
                  c.ContractStartDate || c.ContractEndDate
                    ? `${c.ContractStartDate ? fmtDate(c.ContractStartDate) : ""}${c.ContractStartDate && c.ContractEndDate ? " – " : ""}${c.ContractEndDate ? fmtDate(c.ContractEndDate) : ""}`
                    : "—",
              },
            ]}
          />
          {!!c.Reason && (
            <View style={{ gap: 4 }}>
              <Label>Purpose / Description</Label>
              <Body size={13} color={S.ink2}>{c.Reason}</Body>
            </View>
          )}
          {!!c.Remarks && (
            <View style={{ gap: 4 }}>
              <Label>Remarks</Label>
              <Body size={13} color={S.ink2}>{c.Remarks}</Body>
            </View>
          )}
        </Panel>

        {/* Advances paid / received against this contract, the adjustments made when an invoice or expense booking is
            raised against it, and the live unallocated balance: the transparency view of the same money that posts to
            the party in the General Ledger. */}
        <Panel title="Contract ledger" icon={<Wallet size={14} color={S.ink} />}>
          {ledgerLoading ? (
            <>
              <Skel h={60} />
              <Skel h={30} />
            </>
          ) : ledgerData ? (
            <>
              <StatGrid
                size={16}
                items={[
                  { label: "Total advance", value: fmtAmt(ledgerData.summary.TotalAdvance) },
                  { label: "Allocated", value: fmtAmt(ledgerData.summary.TotalAllocated) },
                  { label: "Unallocated balance", value: fmtAmt(ledgerData.summary.UnallocatedBalance) },
                  { label: "Documented", value: fmtAmt(ledgerData.summary.TotalDocumented) },
                ]}
              />
              {ledgerData.summary.OverBilled && (
                <Notice tone="ink">Total documented against this contract exceeds its contract value: legitimate for change orders, but worth a look.</Notice>
              )}
              {ledgerData.ledger.length === 0 ? (
                <Body size={12.5} color={S.graphite}>
                  No advances or adjustments recorded yet. Pay this contractor or supplier with the contract selected on the Payment page to start one.
                </Body>
              ) : (
                <View>
                  {ledgerData.ledger.map((entry, i) => {
                    const positive = entry.Amount >= 0;
                    return (
                      <View key={entry.LedgerId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                          <SheetMark text={entry.TxnType} tone={positive ? "done" : "moving"} />
                          <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 12, color: S.ink }}>
                            {entry.SourceDocNo || `${entry.SourceType} #${entry.SourceId}`}
                          </Text>
                          <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>
                            {fmtDate(entry.CreatedAt)}
                            {entry.Remarks ? ` · ${entry.Remarks}` : ""}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 14, color: positive ? S.blue : S.ink }}>
                          {positive ? "+" : "−"}
                          {fmtAmt(Math.abs(entry.Amount))}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <Body size={12.5} color={S.graphite}>Ledger unavailable.</Body>
          )}
        </Panel>

        {parties.length > 0 && (
          <Panel title="Parties">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {parties.map((p, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: S.line40 }}>
                  <Label>{p.type}</Label>
                  <Body size={12.5}>{p.name}</Body>
                </View>
              ))}
            </View>
          </Panel>
        )}

        {attachments.length > 0 && (
          <Panel title={`Attachments (${attachments.length})`}>
            {attachments.map((att, i) => (
              <Press
                key={i}
                onPress={() => Linking.openURL(att.url).catch(() => notBuiltYet("Attachment preview"))}
                style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
              >
                <View style={{ width: 32, height: 32, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                  <FileText size={14} color={S.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12.5, fontFamily: fonts.body.medium }}>{att.name}</Text>
                  {!!att.size && <Body size={11} color={S.graphite}>{`${(att.size / 1024).toFixed(1)} KB`}</Body>}
                </View>
                <Eye size={14} color={S.graphite} />
              </Press>
            ))}
          </Panel>
        )}

        {!!c.TermsAndConditions && (
          <Panel title="Terms & conditions">
            <Body size={13} color={S.ink2}>{c.TermsAndConditions}</Body>
          </Panel>
        )}
      </SheetShell>
    </ScrollView>
  );
}
