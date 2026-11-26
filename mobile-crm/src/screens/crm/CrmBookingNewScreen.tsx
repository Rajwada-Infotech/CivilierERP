// New Booking screen: creates a confirmed booking from an approved Application
// (Parity with web src/pages/CRM/bookings/NewBookingDialog.tsx).
// Auto-populates all terms from the Application (unit, rate, plan, booking amount, assignee, broker),
// lets staff pick a replacement unit if the preferred one is locked, and submits POST /api/crm/bookings.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Building2, Calendar, CheckCircle2, DollarSign, FileCheck2, Info, Users } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { FormScaffold, FormSection, NumberField, RemarksField, TextField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { toast } from "@/components/Toast";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useAuth } from "@/auth/AuthContext";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import { Empty, Pill, money } from "./ui";

type Nav = NativeStackNavigationProp<MainStackParamList>;
type Route = RouteProp<MainStackParamList, "CrmBookingNew">;

const PAY_MODES = ["Cheque", "NEFT", "RTGS", "UPI", "Cash", "Home Loan", "Other"];
const BROKERAGE_PLANS = [
  { key: "OneTime", label: "One-Time (100% on demand 1)" },
  { key: "TwoPart", label: "Two-Part (50% on demand 1, 50% on agreement)" },
  { key: "ThreePart", label: "Three-Part (milestone tranches)" },
];

