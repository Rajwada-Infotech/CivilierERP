// Any CRM list (crmRegisters.ts) on the phone: a search box, the statuses present as quick filters, a Filter & sort
// sheet (project, period, order), and one card per row with the buyer's Call / WhatsApp keys and the list's own job
// (Log call). Tap a card for the booking, customer, ticket or document. The same rows the web page shows.
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, Plus, Search, SlidersHorizontal, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { DataList } from "@/components/list/DataList";
import { crmGet, type Row } from "@/api/crmApi";
import { openDocument } from "@/utils/documents";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { pairParent, registerByKey, type CrmOpen, type CrmRegister } from "./crmRegisters";
import { AccentAvatar, ActionKey, CRM, ContactKeys, Pill, useCardStyle } from "./ui";

const ALL = "All";

/** The pages a card may open: a booking with Bookings or Payment Milestones rights, a customer with Customer 360, a
 * ticket with Service Tickets. */
export function useCrmCanOpen() {
  const { canAccessPage, canDoAction } = useAuth();
  return (o: CrmOpen | null | undefined): o is CrmOpen =>
    !!o && (o.to === "document" || (o.to === "application" ? canDoAction("crm-applications", "edit") :
      (o.to === "booking" ? canAccessPage("crm-bookings") || canAccessPage("crm-payments")
        : o.to === "ticket" ? canAccessPage("crm-service-tickets")
        : o.to === "construction-updates" ? canAccessPage("crm-construction-updates")
        : canAccessPage("crm-customer-360"))));
}

export function useCrmOpen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const canOpen = useCrmCanOpen();
  return (o: CrmOpen | null | undefined) => {
    if (!canOpen(o)) return;
    if (o.to === "booking") nav.navigate("CrmBooking", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "customer") nav.navigate("CrmCustomer", { customerId: o.customerId, title: o.title });
    else if (o.to === "ticket") nav.navigate("CrmTicket", { ticketId: o.ticketId });
    else if (o.to === "application") nav.navigate("CrmApplicationForm", { applicationId: o.applicationId });
    else if (o.to === "construction-updates") nav.navigate("CrmConstructionUpdates", { projectId: o.projectId, projectName: o.projectName });
    else if (o.to === "oc-cc-board") nav.navigate("CrmOcCcBoard", undefined);
    else if (o.to === "cancellation") nav.navigate("CrmCancellation", { cancellationId: o.cancellationId, title: o.title });
    else openDocument(o.path, o.name).catch((e: Error) => Alert.alert("Could not open", e.message));
  };
}

// ── Filter & sort ────────────────────────────────────────────────────────────
type Period = "all" | "month" | "lastMonth" | "year";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "Any time" }, { value: "month", label: "This month" }, { value: "lastMonth", label: "Last month" }, { value: "year", label: "This year" },
];
type Sort = "default" | "newest" | "oldest" | "amountHigh" | "amountLow" | "name";
const SORTS: { value: Sort; label: string; needs?: "date" | "amount" }[] = [
  { value: "default", label: "As listed" },
  { value: "newest", label: "Newest first", needs: "date" },
  { value: "oldest", label: "Oldest first", needs: "date" },
  { value: "amountHigh", label: "Amount: high to low", needs: "amount" },
  { value: "amountLow", label: "Amount: low to high", needs: "amount" },
  { value: "name", label: "Name: A to Z" },
];

function inPeriod(d: string | null | undefined, p: Period) {
  if (p === "all") return true;
  if (!d) return false;
  const t = new Date(d);
  const now = new Date();
  if (p === "year") return t.getFullYear() === now.getFullYear();
  const ref = p === "month" ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return t.getFullYear() === ref.getFullYear() && t.getMonth() === ref.getMonth();
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
      borderColor: active ? `${CRM}80` : colors.border, backgroundColor: active ? `${CRM}22` : colors.card }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: active ? colors.foreground : colors.mutedForeground }}>{label}</Text>
    </Pressable>
  );
}

