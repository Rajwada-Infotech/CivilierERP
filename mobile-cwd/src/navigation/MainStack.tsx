import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import ActivitiesScreen from "@/screens/activities/ActivitiesScreen";
import ActivityDetailScreen from "@/screens/activities/ActivityDetailScreen";
import { TopHeader } from "./TopHeader";

// Every screen this app has: Dashboard (overview), Activities (the allocated-work list — reached
// via SidebarMenu, see navigation/SidebarMenu.tsx), plus Profile / Notifications from the header.
// Add a new screen here, then list it in SidebarMenu's NAV_ITEMS — see README.md "Adding a screen".
export type MainStackParamList = {
  Dashboard: undefined;
  // `filter` opens the list on one status (Quality Check = the Completed ones).
  Activities: { filter?: string } | undefined;
  ActivityDetail: { rungId: number };
  Profile: undefined;
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Activities" component={ActivitiesScreen} options={{ title: "Activities" }} />
      <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} options={{ title: "Activity" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
    </Stack.Navigator>
  );
}
