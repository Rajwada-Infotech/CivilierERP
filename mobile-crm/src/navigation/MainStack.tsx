// Civilier CRM's layout, as Civilier Home's (mobile-maintenance CustomerStack.tsx): a floating, rounded tab bar —
// Home, Bookings, CRM (every other CRM list), Maintenance, each shown only to staff with a right on it — and Menu,
// which pops up the Approval Inbox (TopHeader.tsx NavMenuSheet). Every other
// screen is pushed over the tabs with a round back key.
import { Text, View } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Briefcase, ClipboardList, Home, LayoutGrid, Wrench } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import HomeScreen from "@/screens/dashboard/DashboardScreen";
import MaintenanceScreen, { KeyCustodianScreen, useHasMaintenance } from "@/screens/dashboard/MaintenanceScreen";
import ProfileScreen, { SettingsScreen } from "@/screens/dashboard/ProfileScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import DirectoryScreen from "@/screens/directory/DirectoryScreen";
import CustomerProfileScreen from "@/screens/directory/CustomerProfileScreen";
import BillsScreen from "@/screens/bills/BillsScreen";
import BillViewScreen from "@/screens/bills/BillViewScreen";
import BillFormScreen from "@/screens/bills/BillFormScreen";
import AttendanceScreen from "@/screens/attendance/AttendanceScreen";
import ElectricityScreen from "@/screens/electricity/ElectricityScreen";
import ServiceRequestsScreen from "@/screens/tickets/ServiceRequestsScreen";
import ApprovalInboxScreen from "@/screens/approvals/ApprovalInboxScreen";
import CrmHubScreen from "@/screens/crm/CrmHubScreen";
import CrmRegisterScreen from "@/screens/crm/CrmRegisterScreen";
import UnitMatrixScreen from "@/screens/crm/UnitMatrixScreen";
import ParkingMatrixScreen from "@/screens/crm/ParkingMatrixScreen";
import BookingDetailScreen from "@/screens/crm/BookingDetailScreen";
import CrmBookingNewScreen from "@/screens/crm/CrmBookingNewScreen";
import CrmAgreementScreen from "@/screens/crm/CrmAgreementScreen";
import CrmNocScreen from "@/screens/crm/CrmNocScreen";
import CrmSaleDeedScreen from "@/screens/crm/CrmSaleDeedScreen";
import CrmMutationScreen from "@/screens/crm/CrmMutationScreen";
import CrmConstructionUpdatesScreen from "@/screens/crm/CrmConstructionUpdatesScreen";
import CrmOcCcBoardScreen from "@/screens/crm/CrmOcCcBoardScreen";
import CrmCancellationScreen from "@/screens/crm/CrmCancellationScreen";
import CrmCancellationNewScreen from "@/screens/crm/CrmCancellationNewScreen";
import CrmRefundScreen, { NewRefundScreen } from "@/screens/crm/CrmRefundScreen";
import CrmInvoiceScreen from "@/screens/crm/CrmInvoiceScreen";
import CrmResaleScreen, { NewResaleScreen } from "@/screens/crm/CrmResaleScreen";
import CrmMoneyReceiptScreen from "@/screens/crm/CrmMoneyReceiptScreen";
import CrmBrokerageScreen from "@/screens/crm/CrmBrokerageScreen";
import CrmTransferDeedScreen from "@/screens/crm/CrmTransferDeedScreen";
import CrmOwnershipChangeScreen from "@/screens/crm/CrmOwnershipChangeScreen";
import CrmCreditNoteScreen from "@/screens/crm/CrmCreditNoteScreen";
import CrmUnitChangeScreen from "@/screens/crm/CrmUnitChangeScreen";
import CrmLegalMilestoneScreen from "@/screens/crm/CrmLegalMilestoneScreen";
import CrmLoanTrackingScreen from "@/screens/crm/CrmLoanTrackingScreen";
import CrmBookingAmendmentScreen from "@/screens/crm/CrmBookingAmendmentScreen";
import CrmDemandDetailScreen from "@/screens/crm/CrmDemandDetailScreen";
import Customer360Screen from "@/screens/crm/Customer360Screen";
import TicketScreen from "@/screens/crm/TicketScreen";
import { NewTicketScreen, CustomerFormScreen, ApplicationFormScreen, WelcomeChecklistScreen, PossessionScreen, PaymentScreen, WelcomeCallScreen, BankDetailsScreen, OnAccountAdjustScreen, BookingChargesScreen, ParkingAllotmentScreen, ParkingSaleScreen, OcCcCertificateScreen, AfsQueryPaymentScreen, AfsStartScreen, CustomerImportScreen } from "@/screens/crm/CrmForms";
import { pairParent, registerByKey, useHasCrm } from "@/screens/crm/crmRegisters";
import { Tap } from "@/screens/crm/ui";
import { ShellMenusProvider, TopHeader, useMenuCount, useShellMenus } from "./TopHeader";

