// The material issue form as a page of the stack, under the app's header like every other screen, rather than a sheet
// floating over the list. New issue opens it bare; Edit passes the issue's id. Saving or Back returns.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { MaterialIssueFormModal } from "./materialIssues/MaterialIssueFormModal";

export default function MaterialIssueFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "MaterialIssueForm">>();
  return <MaterialIssueFormModal asScreen visible editingId={route.params?.id ?? null} onClose={() => navigation.goBack()} />;
}
