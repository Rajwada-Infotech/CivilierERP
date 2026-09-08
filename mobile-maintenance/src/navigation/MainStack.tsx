import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import DirectoryScreen from "@/screens/directory/DirectoryScreen";
import BillsScreen from "@/screens/bills/BillsScreen";
import AttendanceScreen from "@/screens/attendance/AttendanceScreen";
import ElectricityScreen from "@/screens/electricity/ElectricityScreen";
import { TopHeader } from "./TopHeader";

// Every module screen this app has: Dashboard (overview), the four
// Maintenance sections (Directory/Bills/Attendance/Electricity — reached
// via SidebarMenu, see navigation/SidebarMenu.tsx), plus Profile/
// Notifications from the header. Add a new module screen here, then list
// it in SidebarMenu's NAV_ITEMS — see README.md "Adding a screen".
export type MainStackParamList = {
  Dashboard: undefined;
  Directory: undefined;
  Bills: undefined;
  Attendance: undefined;
  Electricity: undefined;
  Profile: undefined;
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Directory" component={DirectoryScreen} options={{ title: "Customer Directory" }} />
      <Stack.Screen name="Bills" component={BillsScreen} options={{ title: "Maintenance Bills" }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: "Security Attendance" }} />
      <Stack.Screen name="Electricity" component={ElectricityScreen} options={{ title: "Electricity Maintenance" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
    </Stack.Navigator>
  );
}
