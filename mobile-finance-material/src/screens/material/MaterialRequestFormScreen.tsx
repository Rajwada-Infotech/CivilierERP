// The material request form as a page of the stack, under the app's header like every other screen, rather than a
// sheet floating over the list. New request opens it bare; Edit passes the request's id. Saving or Back returns.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { MaterialRequestFormModal } from "./materialRequest/MaterialRequestFormModal";

export default function MaterialRequestFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "MaterialRequestForm">>();
  return <MaterialRequestFormModal asScreen visible editingId={route.params?.id ?? null} onClose={() => navigation.goBack()} />;
}
