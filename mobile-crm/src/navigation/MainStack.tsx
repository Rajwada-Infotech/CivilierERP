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
import CrmAgreementScreen from "@/screens/crm/CrmAgreementScreen";
import CrmNocScreen from "@/screens/crm/CrmNocScreen";
import CrmSaleDeedScreen from "@/screens/crm/CrmSaleDeedScreen";
import CrmMutationScreen from "@/screens/crm/CrmMutationScreen";
import CrmConstructionUpdatesScreen from "@/screens/crm/CrmConstructionUpdatesScreen";
import CrmOcCcBoardScreen from "@/screens/crm/CrmOcCcBoardScreen";
import Customer360Screen from "@/screens/crm/Customer360Screen";
import TicketScreen from "@/screens/crm/TicketScreen";
import { NewTicketScreen, CustomerFormScreen, ApplicationFormScreen, WelcomeChecklistScreen, PossessionScreen, PaymentScreen, WelcomeCallScreen } from "@/screens/crm/CrmForms";
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
  CrmBooking: { bookingId: number; title?: string };
  CrmCustomer: { customerId: number; title?: string };
  CrmTicket: { ticketId: number };
  CrmTicketNew: { bookingId: number; title?: string };
  CrmCustomerForm: { customerId?: number } | undefined;
  CrmWelcomeChecklist: { bookingId: number; title?: string };
  CrmPossession: { bookingId: number; title?: string };
  CrmApplicationForm: { applicationId?: number; customer?: { Id: number; Name: string } } | undefined;
  CrmWelcomeCall: { bookingId: number; title?: string };
  CrmPayment: { bookingId: number; milestoneId?: number; title?: string };
  CrmAgreement: { bookingId: number; title?: string };
  CrmNoc: { bookingId: number; title?: string };
  CrmSaleDeed: { bookingId: number; title?: string };
  CrmMutation: { bookingId: number; title?: string };
  CrmConstructionUpdates: { projectId: number; projectName?: string };
  CrmOcCcBoard: undefined;
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
        <Stack.Screen name="CrmCustomer" component={Customer360Screen} options={{ title: "Customer 360" }} />
        <Stack.Screen name="CrmTicket" component={TicketScreen} options={{ title: "Service Ticket" }} />
        <Stack.Screen name="CrmTicketNew" component={NewTicketScreen} options={{ title: "New Service Ticket" }} />
        <Stack.Screen name="CrmApplicationForm" component={ApplicationFormScreen} options={({ route }) => ({ title: route.params?.applicationId ? "Edit Application" : "New Application" })} />
        <Stack.Screen name="CrmPossession" component={PossessionScreen} options={{ title: "Possession & Handover" }} />
        <Stack.Screen name="CrmWelcomeChecklist" component={WelcomeChecklistScreen} options={{ title: "Welcome Checklist" }} />
        <Stack.Screen name="CrmCustomerForm" component={CustomerFormScreen} options={({ route }) => ({ title: route.params?.customerId ? "Edit Customer" : "New Customer" })} />
        <Stack.Screen name="CrmWelcomeCall" component={WelcomeCallScreen} options={{ title: "Log Welcome Call" }} />
        <Stack.Screen name="CrmPayment" component={PaymentScreen} options={({ route }) => ({ title: route.params.milestoneId ? "Submit Payment" : "On-account Deposit" })} />
        <Stack.Screen name="CrmAgreement" component={CrmAgreementScreen} options={{ title: "Agreement" }} />
        <Stack.Screen name="CrmNoc" component={CrmNocScreen} options={({ route }) => ({ title: route.params.title || "NOC" })} />
        <Stack.Screen name="CrmSaleDeed" component={CrmSaleDeedScreen} options={{ title: "Sale Deed" }} />
        <Stack.Screen name="CrmMutation" component={CrmMutationScreen} options={{ title: "Mutation" }} />
        <Stack.Screen name="CrmConstructionUpdates" component={CrmConstructionUpdatesScreen} options={({ route }) => ({ title: route.params.projectName || "Construction Updates" })} />
        <Stack.Screen name="CrmOcCcBoard" component={CrmOcCcBoardScreen} options={{ title: "OC / CC Board" }} />
      </Stack.Navigator>
    </ShellMenusProvider>
  );
}
