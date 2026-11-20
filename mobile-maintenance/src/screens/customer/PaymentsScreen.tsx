// Payments — a transparent money statement. The customer can follow every rupee:
//   1. the answer (paid / still to pay) and the sum behind it: plan total − paid = balance;
//   2. how the price is made up, line by line, adding up to the total price;
//   3. each instalment with the money matched to it;
//   4. every payment they made, and where it went (counted, waiting to be matched, being verified, refunded, moved);
//   5. their papers (invoices, credit notes).
// All figures come from the server's GET /money (the staff side's own sources); this screen only words them.
import { useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Check, ChevronDown, ChevronUp, FileDown, Receipt, Scale, Wallet } from "lucide-react-native";
import { toast } from "@/components/Toast";
import { portal, pdfPath, type MoneyStatement, moneyView, isPastDue } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { Button, Divider, ErrorText, HeroSurface, Loading, Muted, ON_HERO, Page, Panel, Pill, Ring, Row, fmtDate, money, Tap } from "@/customer/ui";
import { openDocument } from "@/utils/documents";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";

type Inst = MoneyStatement["plan"]["instalments"][number];

/** An instalment's state in the customer's words. */
function instState(m: Inst, isNext: boolean): { label: string; sub?: string; done: boolean } {
  if (m.waived) return { label: "Waived", sub: "You don't need to pay this", done: true };
  if (m.stage === "Adjusted") return { label: "Paid", done: true };
  if (m.stage === "Verified") return { label: "Covered", sub: "Covered by money you've already paid", done: true };
  if (m.stage === "InVerification" || m.stage === "Recorded") return { label: "Being verified", sub: "Your payment for this is being checked", done: false };
  if (isPastDue(m.dueDate)) return { label: "Overdue", sub: m.demanded ? "Demand sent" : undefined, done: false };
  if (m.demanded) return { label: "Due now", sub: "Demand sent to you", done: false };
  return { label: isNext ? "Due next" : "Later", done: false };
}

