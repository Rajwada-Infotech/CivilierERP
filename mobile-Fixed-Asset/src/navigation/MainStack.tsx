import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import AssetRegisterScreen from "@/screens/assets/AssetRegisterScreen";
import AssetDetailScreen from "@/screens/assets/AssetDetailScreen";
import AssetFormScreen from "@/screens/assets/AssetFormScreen";
import MaintenanceScreen from "@/screens/maintenance/MaintenanceScreen";
import NotificationsScreen from "@/screens/notifications/NotificationsScreen";
import MenuScreen from "@/screens/menu/MenuScreen";
import TaggingScreen from "@/screens/tagging/TaggingScreen";
import InventoryImportScreen from "@/screens/inventoryImport/InventoryImportScreen";
import AssignmentScreen from "@/screens/assignment/AssignmentScreen";
import AssetTransferScreen from "@/screens/transfer/AssetTransferScreen";
import QualityCheckScreen from "@/screens/quality/QualityCheckScreen";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Menu: undefined;
  AssetRegister: undefined;
  Maintenance: undefined;
  Tagging: undefined;
  InventoryImport: undefined;
  Assignment: undefined;
  AssetTransfer: undefined;
  QualityCheck: undefined;
  Profile: undefined;
  Notifications: undefined;
  AssetDetail: { id: number };
  AssetForm: { id?: number } | undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Dashboard / AssetRegister / Maintenance are the three tabs BottomPillNav
// switches between; Menu (reached via the header hamburger) lists every
// Fixed Asset module and pushes the read-only list screens on top. Profile
// is reached via the header avatar; AssetDetail from the Asset Register.
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Menu" component={MenuScreen} options={{ title: "Menu" }} />
      <Stack.Screen name="AssetRegister" component={AssetRegisterScreen} options={{ title: "Asset Register" }} />
      <Stack.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: "Maintenance & Repair" }} />
      <Stack.Screen name="Tagging" component={TaggingScreen} options={{ title: "FA Inventory" }} />
      <Stack.Screen name="InventoryImport" component={InventoryImportScreen} options={{ title: "Inventory Import" }} />
      <Stack.Screen name="Assignment" component={AssignmentScreen} options={{ title: "Assignment" }} />
      <Stack.Screen name="AssetTransfer" component={AssetTransferScreen} options={{ title: "User-Wise Asset Transfer" }} />
      <Stack.Screen name="QualityCheck" component={QualityCheckScreen} options={{ title: "Owner & Quality Checking" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="AssetDetail" component={AssetDetailScreen} options={{ title: "Asset" }} />
      <Stack.Screen name="AssetForm" component={AssetFormScreen} options={{ title: "Fixed Asset" }} />
    </Stack.Navigator>
  );
}