export type TabParamList = {
  Home: undefined;
  Bookings: { register: string };
  CRM: undefined;
  Maintenance: undefined;
};

export type MainStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  Notifications: undefined;
  Profile: undefined;
  Settings: undefined;
  Approvals: undefined;
  // Maintenance
  Directory: undefined;
  KeyCustodian: undefined;
  CustomerProfile: { bookingId: number; customerName?: string | null };
  Bills: undefined;
  BillView: { billId: number };
  BillForm: { billId?: number };
  ServiceRequests: undefined;
  Attendance: undefined;
  Electricity: undefined;
  // CRM (screens/crm): any list from crmRegisters.ts, one booking, one customer, one ticket, and the
  // forms that change something (CrmForms.tsx).
  CrmRegister: { register: string };
  CrmUnitMatrix: undefined;
  CrmParkingMatrix: undefined;
  CrmBooking: { bookingId: number; title?: string; focus?: "money" };
  CrmBookingNew: { applicationId?: number } | undefined;
  CrmCustomer: { customerId: number; title?: string };
  CrmTicket: { ticketId: number };
  CrmTicketNew: { bookingId: number; title?: string };
  CrmBankDetails: { bookingId: number; row: Record<string, any> };
  CrmOnAccountAdjust: { deposit: Record<string, any> };
  CrmBookingCharges: { bookingId: number; title?: string };
  CrmRefundNew: undefined;
  CrmCancellationNew: undefined;
  CrmParkingAllotment: { allotment: Record<string, any> };
  CrmParkingSale: undefined;
  CrmResaleNew: undefined;
  CrmAfsQueryPayment: { id: number; title?: string };
  CrmAfsStart: { kind: "qp" | "registry" };
  CrmCustomerImport: undefined;
  CrmOcCcCert: { cert?: Record<string, any>; status?: string } | undefined;
  CrmCustomerForm: { customerId?: number; lead?: { Id: number; LeadUid?: string; CustomerName?: string; Mobile?: string; AltMobile?: string; Email?: string } } | undefined;
  CrmWelcomeChecklist: { bookingId: number; title?: string };
  CrmPossession: { bookingId: number; title?: string };
  CrmApplicationForm: { applicationId?: number; customer?: { Id: number; Name: string }; pick?: { ProjectId: number; UnitId?: number; PlotId?: number } } | undefined;
  CrmWelcomeCall: { bookingId: number; title?: string };
  CrmPayment: { bookingId: number; milestoneId?: number; title?: string };
  CrmAgreement: { bookingId?: number; title?: string } | undefined;
  CrmNoc: { bookingId?: number; title?: string } | undefined;
  CrmSaleDeed: { bookingId?: number; title?: string } | undefined;
  CrmMutation: { bookingId?: number; title?: string } | undefined;
  CrmConstructionUpdates: { projectId: number; projectName?: string };
  CrmOcCcBoard: undefined;
  CrmCancellation: { cancellationId: number; title?: string };
  CrmRefund: { refundId: number; title?: string };
  CrmInvoice: { invoiceId: number; title?: string };
  CrmResale: { resaleId: number; title?: string };
  CrmMoneyReceipt: { receiptId: number; title?: string };
  CrmBrokerage: { brokerageId: number; title?: string };
  CrmTransferDeed: { deedId: number; title?: string };
  CrmOwnershipChange: { changeId: number; title?: string };
  CrmCreditNote: { creditNoteId: number; title?: string };
  CrmUnitChange: { changeId: number; title?: string };
  CrmLegalMilestone: { bookingId: number; title?: string };
  CrmLoanTracking: { bookingId: number; title?: string };
  CrmBookingAmendment: { amendmentId: number; title?: string; amendment?: Record<string, any> };
  CrmDemandDetail: { milestoneId: number; title?: string; demand?: Record<string, any> };
};

