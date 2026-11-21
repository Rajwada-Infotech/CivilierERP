// Civilier CRM's layout: five bottom tabs — Home, CRM, Approvals, Maintenance, More — each shown only to staff with a
// right on it (the web's Menu Rights), and every other screen pushed over them with a back arrow (TopHeader.tsx).
import { Text, View, Pressable } from "react-native";
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator, type NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Home, Inbox, Menu, Wrench } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fetchInbox } from "@/api/approvalInboxApi";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import HomeScreen from "@/screens/dashboard/DashboardScreen";
import MaintenanceScreen, { useHasMaintenance } from "@/screens/dashboard/MaintenanceScreen";
import MoreScreen from "@/screens/dashboard/ProfileScreen";
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
import CrmHubScreen, { useHasCrm } from "@/screens/crm/CrmHubScreen";
import CrmDashboardScreen from "@/screens/crm/CrmDashboardScreen";
import CrmRegisterScreen from "@/screens/crm/CrmRegisterScreen";
import BookingDetailScreen from "@/screens/crm/BookingDetailScreen";
import Customer360Screen from "@/screens/crm/Customer360Screen";
import TicketScreen from "@/screens/crm/TicketScreen";
import { NewTicketScreen, PaymentScreen, WelcomeCallScreen } from "@/screens/crm/CrmForms";
import { registerByKey } from "@/screens/crm/crmRegisters";
import { TopHeader } from "./TopHeader";

export type TabParamList = {
  Home: undefined;
  CRM: undefined;
  Approvals: undefined;
  Maintenance: undefined;
  More: undefined;
};

export type MainStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  Notifications: undefined;
  // Maintenance
  Directory: undefined;
  CustomerProfile: { bookingId: number; customerName?: string | null };
  Bills: undefined;
  BillView: { billId: number };
  BillForm: { billId?: number };
  ServiceRequests: undefined;
  Attendance: undefined;
  Electricity: undefined;
  // CRM (screens/crm): the dashboard, any list from crmRegisters.ts, one booking, one customer, one ticket, and the
  // forms that change something (CrmForms.tsx).
  CrmDashboard: undefined;
  CrmRegister: { register: string };
  CrmBooking: { bookingId: number; title?: string };
  CrmCustomer: { customerId: number; title?: string };
  CrmTicket: { ticketId: number };
  CrmTicketNew: { bookingId: number; title?: string };
  CrmWelcomeCall: { bookingId: number; title?: string };
  CrmPayment: { bookingId: number; milestoneId?: number; title?: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const ACCENT = moduleAccents.crm;

const TAB_ICON = { Home, CRM: Briefcase, Approvals: Inbox, Maintenance: Wrench, More: Menu } as const;

function TabBar({ state, navigation, descriptors }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { canAccessPage } = useAuth();
  const canApprove = canAccessPage("approval-inbox");
  // The inbox's own list (same query key as the Approval Inbox), so the badge and the inbox agree.
  const inboxQ = useQuery({ queryKey: ["approval-inbox"], queryFn: fetchInbox, enabled: canApprove, staleTime: 30_000 });
  const waiting = (inboxQ.data ?? []).filter((i) => i._canAct !== false).length;
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 6), paddingTop: 6 }}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const Icon = TAB_ICON[route.name as keyof typeof TAB_ICON];
        const badge = route.name === "Approvals" && waiting > 0 ? waiting : 0;
        const onPress = () => {
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name as never);
        };
        return (
          <Pressable key={route.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }}
            accessibilityLabel={descriptors[route.key].options.title}
            style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 4, borderRadius: 14, backgroundColor: focused ? `${ACCENT}26` : "transparent" }}>
              <Icon size={20} color={focused ? ACCENT : colors.mutedForeground} strokeWidth={focused ? 2.3 : 1.9} />
              {badge ? (
                <View style={{ position: "absolute", top: -2, right: 4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold }}>{badge > 99 ? "99+" : badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 10.5, marginTop: 2, fontFamily: focused ? fonts.heading.semibold : fonts.body.medium, color: focused ? colors.foreground : colors.mutedForeground }}>
              {descriptors[route.key].options.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tabs() {
  const { canAccessPage } = useAuth();
  const hasCrm = useHasCrm();
  const hasMaintenance = useHasMaintenance();
  const canApprove = canAccessPage("approval-inbox");
  return (
    <Tab.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ header: (p) => <TopHeader {...(p as unknown as NativeStackHeaderProps)} /> }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "Home" }} />
      {hasCrm ? <Tab.Screen name="CRM" component={CrmHubScreen} options={{ title: "CRM" }} /> : null}
      {canApprove ? <Tab.Screen name="Approvals" component={ApprovalInboxScreen} options={{ title: "Approvals" }} /> : null}
      {hasMaintenance ? <Tab.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: "Maintenance" }} /> : null}
      <Tab.Screen name="More" component={MoreScreen} options={{ title: "More" }} />
    </Tab.Navigator>
  );
}

export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Directory" component={DirectoryScreen} options={{ title: "Customer Directory" }} />
      <Stack.Screen name="CustomerProfile" component={CustomerProfileScreen} options={{ title: "Customer Profile" }} />
      <Stack.Screen name="Bills" component={BillsScreen} options={{ title: "Maintenance Bills" }} />
      <Stack.Screen name="BillView" component={BillViewScreen} options={{ title: "Bill" }} />
      <Stack.Screen name="BillForm" component={BillFormScreen} options={({ route }) => ({ title: route.params?.billId ? "Edit Bill" : "Create Bill" })} />
      <Stack.Screen name="ServiceRequests" component={ServiceRequestsScreen} options={{ title: "Service Requests" }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: "Security Attendance" }} />
      <Stack.Screen name="Electricity" component={ElectricityScreen} options={{ title: "Electricity Maintenance" }} />
      <Stack.Screen name="CrmDashboard" component={CrmDashboardScreen} options={{ title: "CRM Dashboard" }} />
      <Stack.Screen name="CrmRegister" component={CrmRegisterScreen} options={({ route }) => ({ title: registerByKey(route.params.register)?.label ?? "CRM" })} />
      <Stack.Screen name="CrmBooking" component={BookingDetailScreen} options={({ route }) => ({ title: route.params.title || "Booking" })} />
      <Stack.Screen name="CrmCustomer" component={Customer360Screen} options={({ route }) => ({ title: route.params.title || "Customer 360" })} />
      <Stack.Screen name="CrmTicket" component={TicketScreen} options={{ title: "Service Ticket" }} />
      <Stack.Screen name="CrmTicketNew" component={NewTicketScreen} options={{ title: "New Service Ticket" }} />
      <Stack.Screen name="CrmWelcomeCall" component={WelcomeCallScreen} options={{ title: "Log Welcome Call" }} />
      <Stack.Screen name="CrmPayment" component={PaymentScreen} options={({ route }) => ({ title: route.params.milestoneId ? "Submit Payment" : "On-account Deposit" })} />
    </Stack.Navigator>
  );
}
