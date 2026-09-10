import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import FollowUpDashboardScreen from "@/screens/followup/FollowUpDashboardScreen";
import TaskListScreen from "@/screens/followup/TaskListScreen";
import TaskMasterScreen from "@/screens/followup/TaskMasterScreen";
import CloseTaskScreen from "@/screens/followup/CloseTaskScreen";
import CancelledTasksScreen from "@/screens/followup/CancelledTasksScreen";
import TaskTransferScreen from "@/screens/followup/TaskTransferScreen";
import TaskPerformanceScreen from "@/screens/followup/TaskPerformanceScreen";
import TagPerformanceScreen from "@/screens/followup/TagPerformanceScreen";
import EntryTypeDocReportScreen from "@/screens/followup/EntryTypeDocReportScreen";
import DepartmentMasterScreen from "@/screens/setup/DepartmentMasterScreen";
import TagMasterScreen from "@/screens/setup/TagMasterScreen";
import CancelTemplateScreen from "@/screens/setup/CancelTemplateScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
  // Transactions
  FollowUpDashboard: undefined;
  TaskList: undefined;
  TaskMaster: undefined;
  CloseTask: undefined;
  CancelledTasks: undefined;
  TaskTransfer: undefined;
  // Reports
  TaskPerformance: undefined;
  TagPerformance: undefined;
  EntryTypeDocReport: undefined;
  // Setup
  DepartmentMaster: undefined;
  TagMaster: undefined;
  CancelTemplate: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Stack, not tabs — navigation happens through the FAB + bottom sheet
// (NavSheet.tsx), which groups every route below into Transactions /
// Reports / Setup, matching the web app's Follow-Up sidebar + Setup
// fly-out + Reports catalog.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />

      <Stack.Screen name="FollowUpDashboard" component={FollowUpDashboardScreen} options={{ title: "Follow-Up" }} />
      <Stack.Screen name="TaskList" component={TaskListScreen} options={{ title: "Tasks" }} />
      <Stack.Screen name="TaskMaster" component={TaskMasterScreen} options={{ title: "Task Master" }} />
      <Stack.Screen name="CloseTask" component={CloseTaskScreen} options={{ title: "Close Task" }} />
      <Stack.Screen name="CancelledTasks" component={CancelledTasksScreen} options={{ title: "Cancelled Tasks" }} />
      <Stack.Screen name="TaskTransfer" component={TaskTransferScreen} options={{ title: "Task Transfer" }} />

      <Stack.Screen name="TaskPerformance" component={TaskPerformanceScreen} options={{ title: "Task Performance" }} />
      <Stack.Screen name="TagPerformance" component={TagPerformanceScreen} options={{ title: "Tag Performance" }} />
      <Stack.Screen name="EntryTypeDocReport" component={EntryTypeDocReportScreen} options={{ title: "Entry Type & Document" }} />

      <Stack.Screen name="DepartmentMaster" component={DepartmentMasterScreen} options={{ title: "Department Master" }} />
      <Stack.Screen name="TagMaster" component={TagMasterScreen} options={{ title: "Tag Master" }} />
      <Stack.Screen name="CancelTemplate" component={CancelTemplateScreen} options={{ title: "Cancel Template" }} />
    </Stack.Navigator>
  );
}
