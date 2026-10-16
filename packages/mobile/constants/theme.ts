import { Platform } from "react-native";

/**
 * App color tokens. Recolor these to brand the app — every screen and component
 * reads from here via `useColors()` (see `hooks/use-colors.ts`), so changing a
 * value here updates the whole app in both light and dark mode.
 *
 * The token names mirror the web app's design tokens (`packages/web/src/web/styles.css`)
 * so the two platforms share one vocabulary: `background`, `foreground`, `card`,
 * `primary`, `muted`, `border`, etc. Values are plain hex/rgba strings — React
 * Native's StyleSheet does not support CSS color functions like `oklch()`.
 */
export const Colors = {
  // Consulting Cockpit は業務端末なので、明暗どちらでも同じ暗い操作卓の色にする。
  // 外出先の明るい場所でも金額や企業名が浮かないよう、意図的にダーク固定。
  light: {
    background: "#0C0C0C",
    foreground: "#F2EFEA",
    card: "#141414",
    cardForeground: "#F2EFEA",
    primary: "#C44D03",
    primaryForeground: "#FFFFFF",
    secondary: "#1B1B1B",
    secondaryForeground: "#F2EFEA",
    muted: "#1B1B1B",
    mutedForeground: "#9A948C",
    accent: "rgba(196,77,3,0.14)",
    accentForeground: "#F2EFEA",
    border: "#2A2A2A",
    destructive: "#B85C38",
    success: "#4A7C59",
    warning: "#C9A961",
    info: "#3B6E8F",
    faint: "#6B665F",
    surface: "#101010",
  },
  dark: {
    background: "#0C0C0C",
    foreground: "#F2EFEA",
    card: "#141414",
    cardForeground: "#F2EFEA",
    primary: "#C44D03",
    primaryForeground: "#FFFFFF",
    secondary: "#1B1B1B",
    secondaryForeground: "#F2EFEA",
    muted: "#1B1B1B",
    mutedForeground: "#9A948C",
    accent: "rgba(196,77,3,0.14)",
    accentForeground: "#F2EFEA",
    border: "#2A2A2A",
    destructive: "#B85C38",
    success: "#4A7C59",
    warning: "#C9A961",
    info: "#3B6E8F",
    faint: "#6B665F",
    surface: "#101010",
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type ThemeColors = (typeof Colors)[ColorScheme];

/**
 * Platform-appropriate font families. Use for `fontFamily` in styles, or load a
 * custom font with `useFonts` from `expo-font` and reference it here.
 */
export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', sans-serif",
    mono: "'SF Mono', 'Roboto Mono', monospace",
  },
});
