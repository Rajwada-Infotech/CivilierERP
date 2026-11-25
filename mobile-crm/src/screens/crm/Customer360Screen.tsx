// One customer, everything (the web's Customer 360, crmCustomer360.js GET /:id): their money in total, each booking
// (tap through to it), applications, calls, service tickets and cancellations.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "@/auth/AuthContext";
import { getCustomer360 } from "@/api/crmApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { View, Text } from "react-native";
import {
  AccentAvatar,
  ActionKey,
  ContactKeys,
  Empty,
  ErrorText,
  HeroSurface,
  Kv,
  Loading,
  ON_HERO,
  Page,
  Pill,
  Tap,
  fmtDate,
  joinDot,
  money,
  useCardStyle,
} from "./ui";
import { useCrmOpen } from "./CrmRegisterScreen";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Pencil,
  Phone,
  User,
  Wrench,
  XCircle,
} from "lucide-react-native";

// ── Helpers ──────────────────────────────────────────────────────────────────

const initials = (name?: string | null) =>
  (name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

// ── ItemCard ──────────────────────────────────────────────────────────────────
/** A bordered, rounded card for one list item inside a CollapseSection. */
function ItemCard({ title, sub, right, onPress }: { title: string; sub?: string | null; right?: React.ReactNode; onPress?: () => void }) {
  const brand = useBrand();
  const inner = (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: brand.border, backgroundColor: brand.surfaceCard, padding: 12, marginTop: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 13, color: brand.textPrimary }} numberOfLines={2}>{title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {right}
          {onPress ? <ChevronRight size={15} color={brand.textFaint} /> : null}
        </View>
      </View>
      {sub ? <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: brand.textSecondary, marginTop: 3 }} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
  return onPress ? <Tap onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>{inner}</Tap> : inner;
}

