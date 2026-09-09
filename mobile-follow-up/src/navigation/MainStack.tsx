import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import FollowUpDashboardScreen from "@/screens/followup/FollowUpDashboardScreen";
import TaskListScreen from "@/screens/followup/TaskListScreen";
import CloseTaskScreen from "@/screens/followup/CloseTaskScreen";
import CancelledTasksScreen from "@/screens/followup/CancelledTasksScreen";
import TaskTransferScreen from "@/screens/followup/TaskTransferScreen";
import TaskPerformanceScreen from "@/screens/followup/TaskPerformanceScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
  FollowUpDashboard: undefined;
  TaskList: undefined;
  CloseTask: undefined;
  CancelledTasks: undefined;
  TaskTransfer: undefined;
  TaskPerformance: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Stack, not tabs — navigation happens through the FAB + bottom sheet
// (NavSheet.tsx), matching the web app's MobileNav.tsx pattern.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="FollowUpDashboard" component={FollowUpDashboardScreen} options={{ title: "Follow-Up" }} />
      <Stack.Screen name="TaskList" component={TaskListScreen} options={{ title: "Tasks" }} />
      <Stack.Screen name="CloseTask" component={CloseTaskScreen} options={{ title: "Close Task" }} />
      <Stack.Screen name="CancelledTasks" component={CancelledTasksScreen} options={{ title: "Cancelled Tasks" }} />
      <Stack.Screen name="TaskTransfer" component={TaskTransferScreen} options={{ title: "Task Transfer" }} />
      <Stack.Screen name="TaskPerformance" component={TaskPerformanceScreen} options={{ title: "Task Performance" }} />
    </Stack.Navigator>
  );
}
