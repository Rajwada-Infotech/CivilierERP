// The GRN form as a page of the stack, under the app's header like every other screen, rather than a sheet floating
// over the list. New GRN opens it bare; `id` opens one to edit. Saving or Back returns.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { GRNFormModal } from "./grn/GRNFormModal";

export default function GRNFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "GRNForm">>();
  return <GRNFormModal asScreen visible editingId={route.params?.id ?? null} onClose={() => navigation.goBack()} />;
}