// ── HeroTile ──────────────────────────────────────────────────────────────────
function HeroTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: highlight ? "rgba(248,113,113,0.20)" : ON_HERO.glass }}>
      <Text style={{ fontSize: 11, color: ON_HERO.secondary, fontFamily: fonts.body.medium, marginBottom: 4 }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 15, color: ON_HERO.primary, fontFamily: fonts.heading.semibold, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

// ── CollapseSection ───────────────────────────────────────────────────────────
/** A collapsible section card. Header is always visible; children appear when expanded. */
function CollapseSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const brand = useBrand();
  const card = useCardStyle();

  return (
    <View style={[card, { marginBottom: 12, overflow: "hidden" }]}>
      {/* Header row — always visible, tappable */}
      <Tap
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 14,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {Icon ? (
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              backgroundColor: brand.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={16} color={brand.accent} />
          </View>
        ) : null}

        <Text
          style={{
            flex: 1,
            fontFamily: fonts.heading.semibold,
            fontSize: 16,
            letterSpacing: -0.2,
            color: brand.textPrimary,
          }}
        >
          {title}
        </Text>

        {count !== undefined ? (
          <View
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              paddingHorizontal: 7,
              backgroundColor: brand.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontSize: 11.5,
                fontFamily: fonts.heading.semibold,
                color: brand.accent,
              }}
            >
              {count}
            </Text>
          </View>
        ) : null}

        {open ? (
          <ChevronDown size={18} color={brand.textFaint} />
        ) : (
          <ChevronRight size={18} color={brand.textFaint} />
        )}
      </Tap>

      {/* Expandable body */}
      {open ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 0,
            paddingBottom: 12,
            borderTopWidth: 1,
            borderTopColor: brand.border,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function Customer360Screen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmCustomer">>();
  const card = useCardStyle();
  const brand = useBrand();
  const { canAccessPage, canDoAction } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const open = useCrmOpen();
  const allowed = canAccessPage("crm-customer-360");
  const q = useQuery({
    queryKey: ["crm-customer-360", params.customerId],
    queryFn: () => getCustomer360(params.customerId),
    enabled: allowed,
  });
  const opensBooking = canAccessPage("crm-bookings") || canAccessPage("crm-payments");

  const refresh = async () => {
    await q.refetch();
  };

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: brand.surface, padding: 16 }}>
        <Empty text="You don't have access to Customer 360." />
      </View>
    );
  }

  const d = q.data;
  const c = d?.customer;
  const s = d?.summary ?? {};
  const bookings = d?.bookings ?? [];
  const applications = d?.applications ?? [];
  const tickets = d?.serviceTickets ?? [];
  const calls = d?.calls ?? [];
  const cancellations = d?.cancellations ?? [];

  // Build location string — only combine if all three exist
  const locationStr =
    c?.City && c?.State && c?.Pincode
      ? `${c.City}, ${c.State} – ${c.Pincode}`
      : null;

  // Quick-action chips — only Edit here; Call/WhatsApp are in the hero's ContactKeys
  const chips = canDoAction("crm-customers", "edit")
    ? [{ key: "edit", label: "Edit customer", go: () => nav.navigate("CrmCustomerForm", { customerId: params.customerId }) }]
    : [];

  return (
    <Page tab onRefresh={refresh}>
      {q.isLoading ? (
        <Loading />
      ) : q.error && !d ? (
        <View style={{ gap: 12, paddingTop: 8 }}>
          <ErrorText error={q.error} />
          <ActionKey
            label={q.isFetching ? "Retrying…" : "Retry"}
            onPress={() => { void q.refetch(); }}
            outline
          />
        </View>
      ) : !c ? (
        <View style={[card, { padding: 18, marginTop: 4 }]}>
          <Empty text="This customer record is unavailable." />
        </View>
      ) : (
        <>
          {q.error ? (
            <View style={{ gap: 10, marginBottom: 12 }}>
              <ErrorText error={q.error} />
              <ActionKey
                label={q.isFetching ? "Refreshing…" : "Retry"}
                onPress={() => { void q.refetch(); }}
                outline
              />
            </View>
          ) : null}

          {/* ── 1. Hero card ───────────────────────────────────────────── */}
          <HeroSurface padding={18}>
            {/* Avatar + name row + edit icon */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <AccentAvatar text={initials(c.CustomerName)} size={54} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  accessibilityRole="header"
                  style={{ color: ON_HERO.primary, fontSize: 20, lineHeight: 25, fontFamily: fonts.heading.bold }}
                  numberOfLines={2}
                >
                  {c.CustomerName || "Customer"}
                </Text>
                {c.CustomerNo ? (
                  <Text style={{ color: ON_HERO.secondary, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 3 }}>
                    {c.CustomerNo}
                  </Text>
                ) : null}
              </View>
              {chips.length > 0 ? (
                <Tap onPress={chips[0].go} accessibilityLabel="Edit customer"
                  style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: ON_HERO.glass, opacity: pressed ? 0.65 : 1 })}>
                  <Pencil size={16} color={ON_HERO.primary} />
                </Tap>
              ) : null}
            </View>

            {/* Divider */}
            <View
              style={{
                height: 1,
                backgroundColor: ON_HERO.glass,
                marginVertical: 14,
              }}
            />

            {/* Money grid — 2×2 tiles inside the hero */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <HeroTile label="Invoiced" value={money(s.totalInvoiced)} />
                <HeroTile label="Paid" value={money(s.totalPaid)} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <HeroTile
                  label="Outstanding"
                  value={money(s.totalOutstanding)}
                  highlight={Number(s.totalOutstanding) > 0}
                />
                <HeroTile label="On account" value={money(s.totalOnAccountBalance)} />
              </View>
              {Number(s.totalCredited) > 0 ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <HeroTile label="Credit notes" value={money(s.totalCredited)} />
                </View>
              ) : null}
            </View>

            {/* Contact row — only if mobile exists */}
            {c.Mobile ? (
              <>
                <View
                  style={{
                    height: 1,
                    backgroundColor: ON_HERO.glass,
                    marginVertical: 14,
                  }}
                />
                <ContactKeys mobile={c.Mobile} />
              </>
            ) : null}
          </HeroSurface>

          {/* ── 3. Customer details (collapsed by default) ────────────── */}
          {(c.Address || c.City || c.State || c.Pincode || c.PanNo || c.Email) ? (
            <CollapseSection title="Customer details" icon={User}>
              {c.Email ? <Kv label="Email" value={c.Email} /> : null}
              {c.Address ? <Kv label="Address" value={c.Address} /> : null}
              {locationStr ? (
                <Kv label="Location" value={locationStr} />
              ) : (
                <>
                  {c.City ? <Kv label="City" value={c.City} /> : null}
                  {c.State ? <Kv label="State" value={c.State} /> : null}
                  {c.Pincode ? <Kv label="PIN code" value={c.Pincode} /> : null}
                </>
              )}
              {c.PanNo ? <Kv label="PAN" value={c.PanNo} /> : null}
            </CollapseSection>
          ) : null}

          {/* ── 4. Bookings (expanded by default) ─────────────────────── */}
          <CollapseSection
            title="Bookings"
            icon={Building2}
            count={bookings.length}
            defaultOpen={true}
          >
            {bookings.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: "center" }}>
                <Empty text="No bookings for this customer." />
              </View>
            ) : (
              bookings.map((b) => {
                const tags = [
                  b.AgreementStatus && `Agreement: ${b.AgreementStatus}`,
                  b.PrePossessionStatus && `Checklist: ${b.PrePossessionStatus}`,
                  b.HandoverStatus && `Handover: ${b.HandoverStatus}`,
                  Number(b.NocTotalCount) > 0 &&
                    `NOC ${Number(b.NocTotalCount) - Number(b.NocPendingCount || 0)}/${b.NocTotalCount}`,
                  b.HasCancellation && "Cancellation raised",
                ].filter(Boolean) as string[];
                const outstanding = Number(b.TotalOutstanding);
                const onPress = opensBooking ? () => open({ to: "booking", bookingId: Number(b.Id), title: b.BookingNo }) : undefined;

                return (
                  <Tap key={b.Id} onPress={onPress}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.75 : 1,
                      marginTop: 10,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: brand.border,
                      backgroundColor: brand.surfaceCard,
                      padding: 12,
                    })}>
                    {/* Row 1: booking no + status + chevron */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13.5, color: brand.textPrimary, flex: 1 }} numberOfLines={1}>{b.BookingNo || "Booking"}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {b.Status ? <Pill label={b.Status} /> : null}
                        {onPress ? <ChevronRight size={15} color={brand.textFaint} /> : null}
                      </View>
                    </View>
                    {/* Row 2: project · unit */}
                    {(b.ProjectName || b.UnitNo) ? (
                      <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: brand.textSecondary, marginBottom: 8 }} numberOfLines={1}>
                        {joinDot(b.ProjectName, b.UnitNo)}
                      </Text>
                    ) : null}
                    {/* Row 3: Paid / Total / Outstanding */}
                    <View style={{ flexDirection: "row", gap: 16 }}>
                      <View>
                        <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: brand.textFaint, marginBottom: 1 }}>Paid</Text>
                        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: brand.textPrimary, fontVariant: ["tabular-nums"] }}>{money(b.TotalPaid)}</Text>
                      </View>
                      <View>
                        <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: brand.textFaint, marginBottom: 1 }}>Total</Text>
                        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: brand.textPrimary, fontVariant: ["tabular-nums"] }}>{money(b.GrandTotal ?? b.TotalValue)}</Text>
                      </View>
                      {outstanding > 0 ? (
                        <View>
                          <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: brand.textFaint, marginBottom: 1 }}>Outstanding</Text>
                          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: brand.warning, fontVariant: ["tabular-nums"] }}>{money(outstanding)}</Text>
                        </View>
                      ) : null}
                    </View>
                    {/* Row 4: after-sales tags */}
                    {tags.length > 0 ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                        {tags.map((tag) => <Pill key={tag} label={tag} />)}
                      </View>
                    ) : null}
                  </Tap>
                );
              })
            )}
          </CollapseSection>

          {/* ── 5. Service tickets ────────────────────────────────────── */}
          <CollapseSection
            title="Service tickets"
            icon={Wrench}
            count={tickets.length || undefined}
            defaultOpen={tickets.length > 0}
          >
            {tickets.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: "center" }}>
                <Empty text="No service tickets." />
              </View>
            ) : (
              tickets.map((t) => (
                <ItemCard
                  key={t.Id}
                  title={t.Subject || t.TicketNo || "Service ticket"}
                  sub={joinDot(t.TicketNo, t.Category, fmtDate(t.CreatedAt))}
                  right={t.Status ? <Pill label={t.Status} /> : null}
                  onPress={canAccessPage("crm-service-tickets") ? () => open({ to: "ticket", ticketId: Number(t.Id) }) : undefined}
                />
              ))
            )}
          </CollapseSection>

          {/* ── 6. Applications (collapsed by default) ────────────────── */}
          <CollapseSection
            title="Applications"
            icon={ClipboardList}
            count={applications.length || undefined}
            defaultOpen={applications.length > 0}
          >
            {applications.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: "center" }}>
                <Empty text="No applications for this customer." />
              </View>
            ) : (
              applications.map((a) => (
                <ItemCard
                  key={a.Id}
                  title={joinDot(a.ApplicationNo, a.InterestedProject) || "Application"}
                  sub={joinDot(a.PropertyType, a.BhkPreference, fmtDate(a.CreatedAt), a.AssigneeName)}
                  right={a.Status ? <Pill label={a.Status} /> : null}
                />
              ))
            )}
          </CollapseSection>

          {/* ── 7. Calls (collapsed by default) ───────────────────────── */}
          <CollapseSection
            title="Calls"
            icon={Phone}
            count={calls.length || undefined}
            defaultOpen={false}
          >
            {calls.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: "center" }}>
                <Empty text="No call history." />
              </View>
            ) : (
              calls.map((k, i) => (
                <ItemCard
                  key={k.Id ?? i}
                  title={joinDot(k.Outcome || k.CallType, fmtDate(k.CallDate || k.CreatedAt)) || "Call"}
                  sub={k.Notes || undefined}
                />
              ))
            )}
          </CollapseSection>

          {/* ── 8. Cancellations (collapsed by default) ───────────────── */}
          <CollapseSection
            title="Cancellations"
            icon={XCircle}
            count={cancellations.length || undefined}
            defaultOpen={false}
          >
            {cancellations.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: "center" }}>
                <Empty text="No cancellations." />
              </View>
            ) : (
              cancellations.map((x, i) => (
                <ItemCard
                  key={x.Id ?? i}
                  title={joinDot(x.CancellationNo, x.BookingNo) || "Cancellation"}
                  sub={joinDot(fmtDate(x.CreatedAt), x.RefundAmount != null && `Refund ${money(x.RefundAmount)}`)}
                  right={x.Status ? <Pill label={x.Status} /> : null}
                  onPress={canAccessPage("crm-cancellations") && x.Id ? () => open({ to: "cancellation", cancellationId: Number(x.Id), title: x.CancellationNo || x.BookingNo || "Cancellation" }) : undefined}
                />
              ))
            )}
          </CollapseSection>

        </>
      )}
    </Page>
  );
}