export default function CrmBookingNewScreen() {
  const b = useBrand();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const route = useRoute<Route>();
  const initialAppId = route.params?.applicationId;
  const { canDoAction } = useAuth();
  const canCreate = canDoAction("crm-bookings", "create");

  // Master queries
  const appsQ = useQuery({
    queryKey: ["crm-apps-for-booking"],
    queryFn: () => crmGet<Row[]>("/api/crm/applications?forBooking=1"),
    staleTime: 60_000,
  });
  const unitsQ = useQuery({
    queryKey: ["unit-master-active"],
    queryFn: () => crmGet<Row[]>("/api/unit-master?isActive=1"),
    staleTime: 5 * 60_000,
  });
  const plotsQ = useQuery({
    queryKey: ["plot-master-available"],
    queryFn: () => crmGet<Row[]>("/api/plot-master?available=1"),
    staleTime: 5 * 60_000,
  });
  const plansQ = useQuery({
    queryKey: ["crm-payment-plans-active"],
    queryFn: () => crmGet<Row[]>("/api/crm/payment-plans?isActive=1"),
    staleTime: 5 * 60_000,
  });
  const usersQ = useQuery({
    queryKey: ["sa-leads-users"],
    queryFn: () => crmGet<{ Id: number; Name: string }[]>("/api/sa/leads/users"),
    staleTime: 5 * 60_000,
  });

  const apps = appsQ.data ?? [];
  const allUnits = unitsQ.data ?? [];
  const allPlots = plotsQ.data ?? [];
  const plans = plansQ.data ?? [];
  const salesUsers = usersQ.data ?? [];

  // Form state
  const [selectedAppId, setSelectedAppId] = useState<string>(initialAppId ? String(initialAppId) : "");
  const [isPlot, setIsPlot] = useState(false);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [plotIds, setPlotIds] = useState<string[]>([]);
  const [unitNo, setUnitNo] = useState("");
  const [projectName, setProjectName] = useState("");
  const [blockName, setBlockName] = useState("");
  const [unitType, setUnitType] = useState("");
  const [areaSqFt, setAreaSqFt] = useState("");
  const [ratePerSqFt, setRatePerSqFt] = useState("");
  const [totalValue, setTotalValue] = useState("");
  const [paymentPlanId, setPaymentPlanId] = useState("");
  const [bookingAmount, setBookingAmount] = useState("");
  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState("Cheque");
  const [assignedTo, setAssignedTo] = useState("");
  const [brokerId, setBrokerId] = useState("");
  const [brokerageRatePercent, setBrokerageRatePercent] = useState("");
  const [brokeragePaymentPlan, setBrokeragePaymentPlan] = useState("OneTime");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Pickers modal visibility
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [showPlotPicker, setShowPlotPicker] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showBrokeragePlanPicker, setShowBrokeragePlanPicker] = useState(false);

  const selectedApp = useMemo(() => apps.find((a) => String(a.Id) === selectedAppId), [apps, selectedAppId]);

  // Available inventory filters
  const availableUnits = useMemo(
    () => allUnits.filter((u) => u.IsActive && (!(u.LockBookingNo || u.LockHoldId) || unitIds.includes(String(u.Id)))),
    [allUnits, unitIds]
  );
  const availablePlots = useMemo(
    () => allPlots.filter((p) => !(p.LockBookingNo || p.LockApplicationNo || p.LockHoldId) || plotIds.includes(String(p.Id))),
    [allPlots, plotIds]
  );

  // Handle application selection and pre-fill
  const applyApplication = (app: Row) => {
    const pIds = String(app.PreferredPlotIdsCsv || "").split(",").filter(Boolean);
    const primaryUnitId = app.PreferredUnitId != null ? String(app.PreferredUnitId) : null;
    const uIdsCsv = String(app.PreferredUnitIdsCsv || "").split(",").filter(Boolean);
    const uIds = primaryUnitId ? [primaryUnitId, ...uIdsCsv.filter((x) => x !== primaryUnitId)] : uIdsCsv;

    const isPlotApp = pIds.length > 0;
    setIsPlot(isPlotApp);
    setSelectedAppId(String(app.Id));

    if (isPlotApp) {
      setPlotIds(pIds);
      setUnitIds([]);
      const matchedPlots = allPlots.filter((p) => pIds.includes(String(p.Id)));
      const pPrimary = matchedPlots[0] || null;
      setUnitNo(matchedPlots.map((p) => p.PlotName || p.PlotNo).join(", ") || "");
      setProjectName(pPrimary?.ProjectName || app.InterestedProject || "");
      setBlockName(pPrimary?.BlockName || "");
      setUnitType("Plot");
      const combinedArea = matchedPlots.reduce((sum, p) => sum + (parseFloat(p.AreaSqFt) || 0), 0);
      setAreaSqFt(combinedArea > 0 ? String(combinedArea) : String(app.AreaSqFt || ""));
    } else {
      setUnitIds(uIds);
      setPlotIds([]);
      const matchedUnits = allUnits.filter((u) => uIds.includes(String(u.Id)));
      const uPrimary = matchedUnits[0] || null;
      setUnitNo(matchedUnits.map((u) => u.UnitName).join(", ") || app.InterestedUnit || "");
      setProjectName(uPrimary?.ProjectName || app.InterestedProject || "");
      setBlockName(uPrimary?.BlockName || "");
      setUnitType(uPrimary?.UnitType || app.BhkPreference || "");
      const combinedArea = matchedUnits.reduce((sum, u) => sum + (parseFloat(u.AreaSqFt) || 0), 0);
      setAreaSqFt(combinedArea > 0 ? String(combinedArea) : String(app.AreaSqFt || ""));
    }

    const rate = app.RatePerSqFt != null ? String(app.RatePerSqFt) : "";
    setRatePerSqFt(rate);

    const aNum = parseFloat(String(app.AreaSqFt || "0"));
    const rNum = parseFloat(rate);
    if (!isNaN(aNum) && !isNaN(rNum) && aNum > 0 && rNum > 0) {
      setTotalValue(String(Math.round(aNum * rNum)));
    } else if (app.ExpectedDealValue) {
      setTotalValue(String(app.ExpectedDealValue));
    }

    if (app.PaymentPlanId) setPaymentPlanId(String(app.PaymentPlanId));
    if (app.BookingAmount) setBookingAmount(String(app.BookingAmount));
    if (app.PaymentMode) setPaymentMode(String(app.PaymentMode));
    if (app.AssignedTo) setAssignedTo(String(app.AssignedTo));
    if (app.BrokerId) setBrokerId(String(app.BrokerId));
    if (app.BrokerageRatePercent) setBrokerageRatePercent(String(app.BrokerageRatePercent));
    if (app.Notes) setNotes(String(app.Notes));
  };

  // Pre-fill on initial mount if initialAppId given
  useEffect(() => {
    if (selectedAppId && apps.length > 0) {
      const match = apps.find((a) => String(a.Id) === selectedAppId);
      if (match) applyApplication(match);
    }
  }, [selectedAppId, apps.length]);

  // Recalculate total value on area or rate change
  const handleRateChange = (rateStr: string) => {
    setRatePerSqFt(rateStr);
    const r = parseFloat(rateStr);
    const a = parseFloat(areaSqFt);
    if (!isNaN(r) && !isNaN(a) && a > 0) {
      setTotalValue(String(Math.round(a * r)));
    }
  };

  const handleAreaChange = (areaStr: string) => {
    setAreaSqFt(areaStr);
    const a = parseFloat(areaStr);
    const r = parseFloat(ratePerSqFt);
    if (!isNaN(r) && !isNaN(a) && r > 0) {
      setTotalValue(String(Math.round(a * r)));
    }
  };

  // Payment plan change fills fixed booking amount
  const handlePlanSelect = (planId: string) => {
    setPaymentPlanId(planId);
    const plan = plans.find((p) => String(p.Id) === planId);
    if (plan?.BookingAmount != null && Number(plan.BookingAmount) > 0) {
      setBookingAmount(String(plan.BookingAmount));
    }
  };

  // Unit picker selection
  const handleUnitSelect = (uId: string) => {
    const u = allUnits.find((item) => String(item.Id) === uId);
    if (!u) return;
    setUnitIds([uId]);
    setPlotIds([]);
    setUnitNo(u.UnitName);
    setProjectName(u.ProjectName || projectName);
    setBlockName(u.BlockName || blockName);
    setUnitType(u.UnitType || unitType);
    if (u.AreaSqFt) handleAreaChange(String(u.AreaSqFt));
    if (u.RatePerSqFt) handleRateChange(String(u.RatePerSqFt));
  };

  // Plot picker selection
  const handlePlotSelect = (pId: string) => {
    const p = allPlots.find((item) => String(item.Id) === pId);
    if (!p) return;
    setPlotIds([pId]);
    setUnitIds([]);
    setUnitNo(p.PlotName || p.PlotNo);
    setProjectName(p.ProjectName || projectName);
    setBlockName(p.BlockName || blockName);
    setUnitType("Plot");
    if (p.AreaSqFt) handleAreaChange(String(p.AreaSqFt));
    if (p.RatePerSqFt) handleRateChange(String(p.RatePerSqFt));
  };

  const handleSave = async () => {
    if (!selectedAppId) return toast.error("Select an approved application to convert.");
    if (unitIds.length === 0 && plotIds.length === 0) return toast.error("Assign at least one unit or plot.");
    if (!ratePerSqFt) return toast.error("Enter the agreed rate per sq ft.");

    setBusy(true);
    try {
      const payload = {
        ApplicationId: parseInt(selectedAppId, 10),
        UnitIds: unitIds.map((id) => parseInt(id, 10)),
        PlotIds: plotIds.map((id) => parseInt(id, 10)),
        UnitNo: unitNo || undefined,
        ProjectName: projectName || undefined,
        BlockName: blockName || undefined,
        UnitType: unitType || undefined,
        AreaSqFt: areaSqFt ? parseFloat(areaSqFt) : null,
        RatePerSqFt: ratePerSqFt ? parseFloat(ratePerSqFt) : null,
        TotalValue: totalValue ? parseFloat(totalValue) : null,
        PaymentPlanId: isPlot ? null : (paymentPlanId ? parseInt(paymentPlanId, 10) : null),
        BookingAmount: bookingAmount ? parseFloat(bookingAmount) : null,
        BookingDate: bookingDate || undefined,
        PaymentMode: paymentMode || "Cheque",
        AssignedTo: assignedTo ? parseInt(assignedTo, 10) : null,
        BrokerId: brokerId ? parseInt(brokerId, 10) : null,
        BrokerageRatePercent: brokerageRatePercent ? parseFloat(brokerageRatePercent) : null,
        BrokeragePaymentPlan: brokerId ? brokeragePaymentPlan : "OneTime",
        Notes: notes.trim() || undefined,
      };

      const res = await crmSend<Row>("/api/crm/bookings", "POST", payload);
      toast.success(res?.message || "Booking created and confirmed successfully!");

      // Invalidate queries
      void qc.invalidateQueries({ queryKey: ["crm", "bookings"] });
      void qc.invalidateQueries({ queryKey: ["crm-apps"] });
      void qc.invalidateQueries({ queryKey: ["crm-apps-for-booking"] });

      const newBookingId = res?.BookingId || res?.Id || res?.bookingId;
      const newBookingNo = res?.BookingNo || res?.bookingNo || "Booking";

      if (newBookingId) {
        nav.replace("CrmBooking", { bookingId: Number(newBookingId), title: String(newBookingNo) });
      } else {
        nav.goBack();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!canCreate) {
    return (
      <View style={{ flex: 1, backgroundColor: b.surface, padding: 16 }}>
        <Empty text="You do not have permission to create new bookings." />
      </View>
    );
  }

  const selectedPlan = plans.find((p) => String(p.Id) === paymentPlanId);
  const selectedUser = salesUsers.find((u) => String(u.Id) === assignedTo);

  return (
    <FormScaffold
      onSubmit={handleSave}
      submitLabel="Confirm Booking"
      onCancel={() => nav.goBack()}
      submitting={busy}
      tone={b.accent}
    >
      {/* ── 1. Approved Application Picker ── */}
      <FormSection title="1. Approved Application">
        <PickerRow
          label="Select Application"
          required
          value={selectedApp ? `${selectedApp.ApplicantName} (${selectedApp.ApplicationNo || `#${selectedApp.Id}`})` : ""}
          placeholder="Choose an approved application…"
          onPress={() => setShowAppPicker(true)}
        />
        {selectedApp ? (
          <View style={{ backgroundColor: b.surfaceCard, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: b.border, gap: 6, marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{selectedApp.ApplicantName}</Text>
              <Pill label="Approved" tone={b.success} />
            </View>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
              {[selectedApp.Mobile, selectedApp.InterestedProject, selectedApp.InterestedUnit || selectedApp.PlotNames].filter(Boolean).join(" · ")}
            </Text>
            {selectedApp.BookingAmount ? (
              <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.accent }}>
                Token Received: {money(selectedApp.BookingAmount)}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: b.surfaceGlass, marginBottom: 14 }}>
            <Info size={15} color={b.textFaint} />
            <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
              Pick an application approved by management. Its unit, pricing terms, and applicant details will be locked in.
            </Text>
          </View>
        )}
      </FormSection>

      {/* ── 2. Inventory & Area Allocation ── */}
      <FormSection title="2. Inventory & Area">
        {isPlot ? (
          <PickerRow
            label="Plot Selection"
            required
            value={plotIds.length > 0 ? unitNo : ""}
            placeholder="Select available plot…"
            onPress={() => setShowPlotPicker(true)}
          />
        ) : (
          <PickerRow
            label="Unit Selection"
            required
            value={unitIds.length > 0 ? unitNo : ""}
            placeholder="Select available unit…"
            onPress={() => setShowUnitPicker(true)}
          />
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <TextField label="Project" value={projectName} onChangeText={setProjectName} placeholder="Project name" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Block / Tower" value={blockName} onChangeText={setBlockName} placeholder="Block" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <TextField label="Unit Type / BHK" value={unitType} onChangeText={setUnitType} placeholder="e.g. 3BHK" />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField label="Area (sq ft) *" value={areaSqFt} onChangeText={handleAreaChange} placeholder="e.g. 1450" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <NumberField label="Rate / sq ft (₹) *" value={ratePerSqFt} onChangeText={handleRateChange} placeholder="e.g. 4500" />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField label="Total Deal Value (₹)" value={totalValue} onChangeText={setTotalValue} placeholder="Area × Rate" />
          </View>
        </View>
        {totalValue ? (
          <View style={{ padding: 12, borderRadius: 14, backgroundColor: b.accentSoft, alignItems: "center", marginBottom: 14 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>Agreed Basic Consideration Value</Text>
            <Text style={{ fontSize: 19, fontFamily: fonts.heading.bold, color: b.accent, marginTop: 2 }}>{money(totalValue)}</Text>
          </View>
        ) : null}
      </FormSection>

      {/* ── 3. Payment Terms & Milestone Plan ── */}
      <FormSection title="3. Payment Plan & Token">
        {!isPlot ? (
          <PickerRow
            label="Payment Plan"
            required
            value={selectedPlan ? selectedPlan.PlanName : ""}
            placeholder="Choose milestone payment plan…"
            onPress={() => setShowPlanPicker(true)}
          />
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <NumberField label="Booking Token (₹) *" value={bookingAmount} onChangeText={setBookingAmount} placeholder="Token amount" />
          </View>
          <View style={{ flex: 1 }}>
            <PickerRow
              label="Payment Mode"
              value={paymentMode}
              placeholder="Select mode…"
              onPress={() => setShowModePicker(true)}
            />
          </View>
        </View>
        <DateField label="Booking Date" value={bookingDate} onChange={setBookingDate} />
      </FormSection>

      {/* ── 4. Sales Assignment & Brokerage ── */}
      <FormSection title="4. Team & Broker Assignment">
        <PickerRow
          label="Assigned Sales Executive"
          value={selectedUser ? selectedUser.Name : ""}
          placeholder="Assign CRM / Sales executive…"
          onPress={() => setShowUserPicker(true)}
        />
        {brokerId ? (
          <>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <TextField label="Broker ID" value={brokerId} onChangeText={setBrokerId} placeholder="Broker ID" />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField label="Brokerage %" value={brokerageRatePercent} onChangeText={setBrokerageRatePercent} placeholder="e.g. 2.0" />
              </View>
            </View>
            <PickerRow
              label="Brokerage Payout Plan"
              value={BROKERAGE_PLANS.find((p) => p.key === brokeragePaymentPlan)?.label ?? brokeragePaymentPlan}
              placeholder="Payout schedule…"
              onPress={() => setShowBrokeragePlanPicker(true)}
            />
          </>
        ) : (
          <TextField label="Broker / Channel Partner ID" value={brokerId} onChangeText={setBrokerId} placeholder="Leave blank if direct buyer" />
        )}
      </FormSection>

      {/* ── 5. Notes ── */}
      <FormSection title="5. Notes & Remarks">
        <RemarksField label="Booking Remarks" value={notes} onChangeText={setNotes} placeholder="Special conditions, approval references, or notes for finance…" />
      </FormSection>

      {/* ── Pickers Modals ── */}
      <OptionPickerModal
        visible={showAppPicker}
        title="Select Approved Application"
        searchable
        options={apps.map((a) => ({
          key: String(a.Id),
          label: `${a.ApplicantName} (${a.ApplicationNo || `#${a.Id}`})`,
          sublabel: [a.InterestedProject, a.InterestedUnit || a.PlotNames, a.Mobile].filter(Boolean).join(" · "),
        }))}
        selectedKey={selectedAppId}
        onSelect={(key: string) => {
          setShowAppPicker(false);
          const match = apps.find((a) => String(a.Id) === key);
          if (match) applyApplication(match);
        }}
        onClose={() => setShowAppPicker(false)}
      />

      <OptionPickerModal
        visible={showUnitPicker}
        title="Select Available Unit"
        searchable
        options={availableUnits.map((u) => ({
          key: String(u.Id),
          label: `${u.UnitName} — ${u.BlockName || "Block"} (${u.ProjectName})`,
          sublabel: [u.UnitType, u.AreaSqFt && `${u.AreaSqFt} sq ft`, u.RatePerSqFt && `₹${u.RatePerSqFt}/sq ft`].filter(Boolean).join(" · "),
        }))}
        selectedKey={unitIds[0] ?? ""}
        onSelect={(key: string) => {
          setShowUnitPicker(false);
          handleUnitSelect(key);
        }}
        onClose={() => setShowUnitPicker(false)}
      />

      <OptionPickerModal
        visible={showPlotPicker}
        title="Select Available Plot"
        searchable
        options={availablePlots.map((p) => ({
          key: String(p.Id),
          label: `${p.PlotName || p.PlotNo} (${p.ProjectName})`,
          sublabel: [p.AreaSqFt && `${p.AreaSqFt} sq ft`, p.Facing && `${p.Facing} facing`, p.RatePerSqFt && `₹${p.RatePerSqFt}/sq ft`].filter(Boolean).join(" · "),
        }))}
        selectedKey={plotIds[0] ?? ""}
        onSelect={(key: string) => {
          setShowPlotPicker(false);
          handlePlotSelect(key);
        }}
        onClose={() => setShowPlotPicker(false)}
      />

      <OptionPickerModal
        visible={showPlanPicker}
        title="Select Payment Plan"
        options={plans.map((p) => ({
          key: String(p.Id),
          label: p.PlanName,
          sublabel: [p.ItemCount && `${p.ItemCount} milestones`, p.BookingAmount && `Token: ${money(p.BookingAmount)}`].filter(Boolean).join(" · "),
        }))}
        selectedKey={paymentPlanId}
        onSelect={(key: string) => {
          setShowPlanPicker(false);
          handlePlanSelect(key);
        }}
        onClose={() => setShowPlanPicker(false)}
      />

      <OptionPickerModal
        visible={showModePicker}
        title="Payment Mode"
        options={PAY_MODES.map((m) => ({ key: m, label: m }))}
        selectedKey={paymentMode}
        onSelect={(key: string) => {
          setShowModePicker(false);
          setPaymentMode(key);
        }}
        onClose={() => setShowModePicker(false)}
      />

      <OptionPickerModal
        visible={showUserPicker}
        title="Assign Sales Executive"
        options={salesUsers.map((u) => ({ key: String(u.Id), label: u.Name }))}
        selectedKey={assignedTo}
        onSelect={(key: string) => {
          setShowUserPicker(false);
          setAssignedTo(key);
        }}
        onClose={() => setShowUserPicker(false)}
      />

      <OptionPickerModal
        visible={showBrokeragePlanPicker}
        title="Brokerage Payout Plan"
        options={BROKERAGE_PLANS}
        selectedKey={brokeragePaymentPlan}
        onSelect={(key: string) => {
          setShowBrokeragePlanPicker(false);
          setBrokeragePaymentPlan(key);
        }}
        onClose={() => setShowBrokeragePlanPicker(false)}
      />
    </FormScaffold>
  );
}