export default function CustomerPaymentsScreen() {
  const brand = useBrand();
  const { app, appId, money: statement } = useCustomer();
  // Credit notes come for the whole customer; show only this property's (by its booking).
  const notes    = useQuery({ queryKey: ["portal-credit-notes"], queryFn: portal.creditNotes,
    select: (rows) => rows.filter((n) => !!app?.BookingNo && n.BookingNo === app.BookingNo) });
  const invoices = useQuery({ queryKey: ["portal-invoices", appId], queryFn: () => portal.invoices(appId as number), enabled: appId != null });
  const [opening, setOpening] = useState<string | null>(null);
  const [showAllPlan, setShowAllPlan] = useState(false);
  const [openPay, setOpenPay] = useState<number | null>(null);

  const open = async (key: string, path: string, name: string) => {
    if (opening) return;
    setOpening(key);
    try { await openDocument(path, name); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not open it"); }
    finally { setOpening(null); }
  };

  const s = statement.data;
  const past = app?.Lifecycle === "Past";
  const refresh = () => Promise.all([statement.refetch(), invoices.refetch(), notes.refetch()]);

  if (statement.isLoading) return <Page><Loading /></Page>;
  if (statement.error) return <Page><ErrorText error={statement.error} /></Page>;
  if (!s?.booking)
    return <Page onRefresh={refresh}><Panel><Muted>Your payment details will appear here once your booking is confirmed.</Muted></Panel></Page>;

  const plot = s.booking.IsPlotSale;
  // A booking that ended owes nothing; the statement then answers "where did my money go?".
  const closed = s.booking.Closed;
  const { totals, plan, price } = s;
  const { pct, next, nextAmount } = moneyView(s);
  // A long plan shows the open part first; paid instalments fold away behind "Show all".
  const openPlan = plan.instalments.filter((m) => !instState(m, false).done);
  const planRows = showAllPlan || openPlan.length === 0 ? plan.instalments : openPlan;

  const num = (v: number, color = brand.textPrimary, size = 15) => (
    <Text style={{ fontSize: size, fontFamily: fonts.heading.semibold, color, fontVariant: ["tabular-nums"] }}>{money(v)}</Text>
  );
  const Sum = ({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) => (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14.5, fontFamily: fonts.body.medium, color: brand.textPrimary }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{sub}</Text> : null}
      </View>
      {num(value, color)}
    </View>
  );

  return (
    <Page onRefresh={refresh}>
      {/* 1 — the answer */}
      <HeroSurface>
        <View style={{ gap: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            {closed ? null : (
              <Ring pct={pct} size={104} stroke={10} track={ON_HERO.glass}>
                <Text style={{ fontSize: 23, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.5 }}>{pct}%</Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>paid</Text>
              </Ring>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>{closed ? "You paid in total" : "You have paid"}</Text>
              <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 26, letterSpacing: -0.6, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>{money(closed ? totals.received : totals.paid)}</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>{closed ? `on booking ${s.booking.BookingNo}` : `of ${money(plan.total)}`}</Text>
            </View>
          </View>
          {past || closed ? (
            <View style={{ borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass }}>
              <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{app?.StateLabel || "This booking has ended"}. Its payments and papers are kept here for you.</Text>
            </View>
          ) : totals.balance > 0 ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1, gap: 2, borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Still to pay</Text>
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, fontVariant: ["tabular-nums"] }}>{money(totals.balance)}</Text>
              </View>
              {next ? (
                <View style={{ flex: 1, gap: 2, borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass }}>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Next{next.dueDate ? ` · ${fmtDate(next.dueDate)}` : ""}</Text>
                  <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: brand.gold, fontVariant: ["tabular-nums"] }}>
                    {money(nextAmount)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, backgroundColor: ON_HERO.glass }}>
              <Check size={18} color={brand.gold} />
              <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>Fully paid. Thank you!</Text>
            </View>
          )}
        </View>
      </HeroSurface>

      {/* The sum behind the answer — nothing hidden */}
      {closed ? (
        <Panel title="What happened to your money" icon={Scale}>
          <Sum label="You paid in total" value={totals.received} />
          {totals.refunded > 0 ? <Sum label="Refunded to you" value={-totals.refunded} color={brand.success} /> : null}
          {totals.movedOut > 0 ? <Sum label="Moved on" sub="For example to your new unit, or with a transfer" value={-totals.movedOut} /> : null}
          {totals.verifying > 0 ? <Sum label="Still being verified" value={totals.verifying} color={brand.warning} /> : null}
          <Divider />
          <Sum label="Still held with us" value={totals.held}
            sub={totals.held > 0 ? "Please contact us about refunding or moving this" : "Nothing of yours is left on this booking"} />
        </Panel>
      ) : (
      <Panel title="How your balance is worked out" icon={Scale}>
        <Sum label="Your payment plan" value={plan.total} sub={plan.waived > 0 ? `After ${money(plan.waived)} waived` : undefined} />
        <Sum label="Paid so far" value={-totals.paid} color={brand.success}
          sub={totals.held > 0 ? `${money(totals.settled)} matched to instalments + ${money(totals.held)} waiting to be matched` : undefined} />
        <Divider />
        <Sum label={totals.extra > 0 ? "Paid more than the plan" : "Still to pay"} value={totals.extra > 0 ? totals.extra : totals.balance} color={totals.extra > 0 ? brand.gold : brand.textPrimary} />
        {totals.verifying > 0 ? (
          <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.body.regular, color: brand.warning }}>
            {money(totals.verifying)} more is being verified. It will count towards this once confirmed.
          </Text>
        ) : null}
        {totals.overPrice > 0 ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: brand.goldSoft, borderWidth: 1, borderColor: brand.borderGold, gap: 2 }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>You have paid {money(totals.overPrice)} more than your price</Text>
            <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
              Your total price is {money(price.total)}{price.lines.some((l) => l.key === "creditNotes") ? " after credit notes" : ""} and you have paid {money(totals.paid)}. Please contact us about refunding or adjusting the difference.
            </Text>
          </View>
        ) : null}
        {totals.refunded > 0 || totals.movedOut > 0 ? (
          <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
            {[totals.refunded > 0 ? `${money(totals.refunded)} was refunded to you` : null, totals.movedOut > 0 ? `${money(totals.movedOut)} was moved on (for example to a new unit)` : null].filter(Boolean).join(" and ")}. Neither is counted above.
          </Text>
        ) : null}
      </Panel>
      )}

      {/* 2 — how the price is made up */}
      <Panel title="Price and GST breakdown" icon={Receipt}>
        {price.lines.map((l, i) => {
          return (
            <View key={`${l.key}-${i}`} style={{ gap: 8 }}>
              <Sum label={l.title} sub={l.note || undefined} value={l.amount} color={l.amount < 0 ? brand.success : undefined} />
              {(l.parts || []).map((p) => <Row key={p.title} indent label={p.title} sub={p.note} value={money(p.amount)} />)}
            </View>
          );
        })}
        <Divider />
        <Sum label="Total price" value={price.total} />
        <Muted>{price.gstIncluded > 0 ? `This price includes ${money(price.gstIncluded)} of GST in all.` : "No GST is included in this price."}</Muted>
        {Math.abs(price.total - plan.total - plan.waived) > 0.5 ? (
          <Muted>
            Your payment plan adds up to {money(plan.total + plan.waived)}{plan.waived > 0 ? " before waivers" : ""}, which is {money(Math.abs(price.total - plan.total - plan.waived))} {price.total < plan.total + plan.waived ? "more" : "less"} than this price. Please ask us if you have a question about it.
          </Muted>
        ) : null}
      </Panel>

      {/* 3 — instalments */}
      {plan.instalments.length ? (
        <Panel title="Instalments" icon={CalendarClock}
          right={<Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: brand.textSecondary }}>{plan.instalments.length - openPlan.length} of {plan.instalments.length} done</Text>}>
          {planRows.map((m, i) => {
            const st = instState(m, m === next);
            const got = m.settled + m.held;
            return (
              <View key={`${m.no}-${i}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, marginTop: 2, alignItems: "center", justifyContent: "center",
                  backgroundColor: st.done ? brand.success : "transparent", borderWidth: 1.5, borderColor: st.done ? brand.success : st.label === "Overdue" ? brand.danger : brand.border }}>
                  {st.done ? <Check size={13} color="#fff" /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{m.name}</Text>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                    {[m.dueDate ? `Due ${fmtDate(m.dueDate)}` : null, st.sub, !st.done && got > 0 ? `${money(got)} paid so far` : null].filter(Boolean).join(" · ") || " "}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {num(m.due)}
                  <Pill label={st.label} />
                </View>
              </View>
            );
          })}
          {openPlan.length > 0 && openPlan.length < plan.instalments.length ? (
            <Tap onPress={() => setShowAllPlan((v) => !v)} style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: brand.gold }}>
                {showAllPlan ? "Show only what's open" : `Show all ${plan.instalments.length}, including paid`}
              </Text>
            </Tap>
          ) : null}
        </Panel>
      ) : null}

      {/* 4 — every payment, and where it went */}
      <Panel title="Every payment you've made" icon={Wallet}>
        {!s.payments.length ? <Muted>No payments yet. Each one will appear here with its receipt.</Muted> : (
          [...s.payments].reverse().map((p, i) => {
            const st = p.status;
            const parts = [
              p.settled > 0 && p.stage !== "settled" ? `${money(p.settled)} counted` : null,
              p.held > 0 && p.stage !== "held" ? `${money(p.held)} waiting to be matched` : null,
              p.refunded > 0 && p.stage !== "out" ? `${money(p.refunded)} refunded` : null,
              p.movedOut > 0 && !["out", "unitChange"].includes(p.stage) ? `${money(p.movedOut)} moved` : null,
            ].filter(Boolean).join(" · ");
            const key = `pay-${i}`;
            const canOpen = p.receiptId != null;
            const shown = openPay === i;
            return (
              <View key={key} style={{ gap: 10 }}>
                {i ? <Divider /> : null}
                <Tap onPress={() => setOpenPay(shown ? null : i)} accessibilityRole="button" accessibilityState={{ expanded: shown }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: i ? 2 : 0, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {num(p.amount, p.stage === "bounced" || p.stage === "returned" ? brand.textFaint : brand.textPrimary, 16)}
                      <Pill label={st.label} />
                    </View>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                      {[p.date ? fmtDate(p.date) : null, p.mode, p.milestone ? `for ${p.milestone}` : null].filter(Boolean).join(" · ")}
                    </Text>
                    {st.sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>{st.sub}</Text> : null}
                    {parts ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: brand.textPrimary }}>{parts}</Text> : null}
                  </View>
                  {shown ? <ChevronUp size={18} color={brand.textFaint} /> : <ChevronDown size={18} color={brand.textFaint} />}
                </Tap>
                {shown ? (
                  <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: brand.surface, borderWidth: 1, borderColor: brand.border }}>
                    {/* How they paid — the server's ready-made list (same as the web portal) — then where it stands */}
                    {p.details.map((d) => <Row key={d.label} label={d.label} value={d.value} />)}
                    <Row label="Status" value={st.label} />
                    {canOpen ? (
                      <Button label={opening === key ? "Opening…" : `Open receipt ${p.receiptNo}`} kind="line" icon={FileDown}
                        busy={opening === key} onPress={() => open(key, pdfPath.receipt(appId as number, p.receiptId as number), p.receiptNo || "Receipt")} />
                    ) : p.receiptNo ? <Muted>The receipt opens here once our accounts team approves it.</Muted> : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </Panel>

      {/* 5 — papers */}
      {invoices.data?.length || notes.data?.length ? (
        <Panel title="Invoices and credit notes" icon={FileDown}>
          {[...(invoices.data || [])].sort((a, b) => Number(a.Status === "Void") - Number(b.Status === "Void")).map((v) => {
            const cancelled = v.Status === "Void";
            const key = `i${v.Id}`;
            return (
              <Tap key={key} disabled={cancelled} onPress={() => open(key, pdfPath.invoice(appId as number, v.Id), v.InvoiceNo)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, opacity: cancelled ? 0.5 : pressed ? 0.6 : 1 })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{v.InvoiceNo}</Text>
                    {cancelled ? <Pill label="Cancelled" /> : null}
                  </View>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                    {opening === key ? "Opening…" : [fmtDate(v.InvoiceDate), v.Description].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {num(v.Amount)}
              </Tap>
            );
          })}
          {(notes.data || []).map((n) => {
            const key = `n${n.Id}`;
            return (
              <Tap key={key} onPress={() => open(key, pdfPath.creditNote(n.Id), n.DocNo)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{n.DocNo}</Text>
                    <Pill label="Credit note" />
                  </View>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: brand.textSecondary }}>
                    {opening === key ? "Opening…" : [fmtDate(n.DocDate), n.AgainstRef ? `Against ${n.AgainstRef}` : null].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {num(n.TotalAmount, brand.success)}
              </Tap>
            );
          })}
        </Panel>
      ) : null}
    </Page>
  );
}
