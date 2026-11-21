import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
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
import CrmDashboardScreen from "@/screens/crm/CrmDashboardScreen";
import CrmRegisterScreen from "@/screens/crm/CrmRegisterScreen";
import BookingDetailScreen from "@/screens/crm/BookingDetailScreen";
import Customer360Screen from "@/screens/crm/Customer360Screen";
import { registerByKey } from "@/screens/crm/crmRegisters";
import { TopHeader } from "./TopHeader";

// Every module screen this app has: Dashboard (overview), the five
// Maintenance sections (Directory/Bills/ServiceRequests/Attendance/Electricity
// — reached via SidebarMenu, see navigation/SidebarMenu.tsx), plus Profile/
// Notifications from the header. Add a new module screen here, then list
// it in SidebarMenu's NAV_ITEMS — see README.md "Adding a screen".
export type MainStackParamList = {
  Dashboard: undefined;
  Directory: undefined;
  CustomerProfile: { bookingId: number; customerName?: string | null };
  Bills: undefined;
  BillView: { billId: number };
  BillForm: { billId?: number };
  ServiceRequests: undefined;
  Attendance: undefined;
  Electricity: undefined;
  ApprovalInbox: undefined;
  // The CRM (screens/crm): its menu, dashboard, any list from crmRegisters.ts, one booking, one customer.
  Crm: undefined;
  CrmDashboard: undefined;
  CrmRegister: { register: string };
  CrmBooking: { bookingId: number; title?: string };
  CrmCustomer: { customerId: number; title?: string };
  Profile: undefined;
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Directory" component={DirectoryScreen} options={{ title: "Customer Directory" }} />
      <Stack.Screen name="CustomerProfile" component={CustomerProfileScreen} options={{ title: "Customer Profile" }} />
      <Stack.Screen name="Bills" component={BillsScreen} options={{ title: "Maintenance Bills" }} />
      <Stack.Screen name="BillView" component={BillViewScreen} options={{ title: "Bill" }} />
      <Stack.Screen name="BillForm" component={BillFormScreen} options={({ route }) => ({ title: route.params?.billId ? "Edit Bill" : "Create Bill" })} />
      <Stack.Screen name="ServiceRequests" component={ServiceRequestsScreen} options={{ title: "Service Requests" }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: "Security Attendance" }} />
      <Stack.Screen name="Electricity" component={ElectricityScreen} options={{ title: "Electricity Maintenance" }} />
      <Stack.Screen name="ApprovalInbox" component={ApprovalInboxScreen} options={{ title: "Approval Inbox" }} />
      <Stack.Screen name="Crm" component={CrmHubScreen} options={{ title: "CRM" }} />
      <Stack.Screen name="CrmDashboard" component={CrmDashboardScreen} options={{ title: "CRM Dashboard" }} />
      <Stack.Screen name="CrmRegister" component={CrmRegisterScreen} options={({ route }) => ({ title: registerByKey(route.params.register)?.label ?? "CRM" })} />
      <Stack.Screen name="CrmBooking" component={BookingDetailScreen} options={({ route }) => ({ title: route.params.title || "Booking" })} />
      <Stack.Screen name="CrmCustomer" component={Customer360Screen} options={({ route }) => ({ title: route.params.title || "Customer 360" })} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
    </Stack.Navigator>
  );
}
