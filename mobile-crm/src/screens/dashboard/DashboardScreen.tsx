// Home — the company at a glance (crmDashboard.js GET /, the same figures the CRM tab reads; nothing per booking):
// the greeting with the collection ring, the project picker, what needs attention as tiles, the money band, this
// month, the pipeline, collection per project and the seven-day lookahead.
import { useState } from "react";
import { Text, View } from "react-native";
import { AlertTriangle, CheckCircle2 } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { roleText } from "@/navigation/TopHeader";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { formatCompactINR } from "@/utils/formatCurrency";
import {
  ATTENTION, CollectionPerProject, MoneyFigures, Pipeline, ProjectChips, ThisMonthCard, WeekAhead, useCrmDashboard, useOpenRegister,
} from "@/screens/crm/CrmDashboardScreen";
import { AccentAvatar, Empty, ErrorText, Heading, HeroSurface, Loading, ON_HERO, Page, Ring, Tap, useCardStyle } from "@/screens/crm/ui";

const n0 = (v: unknown) => Number(v) || 0;
const short = (v: unknown) => `₹${formatCompactINR(v)}`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const initials = (name?: string | null) => (name || "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);

/** The top card: who, today, and the collection — paid of due as a ring, outstanding beside it. */
function Hero({ d, name, role }: { d: any; name: string; role: string }) {
  const p = d?.payments ?? {};
  const due = n0(p.TotalDue);
  const paid = n0(p.TotalPaid);
  const outstanding = Math.max(0, due - paid - n0(p.WithFinance));
  const pct = due ? Math.min(100, (paid / due) * 100) : 0;
  const overdue = n0(d?.alerts?.overduePayments);
  return (
    <HeroSurface padding={20}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AccentAvatar text={initials(name)} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 19, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.3 }}>
            {greeting()}{name ? `, ${name.split(" ")[0]}` : ""}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary, marginTop: 2 }}>
            {[role, new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: ON_HERO.glass, marginVertical: 18 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <Ring pct={pct} size={104} stroke={10} color="#FFFFFF" track={ON_HERO.glass}>
          <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{Math.round(pct)}%</Text>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>collected</Text>
        </Ring>
        <View style={{ flex: 1, gap: 10 }}>
          <View>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Outstanding</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 26, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.6 }}>{short(outstanding)}</Text>
          </View>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>{short(paid)} paid of {short(due)} due</Text>
          {overdue ? (
            <View style={{ flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(248,113,113,0.24)" }}>
              <AlertTriangle size={12} color="#FECACA" />
              <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#FECACA" }}>{overdue} overdue</Text>
            </View>
          ) : null}
        </View>
      </View>
    </HeroSurface>
  );
}

/** What needs attention as a two-column grid of tiles; each opens its list when the person has a right on it. */
function AttentionTiles({ d }: { d: any }) {
  const b = useBrand();
  const openRegister = useOpenRegister();
  const alerts = d?.alerts ?? {};
  const items = ATTENTION.filter((a) => n0(alerts[a.key]) > 0);
  if (!items.length) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, backgroundColor: b.successSoft }}>
        <CheckCircle2 size={20} color={b.success} />
        <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.heading.semibold, color: b.success }}>Nothing needs attention.</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((a) => {
        const tone = a.hot ? b.danger : b.accent;
        const open = openRegister(a.register);
        return (
          <Tap key={a.key} disabled={!open} onPress={open}
            style={({ pressed }) => ({ flexGrow: 1, flexBasis: "45%", borderRadius: 18, padding: 14, gap: 6, backgroundColor: b.surfaceCard,
              borderWidth: 1, borderColor: a.hot ? `${b.danger}55` : b.border, opacity: pressed ? 0.75 : 1 })}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 26, fontFamily: fonts.heading.semibold, color: tone, letterSpacing: -0.5, fontVariant: ["tabular-nums"] }}>{n0(alerts[a.key])}</Text>
              {a.hot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: b.danger }} /> : null}
            </View>
            <Text numberOfLines={2} style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{a.label}</Text>
            <Text numberOfLines={2} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{a.note}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

export default function HomeScreen() {
  const b = useBrand();
  const card = useCardStyle();
  const { currentUser, canAccessPage } = useAuth();
  const sees = canAccessPage("crm-dashboard");
  const [projectId, setProjectId] = useState<number | null>(null);
  const allQ = useCrmDashboard(null, sees);
  const q = useCrmDashboard(projectId, sees);
  const d = q.data;
  const name = currentUser?.name || "";
  const role = roleText(currentUser?.role);

  if (!sees) {
    return (
      <Page tab gap={18}>
        <Hero d={null} name={name} role={role} />
        <View style={{ ...card, padding: 18 }}>
          <Empty text="The dashboard needs the CRM Dashboard right. Ask your admin for Menu Rights." />
        </View>
      </Page>
    );
  }

  return (
    <Page tab gap={18} onRefresh={() => Promise.all([allQ.refetch(), q.refetch()])}>
      {q.error ? <ErrorText error={q.error} /> : !d ? <Loading /> : (
        <>
          <Hero d={d} name={name} role={role} />
          <ProjectChips projects={allQ.data?.projects ?? []} value={projectId} onChange={setProjectId} />

          <View style={{ gap: 10 }}>
            <Heading title="Needs attention" />
            <AttentionTiles d={d} />
          </View>

          <View style={{ gap: 10 }}>
            <Heading title="Collection" />
            <MoneyFigures d={d} />
          </View>

          <View style={{ gap: 10 }}>
            <Heading title="This month" />
            <ThisMonthCard d={d} />
          </View>

          <View>
            <Pipeline d={d} />
            {projectId == null ? <CollectionPerProject d={d} /> : null}
            <WeekAhead d={d} />
          </View>
        </>
      )}
    </Page>
  );
}
