import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import AssetRegisterScreen from "@/screens/assets/AssetRegisterScreen";
import AssetDetailScreen from "@/screens/assets/AssetDetailScreen";
import AssetFormScreen from "@/screens/assets/AssetFormScreen";
import MaintenanceScreen from "@/screens/maintenance/MaintenanceScreen";
import MaintenanceDetailScreen from "@/screens/maintenance/MaintenanceDetailScreen";
import MaintenanceFormScreen from "@/screens/maintenance/MaintenanceFormScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import MenuScreen from "@/screens/menu/MenuScreen";
import TaggingScreen from "@/screens/tagging/TaggingScreen";
import TaggingDetailScreen from "@/screens/tagging/TaggingDetailScreen";
import TaggingFormScreen from "@/screens/tagging/TaggingFormScreen";
import StickerScreen from "@/screens/stickers/StickerScreen";
import AssignmentScreen from "@/screens/assignment/AssignmentScreen";
import AssignmentDetailScreen from "@/screens/assignment/AssignmentDetailScreen";
import AssignmentFormScreen from "@/screens/assignment/AssignmentFormScreen";
import AssetTransferScreen from "@/screens/transfer/AssetTransferScreen";
import AssetTransferDetailScreen from "@/screens/transfer/AssetTransferDetailScreen";
import AssetTransferFormScreen from "@/screens/transfer/AssetTransferFormScreen";
import QualityCheckScreen from "@/screens/quality/QualityCheckScreen";
import QualityCheckDetailScreen from "@/screens/quality/QualityCheckDetailScreen";
import QualityCheckFormScreen from "@/screens/quality/QualityCheckFormScreen";
import ReportsScreen from "@/screens/reports/ReportsScreen";
import ReportViewScreen from "@/screens/reports/ReportViewScreen";
import type { ReportKey } from "@/screens/reports/reportConfig";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Menu: undefined;
  AssetRegister: undefined;
  Maintenance: undefined;
  Tagging: undefined;
  Stickers: undefined;
  Assignment: undefined;
  AssetTransfer: undefined;
  QualityCheck: undefined;
  Reports: undefined;
  ReportView: { report: ReportKey };
  Profile: undefined;
  Notifications: undefined;
  AssetDetail: { id: number };
  AssetForm: { id?: number } | undefined;
  TaggingDetail: { id: number };
  TaggingForm: { id?: number } | undefined;
  AssignmentDetail: { id: number };
  AssignmentForm: { id?: number } | undefined;
  AssetTransferDetail: { id: number };
  AssetTransferForm: { id?: number } | undefined;
  QualityCheckDetail: { id: number };
  QualityCheckForm: { id?: number } | undefined;
  MaintenanceDetail: { id: number };
  MaintenanceForm: { id?: number } | undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Dashboard / AssetRegister / Maintenance are the three tabs BottomPillNav
// switches between; Menu (reached via the header hamburger) lists every
// Fixed Asset module. Each module has List → Detail → Form screens.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Menu" component={MenuScreen} options={{ title: "Menu" }} />
      <Stack.Screen name="AssetRegister" component={AssetRegisterScreen} options={{ title: "Asset Register" }} />
      <Stack.Screen name="AssetDetail" component={AssetDetailScreen} options={{ title: "Asset" }} />
      <Stack.Screen name="AssetForm" component={AssetFormScreen} options={{ title: "Fixed Asset" }} />
      <Stack.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: "Maintenance & Repair" }} />
      <Stack.Screen name="MaintenanceDetail" component={MaintenanceDetailScreen} options={{ title: "Maintenance" }} />
      <Stack.Screen name="MaintenanceForm" component={MaintenanceFormScreen} options={{ title: "Maintenance & Repair" }} />
      <Stack.Screen name="Tagging" component={TaggingScreen} options={{ title: "FA Inventory" }} />
      <Stack.Screen name="TaggingDetail" component={TaggingDetailScreen} options={{ title: "Tagging Entry" }} />
      <Stack.Screen name="TaggingForm" component={TaggingFormScreen} options={{ title: "FA Inventory" }} />
      <Stack.Screen name="Stickers" component={StickerScreen} options={{ title: "FA Code Stickers" }} />
      <Stack.Screen name="Assignment" component={AssignmentScreen} options={{ title: "Assignment" }} />
      <Stack.Screen name="AssignmentDetail" component={AssignmentDetailScreen} options={{ title: "Assignment" }} />
      <Stack.Screen name="AssignmentForm" component={AssignmentFormScreen} options={{ title: "Assignment" }} />
      <Stack.Screen name="AssetTransfer" component={AssetTransferScreen} options={{ title: "User-Wise Asset Transfer" }} />
      <Stack.Screen name="AssetTransferDetail" component={AssetTransferDetailScreen} options={{ title: "Transfer" }} />
      <Stack.Screen name="AssetTransferForm" component={AssetTransferFormScreen} options={{ title: "Asset Transfer" }} />
      <Stack.Screen name="QualityCheck" component={QualityCheckScreen} options={{ title: "Owner & Quality Checking" }} />
      <Stack.Screen name="QualityCheckDetail" component={QualityCheckDetailScreen} options={{ title: "Quality Check" }} />
      <Stack.Screen name="QualityCheckForm" component={QualityCheckFormScreen} options={{ title: "Quality Check" }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: "Reports" }} />
      <Stack.Screen name="ReportView" component={ReportViewScreen} options={{ title: "Report" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
    </Stack.Navigator>
  );
}
