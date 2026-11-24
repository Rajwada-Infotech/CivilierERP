import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/dashboard/DashboardScreen";
import NotificationsScreen from "@/screens/dashboard/NotificationsScreen";
import ProfileScreen from "@/screens/dashboard/ProfileScreen";
import NewVisitorScreen from "@/screens/visitors/NewVisitorScreen";
import VisitorStatusScreen from "@/screens/visitors/VisitorStatusScreen";
import VisitorDecisionScreen from "@/screens/visitors/VisitorDecisionScreen";
import CallScreen from "@/screens/calls/CallScreen";
import VisitorsListScreen from "@/screens/pages/VisitorsListScreen";
import ExpectedGuestsScreen from "@/screens/pages/ExpectedGuestsScreen";
import MyShiftScreen from "@/screens/pages/MyShiftScreen";
import LiveMapScreen from "@/screens/pages/LiveMapScreen";
import VisitorLogScreen from "@/screens/pages/VisitorLogScreen";
import GuardsOnDutyScreen from "@/screens/pages/GuardsOnDutyScreen";
import PassesScreen from "@/screens/pages/PassesScreen";
import CallGateScreen from "@/screens/pages/CallGateScreen";
import ComplaintsScreen from "@/screens/pages/ComplaintsScreen";
import AdminComplaintsScreen from "@/screens/pages/AdminComplaintsScreen";
import type { CallInfo } from "@/api/securityMoreApi";
import { TopHeader } from "./TopHeader";

export type MainStackParamList = {
  Dashboard: undefined;
  Notifications: undefined;
  Profile: undefined;
  /** Guard: raise a visitor request. */
  NewVisitor: undefined;
  /** Guard / admin: one request and its answer. `queuedId` (+ flat) for one still queued offline. */
  VisitorStatus: { id?: number; queuedId?: string; flat?: string };
  /** Resident: approve or deny one request. */
  VisitorDecision: { id: number };
  /** A voice call: `call` when this side started it (with its token), `incoming` to answer one; `dialNumber` is the phone fallback. */
  Call: { callId: number; call?: CallInfo; incoming?: boolean; dialNumber?: string };
  VisitorsList: undefined;
  ExpectedGuests: undefined;
  MyShift: undefined;
  LiveMap: undefined;
  VisitorLog: undefined;
  GuardsOnDuty: undefined;
  Passes: undefined;
  CallGate: undefined;
  /** Resident: complain about a guard, and see the answers. */
  Complaints: undefined;
  /** Security admin: residents' complaints about guards. */
  AdminComplaints: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

// Stack, not tabs: the menu key at the bottom right opens the sheet (NavSheet.tsx).
export default function MainStack() {
  return (
    <Stack.Navigator screenOptions={{ header: (props) => <TopHeader {...props} /> }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="NewVisitor" component={NewVisitorScreen} options={{ title: "New visitor" }} />
      <Stack.Screen name="VisitorStatus" component={VisitorStatusScreen} options={{ title: "Visitor" }} />
      <Stack.Screen name="VisitorDecision" component={VisitorDecisionScreen} options={{ title: "Visitor" }} />
      <Stack.Screen name="Call" component={CallScreen} options={{ title: "Call", headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="VisitorsList" component={VisitorsListScreen} options={{ title: "Visitors" }} />
      <Stack.Screen name="ExpectedGuests" component={ExpectedGuestsScreen} options={{ title: "Expected guests" }} />
      <Stack.Screen name="MyShift" component={MyShiftScreen} options={{ title: "My shift" }} />
      <Stack.Screen name="LiveMap" component={LiveMapScreen} options={{ title: "Live map" }} />
      <Stack.Screen name="VisitorLog" component={VisitorLogScreen} options={{ title: "Visitor log" }} />
      <Stack.Screen name="GuardsOnDuty" component={GuardsOnDutyScreen} options={{ title: "Guards on duty" }} />
      <Stack.Screen name="Passes" component={PassesScreen} options={{ title: "Guest passes" }} />
      <Stack.Screen name="CallGate" component={CallGateScreen} options={{ title: "Call the gate" }} />
      <Stack.Screen name="Complaints" component={ComplaintsScreen} options={{ title: "Complain about a guard" }} />
      <Stack.Screen name="AdminComplaints" component={AdminComplaintsScreen} options={{ title: "Complaints" }} />
    </Stack.Navigator>
  );
}
