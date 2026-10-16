/** モバイル共通部品。指で押せる大きさ（44px以上）を守る。 */
import { forwardRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View
      style={[
        { backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 6, padding: 14 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Text style={{ color: c.foreground, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }}>
      {children}
    </Text>
  );
}

export function Sub({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.mutedForeground, fontSize: 13, lineHeight: 20 }}>{children}</Text>;
}

export function Label({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Text style={{ color: c.mutedForeground, fontSize: 12, marginBottom: 6, fontWeight: "500" }}>
      {children}
    </Text>
  );
}

export function Body({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  const c = useColors();
  return (
    <Text style={{ color: dim ? c.mutedForeground : c.foreground, fontSize: 14, lineHeight: 23 }}>
      {children}
    </Text>
  );
}

export function Num({ children, color }: { children: React.ReactNode; color?: string }) {
  const c = useColors();
  return (
    <Text
      style={{
        color: color ?? c.foreground,
        fontSize: 19,
        fontWeight: "600",
        fontVariant: ["tabular-nums"],
      }}
    >
      {children}
    </Text>
  );
}

export function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  const c = useColors();
  const col = color ?? c.mutedForeground;
  return (
    <View
      style={{
        borderColor: col + "66",
        backgroundColor: col + "1f",
        borderWidth: 1,
        borderRadius: 3,
        paddingHorizontal: 7,
        paddingVertical: 2,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ color: col, fontSize: 11, fontWeight: "600" }}>{children}</Text>
    </View>
  );
}

export function Btn({
  label,
  onPress,
  variant = "default",
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg =
    variant === "primary"
      ? c.primary
      : variant === "ghost"
        ? "transparent"
        : variant === "danger"
          ? "rgba(184,92,56,0.12)"
          : c.secondary;
  const fg =
    variant === "primary"
      ? c.primaryForeground
      : variant === "danger"
        ? c.destructive
        : c.foreground;
  const border =
    variant === "primary" ? c.primary : variant === "ghost" ? "transparent" : c.border;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: 46,
          paddingHorizontal: 16,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      )}
    </Pressable>
  );
}

export const Input = forwardRef<TextInput, TextInputProps & { multiline?: boolean }>(
  function Input({ style, multiline, ...rest }, ref) {
    const c = useColors();
    return (
      <TextInput
        ref={ref}
        multiline={multiline}
        placeholderTextColor={c.faint}
        style={[
          {
            minHeight: multiline ? 96 : 46,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            borderRadius: 5,
            paddingHorizontal: 12,
            paddingTop: multiline ? 10 : 0,
            paddingVertical: multiline ? 10 : 0,
            color: c.foreground,
            fontSize: 15,
            textAlignVertical: multiline ? "top" : "center",
          },
          style,
        ]}
        {...rest}
      />
    );
  },
);

export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "alert" | "ok";
  children: React.ReactNode;
}) {
  const c = useColors();
  const col =
    tone === "warn"
      ? c.warning
      : tone === "alert"
        ? c.destructive
        : tone === "ok"
          ? c.success
          : c.info;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: col + "59",
        backgroundColor: col + "14",
        borderRadius: 5,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: col, fontSize: 13, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Row({
  children,
  gap = 8,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.border, marginVertical: 12 }} />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.border,
        borderRadius: 6,
        padding: 28,
      }}
    >
      <Text style={{ color: c.faint, fontSize: 13, textAlign: "center", lineHeight: 21 }}>
        {children}
      </Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
});
