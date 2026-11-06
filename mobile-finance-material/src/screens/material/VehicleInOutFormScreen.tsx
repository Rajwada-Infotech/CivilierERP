// The vehicle in / out form as a page of the stack, under the app's header like every other screen, rather than a
// sheet floating over the list. New entry opens it bare; Edit passes the entry's id. Saving or Back returns.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { VehicleInOutFormModal } from "./vehicleInOut/VehicleInOutFormModal";

export default function VehicleInOutFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "VehicleInOutForm">>();
  return <VehicleInOutFormModal asScreen visible editingId={route.params?.id ?? null} onClose={() => navigation.goBack()} />;
}