const Stack = createNativeStackNavigator<MainStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const TABS = {
  Home: { label: "Home", icon: Home },
  Bookings: { label: "Bookings", icon: ClipboardList },
  CRM: { label: "CRM", icon: Briefcase },
  Maintenance: { label: "Maintenance", icon: Wrench },
} as const;

/** A floating, rounded tab bar (Civilier Home's): the active tab in an accent pill; Menu pops up the other pages. */
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const b = useBrand();
  const menus = useShellMenus();
  // The Menu's badge: approvals waiting + unread notifications (what the Menu opens).
  const menuCount = useMenuCount();
  const item = (key: string, label: string, Icon: typeof Home, focused: boolean, onPress: () => void, badge = 0) => (
    <Tap key={key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 56 }}>
      <View style={{ alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, backgroundColor: focused ? b.accentSoft : "transparent" }}>
        <View>
          <Icon size={21} color={focused ? b.accent : b.textFaint} strokeWidth={focused ? 2.3 : 1.9} />
          {badge > 0 ? (
            <View style={{ position: "absolute", top: -6, right: -12, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: b.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: b.isDark ? "#1C1C25" : "#FFFFFF" }}>
              <Text style={{ color: "#fff", fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{badge > 99 ? "99+" : badge}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: focused ? fonts.heading.semibold : fonts.body.medium, color: focused ? b.accent : b.textSecondary }}>{label}</Text>
      </View>
    </Tap>
  );
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 10) + 6, paddingHorizontal: 14 }}>
      <View style={{
        flexDirection: "row", alignItems: "center", height: 68, borderRadius: 26, paddingHorizontal: 6,
        backgroundColor: b.isDark ? "#1C1C25" : "#FFFFFF", borderWidth: 1, borderColor: b.border,
        shadowColor: "#000", shadowOpacity: b.isDark ? 0.5 : 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 14,
      }}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const tab = TABS[route.name as keyof typeof TABS];
          const onPress = () => {
            const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigation.navigate(route.name as never);
          };
          return item(route.key, tab?.label ?? descriptors[route.key].options.title ?? route.name, tab?.icon ?? Home, focused, onPress);
        })}
        {/* Menu: not a page of its own — it pops up the Approval Inbox. */}
        {item("menu", "Menu", LayoutGrid, false, menus.nav, menuCount)}
      </View>
    </View>
  );
}

function Tabs() {
  const { canAccessPage } = useAuth();
  const hasCrm = useHasCrm();
  const hasMaintenance = useHasMaintenance();
  const b = useBrand();
  const header = (p: unknown) => <TopHeader {...(p as NativeStackHeaderProps)} />;
  return (
    <Tab.Navigator tabBar={(p) => <FloatingTabBar {...p} />} screenOptions={{ header, sceneStyle: { backgroundColor: b.surface } }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "Home" }} />
      {canAccessPage("crm-bookings") ? (
        <Tab.Screen name="Bookings" component={CrmRegisterScreen as never} initialParams={{ register: "bookings" }} options={{ title: "Bookings" }} />
      ) : null}
      {hasCrm ? <Tab.Screen name="CRM" component={CrmHubScreen} options={{ title: "CRM" }} /> : null}
      {hasMaintenance ? <Tab.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: "Maintenance" }} /> : null}
    </Tab.Navigator>
  );
}