function FilterSheet({ open, onClose, reg, projects, project, setProject, period, setPeriod, sort, setSort, onReset }: {
  open: boolean; onClose: () => void; reg: CrmRegister; projects: string[];
  project: string; setProject: (v: string) => void; period: Period; setPeriod: (v: Period) => void; sort: Sort; setSort: (v: Sort) => void; onReset: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sorts = SORTS.filter((s) => !s.needs || (s.needs === "date" ? !!reg.dateOf : !!reg.amountOf));
  const group = (title: string, children: React.ReactNode) => (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 10 }}>{title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>
    </View>
  );
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, maxHeight: "80%", paddingBottom: insets.bottom + 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, paddingBottom: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Filter & sort</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={18} color={colors.mutedForeground} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18 }}>
          {projects.length > 1 ? group("Project", [ALL, ...projects].map((p) => <Chip key={p} label={p === ALL ? "All projects" : p} active={project === p} onPress={() => setProject(p)} />)) : null}
          {reg.dateOf ? group("Period", PERIODS.map((p) => <Chip key={p.value} label={p.label} active={period === p.value} onPress={() => setPeriod(p.value)} />)) : null}
          {group("Sort", sorts.map((s) => <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 6 }}>
          <Pressable onPress={onReset} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Reset</Text>
          </Pressable>
          <Pressable onPress={onClose} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: CRM }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#fff" }}>Show results</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function CrmRegisterScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmRegister">>();
  const reg = registerByKey(params.register)!;
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const open = useCrmOpen();
  const canOpen = useCrmCanOpen();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [period, setPeriod] = useState<Period>("all");
  const [sort, setSort] = useState<Sort>("default");
  const [sheet, setSheet] = useState(false);
  // A paired list (Welcome Calls: To call / History) switches in place; filters start afresh on the other list.
  const parent = reg.pair ? reg : pairParent(reg.key);
  useEffect(() => { setStatus(ALL); setProject(ALL); setPeriod("all"); setSort("default"); }, [reg.key]);
  const card = useCardStyle();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const serverTerm = reg.serverSearch ? debounced : "";
  const query = useQuery({
    queryKey: ["crm", reg.key, serverTerm],
    queryFn: async () => {
      const qs = reg.serverSearch ? `?page=1&pageSize=200${serverTerm ? `&search=${encodeURIComponent(serverTerm)}` : ""}` : "";
      return reg.rows(await crmGet(`${reg.path}${qs}`));
    },
  });

  const rows = query.data ?? [];
  const projectOf = (r: Row) => (reg.projectOf ? reg.projectOf(r) : r.ProjectName) || null;
  const statuses = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { const v = reg.status?.(r); if (v) s.add(v); });
    return s.size > 1 ? [ALL, ...s] : [];
  }, [rows, reg]);
  const projects = useMemo(() => [...new Set(rows.map(projectOf).filter((p): p is string => !!p))].sort(), [rows, reg]);

  const items = useMemo(() => {
    const term = reg.serverSearch ? "" : debounced.toLowerCase();
    const out = rows.filter((r) =>
      (status === ALL || reg.status?.(r) === status) &&
      (project === ALL || projectOf(r) === project) &&
      (!reg.dateOf || inPeriod(reg.dateOf(r), period)) &&
      (!term || (reg.searchIn?.(r) ?? []).some((v) => v != null && String(v).toLowerCase().includes(term))));
    const time = (r: Row) => { const d = reg.dateOf?.(r); return d ? new Date(d).getTime() : 0; };
    const amt = (r: Row) => Number(reg.amountOf?.(r)) || 0;
    if (sort === "newest") out.sort((a, b) => time(b) - time(a));
    else if (sort === "oldest") out.sort((a, b) => time(a) - time(b));
    else if (sort === "amountHigh") out.sort((a, b) => amt(b) - amt(a));
    else if (sort === "amountLow") out.sort((a, b) => amt(a) - amt(b));
    else if (sort === "name") out.sort((a, b) => String(reg.title(a) ?? "").localeCompare(String(reg.title(b) ?? "")));
    return out;
  }, [rows, status, project, period, sort, debounced, reg]);

  const activeFilters = (project !== ALL ? 1 : 0) + (period !== "all" ? 1 : 0) + (sort !== "default" ? 1 : 0);
  const create = reg.createAction && reg.createAction.pages.some((p) => canDoAction(p, "create")) ? reg.createAction : null;
  const action = reg.cardAction && reg.cardAction.pages.some((p) => canDoAction(p, reg.cardAction!.right)) ? reg.cardAction : null;

  return (
    <>
      <DataList<Row>
        query={query}
        items={items}
        keyOf={reg.id}
        filters={statuses}
        activeFilter={status}
        onFilter={setStatus}
        emptyText={debounced || status !== ALL || activeFilters ? "Nothing matches." : reg.empty}
        header={
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {parent?.pair ? (
              <View style={{ flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: 10 }}>
                {[parent.key, parent.pair.key].map((k, i) => {
                  const on = reg.key === k;
                  return (
                    <Pressable key={k} onPress={() => !on && nav.setParams({ register: k } as never)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                      style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, backgroundColor: on ? CRM : "transparent" }}>
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: on ? "#fff" : colors.mutedForeground }}>{parent.pair!.labels[i]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
                <Search size={13} color={colors.mutedForeground} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name, mobile, booking, unit…"
                  placeholderTextColor={`${colors.mutedForeground}99`}
                  style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 14, paddingVertical: 12 }}
                />
              </View>
              <Pressable onPress={() => setSheet(true)} accessibilityLabel="Filter and sort"
                style={{ width: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1, borderColor: activeFilters ? `${CRM}80` : colors.border, backgroundColor: activeFilters ? `${CRM}22` : colors.card }}>
                <SlidersHorizontal size={16} color={activeFilters ? CRM : colors.mutedForeground} />
                {activeFilters ? (
                  <View style={{ position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: CRM, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold }}>{activeFilters}</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
            {create ? (
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <ActionKey label={create.label} icon={Plus} onPress={() => nav.navigate(create.screen as never)} />
              </View>
            ) : null}
            {query.data ? (
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 10, paddingHorizontal: 4 }}>
                {items.length === rows.length ? `${rows.length} shown` : `${items.length} of ${rows.length} shown`}
                {project !== ALL ? ` · ${project}` : ""}
                {period !== "all" ? ` · ${PERIODS.find((p) => p.value === period)?.label}` : ""}
              </Text>
            ) : null}
          </View>
        }
        renderCard={(r) => {
          const t = reg.open?.(r);
          const target = canOpen(t) ? t : null;
          const st = reg.status?.(r);
          const amount = reg.amount?.(r);
          const mobile = reg.mobile ? reg.mobile(r) : r.Mobile;
          const lines = (reg.lines?.(r) ?? []).filter((l): l is string => typeof l === "string" && l.trim() !== "");
          const footer = !!(amount || mobile || (action && (!action.when || action.when(r))));
          const avatarText = reg.avatar?.(r);
          const initText = avatarText ? (avatarText).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase() || "?" : null;
          return (
            <Pressable
              disabled={!target}
              onPress={() => open(target)}
              style={({ pressed }) => ({
                ...card, padding: 16, marginBottom: 12, opacity: pressed ? 0.8 : 1,
              })}
            >
              {/* Who and where it stands, then the details, then the money and the keys. */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                {initText ? <AccentAvatar text={initText} size={40} /> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{reg.title(r) || "—"}</Text>
                  {reg.sub(r) ? <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 3, fontVariant: ["tabular-nums"] }}>{reg.sub(r)}</Text> : null}
                </View>
                {st ? <Pill label={st} /> : null}
                {target && !footer ? <ChevronRight size={18} color={colors.mutedForeground} style={{ marginTop: 2 }} /> : null}
              </View>
              {lines.length ? (
                <View style={{ marginTop: 10, gap: 4 }}>
                  {lines.map((l, i) => (
                    <Text key={i} numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: i === 0 ? colors.foreground : colors.mutedForeground }}>{l}</Text>
                  ))}
                </View>
              ) : null}
              {footer ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {amount ? (
                      <>
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{amount.label}</Text>
                        <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{amount.value}</Text>
                      </>
                    ) : null}
                  </View>
                  {mobile ? <ContactKeys mobile={mobile} compact /> : null}
                  {action && (!action.when || action.when(r)) ? (
                    <Pressable onPress={() => { const to = action.to(r); (nav.navigate as (s: string, p: object) => void)(to.screen, to.params); }}
                      style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: CRM, opacity: pressed ? 0.75 : 1 })}>
                      <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#fff" }}>{action.label}</Text>
                    </Pressable>
                  ) : target ? <ChevronRight size={18} color={colors.mutedForeground} /> : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} reg={reg} projects={projects}
        project={project} setProject={setProject} period={period} setPeriod={setPeriod} sort={sort} setSort={setSort}
        onReset={() => { setProject(ALL); setPeriod("all"); setSort("default"); }} />
    </>
  );
}

