// RN port of src/pages/supplier/SupplierDashboard.tsx (web), dark-theme
// branch only — that's the one that actually shows once logged into the
// app shell (TopHeader etc. are dark), same as every other CivilierERP
// surface; the light/emerald look is SupplierLogin's own standalone thing,
// not the dashboard's default. No dot-grid texture on the hero (CSS
// radial-gradient-as-repeating-background has no cheap RN equivalent).
//
// Diverges from the web dashboard in one deliberate way, per request: the
// company-profile card is dropped (that's what Profile is for), replaced
// with two sections the web dashboard doesn't show at all — Orders (from
// GET /orders) and Received by Customer (GET /grns, i.e. GRN receipt
// progress against what was supplied) — genuinely useful "what's my stuff
// doing right now" info that was otherwise buried behind unbuilt screens.
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import {
  FileSpreadsheet,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Inbox,
  CalendarDays,
  Package,
  PackageCheck,
  Building2,
  ListChecks,
  ArrowRight,
  Sparkles,
  Truck,
  MessageCircle,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";
import { navigate } from "@/navigation/navigationRef";

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const isOverdue = (due?: string | null) => !!due && new Date(due) < new Date();
const isDueSoon = (due?: string | null) =>
  !!due && !isOverdue(due) && new Date(due) <= new Date(Date.now() + 3 * 86400_000);

export default function DashboardScreen() {
  const { currentUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Section y-offsets within the ScrollView's content, captured via onLayout
  // as each QSection mounts — lets the stat-row tiles jump straight to the
  // matching section instead of just being decorative counts.
  const sectionY = useRef<{ pending?: number; submitted?: number }>({});
  const scrollToSection = (key: "pending" | "submitted") => {
    const y = sectionY.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
  };

  const quotationsQ = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
  });
  const catalogQ = useQuery({
    queryKey: ["supplier-catalog"],
    queryFn: spApi.getSupplierCatalog,
    staleTime: 5 * 60_000,
  });
  const ordersQ = useQuery({
    queryKey: ["supplier-orders"],
    queryFn: spApi.getSupplierOrders,
  });
  const grnQ = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
  });

  const quotations = quotationsQ.data ?? [];
  const catalog = catalogQ.data ?? [];
  const orders = ordersQ.data ?? [];
  const grnOrders = grnQ.data ?? [];
  const pendingReceipts = grnOrders.filter((o) => !o.isFullyReceived);

  const pending = quotations.filter((q) => q.MySubmissionStatus === "Pending");
  const submitted = quotations.filter((q) => q.MySubmissionStatus === "Submitted");
  const overdue = pending.filter((q) => isOverdue(q.DueDate));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (currentUser?.name ?? "Supplier").split(" ")[0];
  const initials = currentUser?.initials || firstName.slice(0, 2).toUpperCase();

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([quotationsQ.refetch(), catalogQ.refetch(), ordersQ.refetch(), grnQ.refetch()]);
    setRefreshing(false);
  };

  const subtitle =
    overdue.length > 0
      ? `${overdue.length} overdue RFQ${overdue.length > 1 ? "s" : ""} — please submit your rates.`
      : pending.length > 0
        ? `${pending.length} pending RFQ${pending.length > 1 ? "s" : ""} waiting for your rates.`
        : "You're all caught up — no pending quotations right now.";

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      style={{ backgroundColor: "#0c0c12" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6ee7b7" />}
    >
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <View style={{ borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
        <LinearGradient
          colors={["#064e3b", "#065f46", "#047857", "#059669"]}
          locations={[0, 0.4, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingHorizontal: 20, paddingVertical: 20 }}
        >
          {/* Glow blob */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: -50,
              top: -50,
              width: 180,
              height: 180,
              borderRadius: 90,
              backgroundColor: "rgba(16,185,129,0.28)",
            }}
          />

          <View className="flex-row items-center gap-4">
            {/* Avatar */}
            <View className="shrink-0" style={{ position: "relative" }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.18)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.25)",
                }}
              >
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: "#064e3b" }}>{initials}</Text>
              </View>
              <View
                style={{
                  position: "absolute",
                  bottom: -3,
                  right: -3,
                  width: 15,
                  height: 15,
                  borderRadius: 8,
                  borderWidth: 2,
                  borderColor: "#065f46",
                  backgroundColor: "#34d399",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#064e3b" }} />
              </View>
            </View>

            {/* Text */}
            <View className="flex-1 min-w-0">
              <View className="flex-row items-center gap-1.5 mb-0.5">
                <Sparkles size={11} color="rgba(167,243,208,0.8)" />
                <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: "rgba(167,243,208,0.8)" }}>
                  {greeting}
                </Text>
              </View>
              <Text style={{ fontSize: 21, fontFamily: fonts.heading.bold, color: "#fff" }}>{firstName}</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "rgba(209,250,229,0.65)", marginTop: 4 }}>
                {subtitle}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* Stat row — each tile jumps to the matching section below */}
      <View className="flex-row gap-3 mb-4">
        {[
          {
            label: "Total",
            value: quotations.length,
            color: "#e7e9ef",
            onPress: () => scrollToSection(pending.length > 0 ? "pending" : "submitted"),
            disabled: quotations.length === 0,
          },
          {
            label: "Pending",
            value: pending.length,
            color: pending.length > 0 ? "#fcd34d" : "#818898",
            onPress: () => scrollToSection("pending"),
            disabled: pending.length === 0,
          },
          {
            label: "Submitted",
            value: submitted.length,
            color: "#6ee7b7",
            onPress: () => scrollToSection("submitted"),
            disabled: submitted.length === 0,
          },
        ].map((s) => (
          <Pressable key={s.label} className="flex-1" disabled={s.disabled} onPress={s.onPress}>
            <View
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#272735",
                backgroundColor: "#15151e",
                paddingVertical: 12,
                paddingHorizontal: 10,
                opacity: s.disabled ? 0.6 : 1,
              }}
            >
              <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: s.color }}>{s.value}</Text>
              <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: "#818898", marginTop: 2 }}>{s.label}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* ── Quotations ───────────────────────────────────────────────── */}
      {quotationsQ.isLoading && (
        <View className="flex-row items-center justify-center gap-2" style={{ height: 96 }}>
          <ActivityIndicator color="#818898" />
          <Text style={{ color: "#818898", fontSize: 13, fontFamily: fonts.body.regular }}>Loading quotations…</Text>
        </View>
      )}

      {!quotationsQ.isLoading && quotations.length === 0 && (
        <View
          className="items-center justify-center gap-3"
          style={{ paddingVertical: 48, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#272735" }}
        >
          <Inbox size={26} color="rgba(129,136,152,0.4)" />
          <View className="items-center">
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>No quotations yet</Text>
            <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 2 }}>
              RFQs sent to you will appear here.
            </Text>
          </View>
        </View>
      )}

      {pending.length > 0 && (
        <View onLayout={(e) => { sectionY.current.pending = e.nativeEvent.layout.y; }}>
          <QSection title="Awaiting your response" count={pending.length} tint="amber" icon={FileSpreadsheet}>
            {pending.map((q) => (
              <QuotationCard key={q.QuotationId} q={q} />
            ))}
          </QSection>
        </View>
      )}

      {submitted.length > 0 && (
        <View onLayout={(e) => { sectionY.current.submitted = e.nativeEvent.layout.y; }}>
          <QSection title="Already submitted" count={submitted.length} tint="emerald" icon={CheckCircle2}>
            {submitted.map((q) => (
              <QuotationCard key={q.QuotationId} q={q} />
            ))}
          </QSection>
        </View>
      )}

      {/* ── Orders ───────────────────────────────────────────────────── */}
      {ordersQ.isLoading ? (
        <View className="flex-row items-center justify-center gap-2" style={{ height: 80 }}>
          <ActivityIndicator color="#818898" />
          <Text style={{ color: "#818898", fontSize: 13, fontFamily: fonts.body.regular }}>Loading orders…</Text>
        </View>
      ) : orders.length > 0 ? (
        <QSection title="Orders" count={orders.length} tint="blue" icon={Truck}>
          {orders.map((o) => (
            <OrderCard key={o.PurchaseOrderID} o={o} />
          ))}
        </QSection>
      ) : null}

      {/* ── Received by customer ────────────────────────────────────── */}
      {grnQ.isLoading ? (
        <View className="flex-row items-center justify-center gap-2" style={{ height: 80 }}>
          <ActivityIndicator color="#818898" />
          <Text style={{ color: "#818898", fontSize: 13, fontFamily: fonts.body.regular }}>Loading receipts…</Text>
        </View>
      ) : grnOrders.length > 0 ? (
        <QSection
          title="Received by customer"
          count={pendingReceipts.length}
          tint={pendingReceipts.length > 0 ? "amber" : "emerald"}
          icon={PackageCheck}
        >
          {grnOrders.map((o) => (
            <GrnCard key={o.purchaseOrderId} o={o} />
          ))}
        </QSection>
      ) : null}

      {/* ── Price catalog card ───────────────────────────────────────── */}
      <Pressable onPress={() => navigate("Catalog")}>
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "rgba(16,185,129,0.22)", backgroundColor: "rgba(16,185,129,0.06)", padding: 16, marginBottom: 14 }}>
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: "rgba(16,185,129,0.14)", alignItems: "center", justifyContent: "center" }}>
                <ListChecks size={14} color="#6ee7b7" />
              </View>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#6ee7b7", textTransform: "uppercase", letterSpacing: 1.2 }}>
                Price Catalog
              </Text>
            </View>
            <ArrowRight size={14} color="#6ee7b7" />
          </View>
          <Text style={{ fontSize: 22, fontFamily: fonts.heading.bold, color: "#e7e9ef" }}>{catalog.length}</Text>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 2 }}>
            {catalog.length === 0 ? "No items in your catalog yet" : `item${catalog.length !== 1 ? "s" : ""} in your catalog`}
          </Text>
        </View>
      </Pressable>

      {/* ── Quick guide ──────────────────────────────────────────────── */}
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#131720", padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#c7cbd4", textTransform: "uppercase", letterSpacing: 1.5 }}>
          Quick guide
        </Text>
        {[
          { step: "1", text: "Open a pending RFQ and enter your rates for each item." },
          { step: "2", text: "Add supply date and quality notes to stand out." },
          { step: "3", text: "Submit before the due date — the buyer sees your prices in the L1 chart." },
        ].map((tip) => (
          <View key={tip.step} className="flex-row items-start gap-3">
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(129,136,152,0.16)", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: "#c7cbd4" }}>{tip.step}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", lineHeight: 16 }}>{tip.text}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
const ORDER_STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  Approved: { color: "#6ee7b7", bg: "rgba(16,185,129,0.10)" },
  Pending: { color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  Rejected: { color: "#f87171", bg: "rgba(239,68,68,0.10)" },
  Closed: { color: "#818898", bg: "#21212c" },
};

function OrderCard({ o }: { o: spApi.SupplierOrderSummary }) {
  const statusStyle = ORDER_STATUS_COLOR[o.Status] ?? { color: "#818898", bg: "#21212c" };
  return (
    <Pressable onPress={() => navigate("OrderDetail", { id: o.PurchaseOrderID })}>
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e" }}>
        <View className="flex-row items-center gap-3" style={{ padding: 14 }}>
          <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(16,185,129,0.10)", alignItems: "center", justifyContent: "center" }}>
            <Truck size={15} color="#6ee7b7" />
          </View>
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>
                {o.DocNo ?? o.PurchaseOrderNo ?? `PO-${o.PurchaseOrderID}`}
              </Text>
              <View style={{ backgroundColor: statusStyle.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
                <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color: statusStyle.color }}>{o.Status}</Text>
              </View>
              {!o.SupplierAcknowledged && (
                <StatusPill icon={AlertCircle} label="Unacknowledged" color="#f59e0b" bg="rgba(245,158,11,0.10)" />
              )}
            </View>
            <View className="flex-row flex-wrap gap-x-3">
              {o.CompanyName && (
                <View className="flex-row items-center gap-1">
                  <Building2 size={10} color="#818898" />
                  <Text style={{ fontSize: 11, color: "#818898", fontFamily: fonts.body.regular }}>{o.CompanyName}</Text>
                </View>
              )}
              {o.ItemDescription && (
                <Text style={{ fontSize: 11, color: "#818898", fontFamily: fonts.body.regular }} numberOfLines={1}>
                  {o.ItemDescription}
                </Text>
              )}
            </View>
          </View>
          <View className="items-end shrink-0">
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>
              {o.TotalAmount != null ? `₹${Number(o.TotalAmount).toLocaleString("en-IN")}` : "—"}
            </Text>
            {o.ExpectedDeliveryDate && (
              <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: "#818898", marginTop: 2 }}>
                Due {fmtDate(o.ExpectedDeliveryDate)}
              </Text>
            )}
          </View>
          <View style={{ position: "relative" }}>
            <MessageCircle size={15} color="#818898" />
            {o.CommentCount > 0 && (
              <View
                style={{
                  position: "absolute", top: -5, right: -6, minWidth: 14, height: 14, paddingHorizontal: 3,
                  borderRadius: 7, backgroundColor: "#10b981", alignItems: "center", justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 8, fontFamily: fonts.heading.bold, color: "#fff" }}>{o.CommentCount}</Text>
              </View>
            )}
          </View>
          <ChevronRight size={14} color="#818898" />
        </View>
      </View>
    </Pressable>
  );
}

function GrnCard({ o }: { o: spApi.SupplierGrnOrder }) {
  const done = o.isFullyReceived;
  return (
    <Pressable onPress={() => navigate("ReceiptDetail", { purchaseOrderId: o.purchaseOrderId })}>
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: done ? "#272735" : "rgba(245,158,11,0.3)", backgroundColor: "#15151e" }}>
        <View className="flex-row items-center gap-3" style={{ padding: 14 }}>
          <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: done ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.10)", alignItems: "center", justifyContent: "center" }}>
            <PackageCheck size={15} color={done ? "#6ee7b7" : "#f59e0b"} />
          </View>
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>
                {o.docNo ?? o.purchaseOrderNo ?? `PO-${o.purchaseOrderId}`}
              </Text>
              {done ? (
                <StatusPill icon={CheckCircle2} label="Fully Received" color="#6ee7b7" bg="rgba(16,185,129,0.10)" />
              ) : (
                <StatusPill icon={Clock} label={`${o.totalRemaining} remaining`} color="#f59e0b" bg="rgba(245,158,11,0.10)" />
              )}
            </View>
            {o.companyName && (
              <View className="flex-row items-center gap-1">
                <Building2 size={10} color="#818898" />
                <Text style={{ fontSize: 11, color: "#818898", fontFamily: fonts.body.regular }}>{o.companyName}</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>
            {o.items.length} item{o.items.length !== 1 ? "s" : ""}
          </Text>
          <ChevronRight size={14} color="#818898" />
        </View>
      </View>
    </Pressable>
  );
}