export default function MainStack() {
  const b = useBrand();
  return (
    <ShellMenusProvider>
      <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} />, contentStyle: { backgroundColor: b.surface } }}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "My profile" }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
        <Stack.Screen name="Approvals" component={ApprovalInboxScreen} options={{ title: "Approval Inbox" }} />
        <Stack.Screen name="Directory" component={DirectoryScreen} options={{ title: "Customer Directory" }} />
        <Stack.Screen name="KeyCustodian" component={KeyCustodianScreen} options={{ title: "Key Custodian" }} />
        <Stack.Screen name="CustomerProfile" component={CustomerProfileScreen} options={{ title: "Customer Profile" }} />
        <Stack.Screen name="Bills" component={BillsScreen} options={{ title: "Maintenance Bills" }} />
        <Stack.Screen name="BillView" component={BillViewScreen} options={{ title: "Bill" }} />
        <Stack.Screen name="BillForm" component={BillFormScreen} options={({ route }) => ({ title: route.params?.billId ? "Edit Bill" : "Create Bill" })} />
        <Stack.Screen name="ServiceRequests" component={ServiceRequestsScreen} options={{ title: "Service Requests" }} />
        <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: "Security Attendance" }} />
        <Stack.Screen name="Electricity" component={ElectricityScreen} options={{ title: "Electricity Maintenance" }} />
        <Stack.Screen name="CrmRegister" component={CrmRegisterScreen} options={({ route }) => ({ title: (pairParent(route.params.register) ?? registerByKey(route.params.register))?.label ?? "CRM" })} />
        <Stack.Screen name="CrmUnitMatrix" component={UnitMatrixScreen} options={{ title: "Unit Matrix" }} />
        <Stack.Screen name="CrmParkingMatrix" component={ParkingMatrixScreen} options={{ title: "Parking Matrix" }} />
        <Stack.Screen name="CrmBooking" component={BookingDetailScreen} options={({ route }) => ({ title: route.params.title || "Booking" })} />
        <Stack.Screen name="CrmBookingNew" component={CrmBookingNewScreen} options={{ title: "New Booking" }} />
        <Stack.Screen name="CrmCustomer" component={Customer360Screen} options={{ title: "Customer 360" }} />
        <Stack.Screen name="CrmTicket" component={TicketScreen} options={{ title: "Service Ticket" }} />
        <Stack.Screen name="CrmTicketNew" component={NewTicketScreen} options={{ title: "New Service Ticket" }} />
        <Stack.Screen name="CrmApplicationForm" component={ApplicationFormScreen} options={({ route }) => ({ title: route.params?.applicationId ? "Edit Application" : "New Application" })} />
        <Stack.Screen name="CrmPossession" component={PossessionScreen} options={{ title: "Possession & Handover" }} />
        <Stack.Screen name="CrmWelcomeChecklist" component={WelcomeChecklistScreen} options={{ title: "Welcome Checklist" }} />
        <Stack.Screen name="CrmBankDetails" component={BankDetailsScreen} options={{ title: "Bank and KYC" }} />
        <Stack.Screen name="CrmParkingAllotment" component={ParkingAllotmentScreen} options={{ title: "Parking allotment" }} />
        <Stack.Screen name="CrmOcCcCert" component={OcCcCertificateScreen}
          options={({ route }) => ({ title: route.params?.cert ? (route.params.cert.CertType === "CC" ? "Completion Certificate" : route.params.cert.CertType === "OC" ? "Occupancy Certificate" : "Certificate") : "File Application" })} />
        <Stack.Screen name="CrmCustomerImport" component={CustomerImportScreen} options={{ title: "Import customers" }} />
        <Stack.Screen name="CrmAfsQueryPayment" component={AfsQueryPaymentScreen} options={({ route }) => ({ title: route.params.title || "AFS Query Payment" })} />
        <Stack.Screen name="CrmAfsStart" component={AfsStartScreen} options={({ route }) => ({ title: route.params.kind === "qp" ? "Start Registration Fee Tracker" : "Start AFS Registry" })} />
        <Stack.Screen name="CrmResaleNew" component={NewResaleScreen} options={{ title: "New resale or buy-back" }} />
        <Stack.Screen name="CrmParkingSale" component={ParkingSaleScreen} options={{ title: "New standalone parking sale" }} />
        <Stack.Screen name="CrmRefundNew" component={NewRefundScreen} options={{ title: "New Refund" }} />
        <Stack.Screen name="CrmCancellationNew" component={CrmCancellationNewScreen} options={{ title: "New Cancellation" }} />
        <Stack.Screen name="CrmBookingCharges" component={BookingChargesScreen} options={{ title: "Parking & Extra Charges" }} />
        <Stack.Screen name="CrmOnAccountAdjust" component={OnAccountAdjustScreen}
          options={({ route }) => ({ title: `Adjust ${route.params.deposit.ReceiptNo || `deposit #${route.params.deposit.Id}`}` })} />
        <Stack.Screen name="CrmCustomerForm" component={CustomerFormScreen} options={({ route }) => ({ title: route.params?.customerId ? "Edit Customer" : "New Customer" })} />
        <Stack.Screen name="CrmWelcomeCall" component={WelcomeCallScreen} options={{ title: "Log Welcome Call" }} />
        <Stack.Screen name="CrmPayment" component={PaymentScreen} options={({ route }) => ({ title: route.params.milestoneId ? "Submit Payment" : "On-account Deposit" })} />
        <Stack.Screen name="CrmAgreement" component={CrmAgreementScreen} options={({ route }) => ({ title: route.params?.title || "Agreement" })} />
        <Stack.Screen name="CrmNoc" component={CrmNocScreen} options={({ route }) => ({ title: route.params?.title || "NOC" })} />
        <Stack.Screen name="CrmSaleDeed" component={CrmSaleDeedScreen} options={({ route }) => ({ title: route.params?.title || "Sale Deed" })} />
        <Stack.Screen name="CrmMutation" component={CrmMutationScreen} options={({ route }) => ({ title: route.params?.title || "Mutation" })} />
        <Stack.Screen name="CrmConstructionUpdates" component={CrmConstructionUpdatesScreen} options={({ route }) => ({ title: route.params.projectName || "Construction Updates" })} />
        <Stack.Screen name="CrmOcCcBoard" component={CrmOcCcBoardScreen} options={{ title: "OC / CC Board" }} />
        <Stack.Screen name="CrmCancellation" component={CrmCancellationScreen} options={({ route }) => ({ title: route.params.title || "Cancellation" })} />
        <Stack.Screen name="CrmRefund" component={CrmRefundScreen} options={({ route }) => ({ title: route.params.title || "Refund" })} />
        <Stack.Screen name="CrmInvoice" component={CrmInvoiceScreen} options={({ route }) => ({ title: route.params.title || "Invoice" })} />
        <Stack.Screen name="CrmResale" component={CrmResaleScreen} options={({ route }) => ({ title: route.params.title || "Resale" })} />
        <Stack.Screen name="CrmMoneyReceipt" component={CrmMoneyReceiptScreen} options={({ route }) => ({ title: route.params.title || "Money Receipt" })} />
        <Stack.Screen name="CrmBrokerage" component={CrmBrokerageScreen} options={({ route }) => ({ title: route.params.title || "Brokerage" })} />
        <Stack.Screen name="CrmTransferDeed" component={CrmTransferDeedScreen} options={({ route }) => ({ title: route.params.title || "Transfer Deed" })} />
        <Stack.Screen name="CrmOwnershipChange" component={CrmOwnershipChangeScreen} options={({ route }) => ({ title: route.params.title || "Ownership Change" })} />
        <Stack.Screen name="CrmCreditNote" component={CrmCreditNoteScreen} options={({ route }) => ({ title: route.params.title || "Credit Note" })} />
        <Stack.Screen name="CrmUnitChange" component={CrmUnitChangeScreen} options={({ route }) => ({ title: route.params.title || "Unit Change" })} />
        <Stack.Screen name="CrmLegalMilestone" component={CrmLegalMilestoneScreen} options={({ route }) => ({ title: route.params.title || "Legal Milestones" })} />
        <Stack.Screen name="CrmLoanTracking" component={CrmLoanTrackingScreen} options={({ route }) => ({ title: route.params.title || "Home Loan Tracking" })} />
        <Stack.Screen name="CrmBookingAmendment" component={CrmBookingAmendmentScreen} options={({ route }) => ({ title: route.params.title || "Booking Amendment" })} />
        <Stack.Screen name="CrmDemandDetail" component={CrmDemandDetailScreen} options={({ route }) => ({ title: route.params.title || "Milestone Demand" })} />
      </Stack.Navigator>
    </ShellMenusProvider>
  );
}
