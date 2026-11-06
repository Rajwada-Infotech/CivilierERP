// The issue return form as a page of the stack, under the app's header like every other screen, rather than a sheet
// floating over the list. New return opens it bare; Edit passes the return's id. Saving or Back returns.
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { MainStackParamList } from "@/navigation/MainStack";
import { IssueReturnFormModal } from "./issueReturn/IssueReturnFormModal";

export default function IssueReturnFormScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "IssueReturnForm">>();
  return <IssueReturnFormModal asScreen visible editingId={route.params?.id ?? null} onClose={() => navigation.goBack()} />;
}