const TINTS = {
  amber: { fg: "#fbbf24", wash: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.22)", chip: "rgba(245,158,11,0.14)" },
  emerald: { fg: "#6ee7b7", wash: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.22)", chip: "rgba(16,185,129,0.14)" },
  blue: { fg: "#7dd3fc", wash: "rgba(56,189,248,0.06)", border: "rgba(56,189,248,0.22)", chip: "rgba(56,189,248,0.14)" },
} as const;

// Each section gets its own tinted "block" (wash background + colored
// border + icon chip) instead of just floating cards on the plain page
// background — makes Quotations/Orders/Receipts read as clearly separate
// groups at a glance instead of one long undifferentiated scroll.
function QSection({ title, count, tint, icon: Icon, children }: {
  title: string; count: number; tint: keyof typeof TINTS; icon: React.ComponentType<{ size?: number; color?: string }>; children: React.ReactNode;
}) {
  const c = TINTS[tint];
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.wash, padding: 12, marginBottom: 14 }}>
      <View className="flex-row items-center gap-2 mb-3">
        <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: c.chip, alignItems: "center", justifyContent: "center" }}>
          <Icon size={12} color={c.fg} />
        </View>
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.bold, color: c.fg, textTransform: "uppercase", letterSpacing: 1.2 }}>
          {title}
        </Text>
        <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: c.chip }}>
          <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: c.fg }}>{count}</Text>
        </View>
      </View>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function QuotationCard({ q }: { q: spApi.SupplierQuotationSummary }) {
  const sub = q.MySubmissionStatus === "Submitted";
  const od = isOverdue(q.DueDate);
  const soon = isDueSoon(q.DueDate);
  const urgent = !sub && (od || soon);

  const borderColor = urgent ? "rgba(245,158,11,0.35)" : sub ? "rgba(16,185,129,0.28)" : "#272735";
  const iconBg = urgent ? "rgba(245,158,11,0.10)" : sub ? "rgba(16,185,129,0.10)" : "#21212c";
  const iconColor = urgent ? "#f59e0b" : sub ? "#6ee7b7" : "#818898";

  return (
    <Pressable onPress={() => navigate("QuotationDetail", { id: q.QuotationId })}>
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor, backgroundColor: "#15151e" }}>
        <View className="flex-row items-center gap-3" style={{ padding: 14 }}>
          <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: iconBg, alignItems: "center", justifyContent: "center" }}>
            <FileSpreadsheet size={15} color={iconColor} />
          </View>
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>{q.DocNo}</Text>
              {sub ? (
                <StatusPill icon={CheckCircle2} label="Submitted" color="#6ee7b7" bg="rgba(16,185,129,0.10)" />
              ) : od ? (
                <StatusPill icon={AlertCircle} label="Overdue" color="#f87171" bg="rgba(239,68,68,0.10)" />
              ) : (
                <StatusPill icon={Clock} label="Pending" color="#f59e0b" bg="rgba(245,158,11,0.10)" />
              )}
            </View>
            <View className="flex-row flex-wrap gap-x-3">
              {q.CompanyName && (
                <View className="flex-row items-center gap-1">
                  <Building2 size={10} color="#818898" />
                  <Text style={{ fontSize: 11, color: "#818898", fontFamily: fonts.body.regular }}>{q.CompanyName}</Text>
                </View>
              )}
              <View className="flex-row items-center gap-1">
                <Package size={10} color="#818898" />
                <Text style={{ fontSize: 11, color: "#818898", fontFamily: fonts.body.regular }}>
                  {q.ItemCount} item{q.ItemCount !== 1 ? "s" : ""}
                </Text>
              </View>
            </View>
          </View>
          <View className="items-end shrink-0">
            <View className="flex-row items-center gap-1">
              <CalendarDays size={10} color={od ? "#f87171" : "#818898"} />
              <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: od ? "#f87171" : "#818898" }}>
                {q.DueDate ? fmtDate(q.DueDate) : "No due date"}
              </Text>
            </View>
            {!sub && (
              <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: "#6ee7b7", marginTop: 2 }}>Submit rates →</Text>
            )}
          </View>
          <ChevronRight size={14} color="#818898" />
        </View>
        {urgent && <View style={{ height: 2, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: od ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.3)" }} />}
      </View>
    </Pressable>
  );
}

function StatusPill({ icon: Icon, label, color, bg }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; color: string; bg: string }) {
  return (
    <View className="flex-row items-center gap-1" style={{ backgroundColor: bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
      <Icon size={9} color={color} />
      <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color }}>{label}</Text>
    </View>
  );
}
