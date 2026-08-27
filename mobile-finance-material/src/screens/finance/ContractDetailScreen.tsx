// RN port of src/pages/finance/Contract.tsx's detail view — summary tiles,
// Contract Details card, Contract Ledger (advances/adjustments + live
// balance summary — the same transparency view as web, hitting the same
// /api/contract/:id/ledger endpoint), Parties, and Attachments. Edit
// navigates to NewContractScreen in edit mode; Delete confirms then calls
// the real DELETE endpoint; Print renders a plain HTML summary to PDF via
// expo-print and opens the share sheet (same approach as Invoice's Print).
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert, Linking } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { FileText, Wallet, ArrowDownCircle, ArrowUpCircle, AlertTriangle, Paperclip, Eye, Printer } from "lucide-react-native";
import { getContract, getContractLedger, deleteContract, type ContractDetail, type ContractLedgerEntry, type PartyPill, type Attachment } from "@/api/contractApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = "#8b5cf6";

const STATUS_STYLE: Record<string, string> = {
  Active: "#8b5cf6",
  Expired: "#ef4444",
  Draft: "#f59e0b",
  Approved: "#10b981",
  Pending: "#f59e0b",
};

const PARTY_COLOR: Record<string, string> = {
  Supplier: "#3b82f6",
  Contractor: "#f59e0b",
  Applicant: "#10b981",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmt(n: number | null | undefined) {
  return n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
}

function notBuiltYet(title: string) {
  Alert.alert(title, `The ${title} isn't built on mobile yet — use the web app for now.`);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number; color?: string }>; children: string }) {
  return (
    <View className="flex-row items-center gap-1.5 mb-3">
      <Icon size={11} color={ACCENT} />
      <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1.2 }}>
        {children}
      </Text>
    </View>
  );
}

