/** 画面上部の固定バー。同期状態・マスク・施錠をどの画面からも触れるようにする。 */
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";

export function TopBar({ title, back }: { title: string; back?: boolean }) {
  const c = useColors();
  const v = useVault();
  const router = useRouter();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingBottom: 10,
        paddingTop: 4,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      {back ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={22} color={c.foreground} />
        </Pressable>
      ) : null}

      <Text
        numberOfLines={1}
        style={{ color: c.foreground, fontSize: 17, fontWeight: "700", flex: 1 }}
      >
        {title}
      </Text>

      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: v.offline ? c.warning : c.success,
        }}
      />
      <Text style={{ color: c.mutedForeground, fontSize: 11 }}>
        {v.offline ? "未同期" : "同期済"}
      </Text>

      <Pressable onPress={v.toggleMask} hitSlop={10} style={{ padding: 4 }}>
        <Ionicons
          name={v.masked ? "eye-off" : "eye-outline"}
          size={19}
          color={v.masked ? c.warning : c.mutedForeground}
        />
      </Pressable>
      <Pressable onPress={() => void v.refresh()} hitSlop={10} style={{ padding: 4 }}>
        <Ionicons name="sync-outline" size={19} color={c.mutedForeground} />
      </Pressable>
      <Pressable onPress={v.lock} hitSlop={10} style={{ padding: 4 }}>
        <Ionicons name="lock-closed-outline" size={19} color={c.mutedForeground} />
      </Pressable>
    </View>
  );
}

/** マスクモードのときは企業名・氏名・金額を伏せる */
export function useMaskText() {
  const v = useVault();
  return (text: string | undefined | null): string => {
    const t = String(text ?? "");
    if (!v.masked || !t) return t;
    if (t.length <= 2) return "••";
    return t.slice(0, 1) + "•".repeat(Math.min(t.length - 1, 6));
  };
}
