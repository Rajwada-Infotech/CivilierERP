// OC/CC Board — project-level monitoring view: which blocks have certificates,
// which bookings are waiting for one before possession can proceed.
// Endpoint: GET /api/crm/oc-cc/board → { projects, blocks, held }
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Award, CheckCircle2, ChevronRight, Clock, FilePlus2, XCircle } from "lucide-react-native";
import { crmGet, type Row } from "@/api/crmApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import { Kv, Pill, Section, Tap, fmtDate, money } from "./ui";

type ProjectRow = Row & {
  ProjectId: number; ProjectName: string;
  ActiveBlocks: number; CoveredBlocks: number;
  Received: number; ReceivedDate: string | null;
  LiveBookings: number; WaitingBookings: number;
};
type BlockRow = Row & {
  BlockId: number; BlockName: string; ProjectId: number;
  Covered: number; CertType: string | null; CertificateNo: string | null;
  IsActive: number; LiveBookings: number;
};
type HeldRow = Row & {
  BookingId: number; BookingNo: string; ProjectId: number; BlockName: string | null;
  ApplicantName: string; Mobile: string | null; UnitNo: string | null;
  ProjectName: string; AgreementStatus: string | null;
  RequiredAmount: number; Collected: number; Balance: number;
};
type BoardData = { projects: ProjectRow[]; blocks: BlockRow[]; held: HeldRow[] };

function CoverageBar({ covered, total }: { covered: number; total: number }) {
  const b = useBrand();
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const color = pct === 100 ? b.success : pct > 0 ? b.warning : b.danger;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
          {covered}/{total} blocks covered
        </Text>
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color }}>{pct}%</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: b.border, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: 5, backgroundColor: color }} />
      </View>
    </View>
  );
}

export default function CrmOcCcBoardScreen() {
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const boardQ = useQuery<BoardData>({
    queryKey: ["crm-oc-cc-board"],
    queryFn: () => crmGet("/api/crm/oc-cc/board"),
  });

  if (boardQ.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (boardQ.error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {(boardQ.error as Error).message}
        </Text>
      </View>
    );
  }

  const { projects = [], blocks = [], held = [] } = boardQ.data ?? {};
  const totalWaiting = projects.reduce((s, p) => s + (p.WaitingBookings ?? 0), 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Quick Action: Manage Certificates */}
      <Tap
        onPress={() => nav.navigate("CrmRegister", { register: "oc-cc" })}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 16,
          backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Award size={18} color={b.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Manage Certificates</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>Add, edit, or view certificate numbers and issue dates</Text>
        </View>
        <ChevronRight size={18} color={b.textFaint} />
      </Tap>

      {/* Summary banner */}
      {totalWaiting > 0 ? (
        <View style={{ backgroundColor: b.warningSoft, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: b.warning, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Clock size={18} color={b.warning} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: b.textPrimary }}>
            {totalWaiting} booking{totalWaiting !== 1 ? "s" : ""} waiting for certificate before possession
          </Text>
        </View>
      ) : projects.length > 0 ? (
        <View style={{ backgroundColor: b.successSoft, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: b.success, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={18} color={b.success} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: b.textPrimary }}>All bookings have certificate coverage</Text>
        </View>
      ) : null}

      {/* Per-project cards */}
      {projects.map((p) => {
        const projBlocks = blocks.filter((bl) => bl.ProjectId === p.ProjectId);
        const projHeld = held.filter((h) => h.ProjectId === p.ProjectId);
        return (
          <Section key={p.ProjectId} title={p.ProjectName}>
            <View style={{ gap: 10 }}>
              {p.ActiveBlocks > 0 ? (
                <CoverageBar covered={p.CoveredBlocks ?? 0} total={p.ActiveBlocks ?? 0} />
              ) : (
                <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textFaint }}>No active blocks</Text>
              )}

              {/* Block rows */}
              {projBlocks.length > 0 ? (
                <View style={{ gap: 6 }}>
                  {projBlocks.map((bl) => (
                    <View key={bl.BlockId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {bl.Covered ? (
                        <CheckCircle2 size={14} color={b.success} />
                      ) : (
                        <XCircle size={14} color={b.danger} />
                      )}
                      <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>
                        {bl.BlockName || `Block ${bl.BlockId}`}
                      </Text>
                      {bl.Covered ? (
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                          {bl.CertType}{bl.CertificateNo ? ` · ${bl.CertificateNo}` : ""}
                        </Text>
                      ) : (
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.danger }}>Pending</Text>
                      )}
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: 12 }}>
                {p.WaitingBookings > 0 ? (
                  <Pill label={`${p.WaitingBookings} waiting`} tone={b.warning} />
                ) : null}
                {p.LiveBookings > 0 ? (
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{p.LiveBookings} live booking{p.LiveBookings !== 1 ? "s" : ""}</Text>
                ) : null}
              </View>

              {/* Held bookings for this project */}
              {projHeld.length > 0 ? (
                <View style={{ marginTop: 4, gap: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.textSecondary }}>Held bookings</Text>
                  {projHeld.map((h) => (
                    <View key={h.BookingId} style={{ backgroundColor: b.surfaceCard, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: b.border, gap: 4 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{h.ApplicantName}</Text>
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.accent }}>{h.BookingNo}</Text>
                      </View>
                      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                        {[h.UnitNo, h.BlockName].filter(Boolean).join(" · ")}
                      </Text>
                      {h.AgreementStatus ? (
                        <Kv label="Agreement" value={h.AgreementStatus} />
                      ) : null}
                      <View style={{ flexDirection: "row", gap: 16, marginTop: 2 }}>
                        <Kv label="Required" value={money(h.RequiredAmount)} />
                        <Kv label="Collected" value={money(h.Collected)} />
                        {h.Balance > 0 ? <Kv label="Balance" value={money(h.Balance)} /> : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </Section>
        );
      })}

      {projects.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 48 }}>
          <Award size={40} color={b.textFaint} />
          <Text style={{ fontSize: 14, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 12, textAlign: "center" }}>
            No OC/CC data available.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