function InfoTile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <View
      className="rounded-xl px-3 py-2.5"
      style={{ width: "48%", marginBottom: 8, backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}
    >
      <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      {typeof value === "string" ? (
        <Text numberOfLines={1} style={{ color: accent ?? colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
          {value}
        </Text>
      ) : (
        <View style={{ marginTop: 4 }}>{value}</View>
      )}
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_STYLE[status] ?? colors.mutedForeground;
  return (
    <View className="px-2 py-1 rounded-md self-start" style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 10, fontFamily: fonts.heading.semibold }}>{status || "Draft"}</Text>
    </View>
  );
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

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (isError || !c) {
    return (
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: colors.background }}>
        <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.body.medium, textAlign: "center" }}>
          Could not load this contract.
        </Text>
      </View>
    );
  }

  const attachments = parseJson<Attachment[]>(c.Attachments, []);
  const parties = parseJson<PartyPill[]>(c.Parties, []);

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* Header */}
      <View className="flex-row items-center gap-2 mb-1">
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${ACCENT}22`, borderWidth: 1, borderColor: `${ACCENT}40` }}>
          <FileText size={14} color={ACCENT} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 16, flexShrink: 1 }}>
          {c.DocNo || "Contract"}
        </Text>
      </View>
      <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 10, fontFamily: fonts.body.regular, marginLeft: 40 }}>
        {fmtDate(c.DocDate)} · {c.FinYear || ""}
      </Text>

      <View className="flex-row gap-2 mt-4 mb-1">
        <Pressable
          onPress={() => navigation.navigate("NewContract", { id: c.ContractId })}
          className="flex-1 rounded-xl items-center"
          style={{ backgroundColor: ACCENT, paddingVertical: 10 }}
        >
          <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={handlePrint}
          className="rounded-xl items-center justify-center"
          style={{ paddingHorizontal: 16, borderWidth: 1, borderColor: `${colors.border}80` }}
        >
          <Printer size={15} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={deleteMutation.isPending}
          className="rounded-xl items-center justify-center"
          style={{ paddingHorizontal: 16, borderWidth: 1, borderColor: `${colors.destructive}4d`, opacity: deleteMutation.isPending ? 0.6 : 1 }}
        >
          {deleteMutation.isPending ? <ActivityIndicator size="small" color={colors.destructive} /> : <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Delete</Text>}
        </Pressable>
      </View>

      {/* Summary */}
      <View className="mt-6">
        <View className="flex-row flex-wrap justify-between">
          <InfoTile label="Status" value={<StatusPill status={c.Status} />} />
          <InfoTile label="Contract Date" value={fmtDate(c.ContractDate)} />
          <InfoTile label="Company" value={c.CompanyName || "—"} />
          <InfoTile label="Project" value={c.ProjectName || "—"} />
        </View>
      </View>

      {/* Contract Details */}
      <View className="mt-4">
        <SectionTitle icon={FileText}>Contract Details</SectionTitle>
        <View className="flex-row flex-wrap justify-between">
          <InfoTile label="Contact Person" value={c.ContactPerson || "—"} />
          <InfoTile label="Contract Type" value={c.NatureOfContract || "—"} />
          <InfoTile label="Contract Amount" value={fmtAmt(c.ContractAmount)} accent={ACCENT} />
          <InfoTile
            label="Period"
            value={
              c.ContractStartDate || c.ContractEndDate
                ? `${c.ContractStartDate ? fmtDate(c.ContractStartDate) : ""}${c.ContractStartDate && c.ContractEndDate ? " – " : ""}${c.ContractEndDate ? fmtDate(c.ContractEndDate) : ""}`
                : "—"
            }
          />
        </View>
        {!!c.Reason && (
          <View className="rounded-xl px-3.5 py-3 mt-1" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
            <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase", marginBottom: 3 }}>Purpose / Description</Text>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.regular, lineHeight: 17 }}>{c.Reason}</Text>
          </View>
        )}
        {!!c.Remarks && (
          <View className="rounded-xl px-3.5 py-3 mt-2" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
            <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase", marginBottom: 3 }}>Remarks</Text>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.regular, lineHeight: 17 }}>{c.Remarks}</Text>
          </View>
        )}
      </View>

      {/* Contract Ledger */}
      <View className="mt-4">
        <SectionTitle icon={Wallet}>Contract Ledger</SectionTitle>
        {ledgerLoading ? (
          <View className="py-8 items-center">
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : ledgerData ? (
          <>
            <View className="flex-row flex-wrap justify-between">
              <InfoTile label="Total Advance" value={fmtAmt(ledgerData.summary.TotalAdvance)} accent="#10b981" />
              <InfoTile label="Allocated" value={fmtAmt(ledgerData.summary.TotalAllocated)} accent="#f59e0b" />
              <InfoTile label="Unallocated Balance" value={fmtAmt(ledgerData.summary.UnallocatedBalance)} accent={ACCENT} />
              <InfoTile label="Documented" value={fmtAmt(ledgerData.summary.TotalDocumented)} />
            </View>

            {ledgerData.summary.OverBilled && (
              <View className="flex-row items-center gap-2 px-3.5 py-2.5 rounded-xl mb-2" style={{ backgroundColor: "#f59e0b1a", borderWidth: 1, borderColor: "#f59e0b33" }}>
                <AlertTriangle size={13} color="#f59e0b" />
                <Text style={{ color: "#f59e0b", fontSize: 10.5, fontFamily: fonts.body.medium, flex: 1 }}>
                  Total documented exceeds contract value — expected for change orders, worth a look otherwise.
                </Text>
              </View>
            )}

            {ledgerData.ledger.length === 0 ? (
              <Text className="py-4 text-center" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>
                No advances or adjustments recorded yet.
              </Text>
            ) : (
              <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
                {ledgerData.ledger.map((entry, i) => {
                  const positive = entry.Amount >= 0;
                  return (
                    <View
                      key={entry.LedgerId}
                      className="flex-row items-center justify-between px-3.5 py-2.5"
                      style={i < ledgerData.ledger.length - 1 ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}50` } : undefined}
                    >
                      <View className="flex-1 min-w-0 pr-2">
                        <View className="flex-row items-center gap-1.5">
                          {positive ? <ArrowDownCircle size={11} color="#10b981" /> : <ArrowUpCircle size={11} color="#f59e0b" />}
                          <Text style={{ color: positive ? "#10b981" : "#f59e0b", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{entry.TxnType}</Text>
                        </View>
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>
                          {entry.SourceDocNo || `${entry.SourceType} #${entry.SourceId}`} · {fmtDate(entry.CreatedAt)}
                        </Text>
                      </View>
                      <Text style={{ color: positive ? "#10b981" : "#f59e0b", fontFamily: fonts.heading.bold, fontSize: 12.5 }}>
                        {positive ? "+" : "−"}{fmtAmt(Math.abs(entry.Amount))}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>Ledger unavailable.</Text>
        )}
      </View>

      {/* Parties */}
      {parties.length > 0 && (
        <View className="mt-4">
          <SectionTitle icon={FileText}>Parties</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {parties.map((p, i) => {
              const color = PARTY_COLOR[p.type] ?? colors.mutedForeground;
              return (
                <View key={i} className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}33` }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                  <Text style={{ color, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>{p.type}</Text>
                  <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.medium }}>{p.name}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <View className="mt-4">
          <SectionTitle icon={Paperclip}>{`Attachments (${attachments.length})`}</SectionTitle>
          {attachments.map((att, i) => (
            <Pressable
              key={i}
              onPress={() => Linking.openURL(att.url).catch(() => notBuiltYet("Attachment preview"))}
              className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-xl mb-1.5"
              style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}
            >
              <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${ACCENT}22` }}>
                <FileText size={14} color={ACCENT} />
              </View>
              <View className="flex-1 min-w-0">
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{att.name}</Text>
                {!!att.size && <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{(att.size / 1024).toFixed(1)} KB</Text>}
              </View>
              <Eye size={14} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      )}

      {/* T&C */}
      {!!c.TermsAndConditions && (
        <View className="mt-4 mb-2">
          <SectionTitle icon={FileText}>Terms & Conditions</SectionTitle>
          <View className="rounded-xl px-3.5 py-3" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.regular, lineHeight: 17 }}>{c.TermsAndConditions}</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
