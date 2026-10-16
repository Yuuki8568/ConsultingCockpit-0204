import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";

export default function TabLayout() {
  const colors = useColors();
  const v = useVault();
  const overdue = v.actions.filter((a) => !a.done && a.due && a.due <= new Date().toISOString().slice(0, 10)).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontSize: 11 },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 62,
          paddingTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "やること",
          tabBarBadge: overdue > 0 ? overdue : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.destructive, fontSize: 10 },
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "checkmark-circle" : "checkmark-circle-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: "案件",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "briefcase" : "briefcase-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: "リード",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: "保全",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "lock-closed" : "lock-closed-outline"} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
