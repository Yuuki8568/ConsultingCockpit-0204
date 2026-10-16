/** リード一覧。段階と次アクションだけを見る。 */
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";
import { TopBar, useMaskText } from "@/components/topbar";
import { Badge, Card, Empty, Input, Row, Sub } from "@/components/ui";
import { classifyDue, yen } from "@/lib/vault-store";
import { LEAD_STATUS_LABEL, SALES_STAGE_LABEL, SALES_STAGE_ORDER } from "@/constants/labels";

export default function Leads() {
  const c = useColors();
  const v = useVault();
  const mask = useMaskText();
  const router = useRouter();
  const [stage, setStage] = useState<string>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    let rows = v.state?.leads ?? [];
    if (stage !== "all") rows = rows.filter((l) => (l.salesStage || "approach") === stage);
    const key = q.trim().toLowerCase();
    if (key)
      rows = rows.filter((l) =>
        [l.company, l.name].filter(Boolean).some((s) => String(s).toLowerCase().includes(key)),
      );
    return rows;
  }, [v.state, stage, q]);

  const forecast = useMemo(
    () =>
      (v.state?.leads ?? [])
        .filter((l) => l.salesStage !== "won" && l.status !== "converted")
        .reduce((sum, l) => sum + (Number(l.dealValue) || 0) * ((Number(l.winProbability) || 0) / 100), 0),
    [v.state],
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar title={`リード ${v.state?.leads.length ?? 0}件`} />
      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 30 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => {
              setBusy(true);
              void v.refresh().finally(() => setBusy(false));
            }}
            tintColor={c.primary}
          />
        }
      >
        <Card style={{ gap: 4 }}>
          <Sub>進行中の見込み（金額 × 確度の合計）</Sub>
          <Text style={{ color: c.foreground, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
            {mask(yen(Math.round(forecast)))}
          </Text>
          <Sub>確度は自分の入力値です。確定した売上ではありません。</Sub>
        </Card>

        <Input value={q} onChangeText={setQ} placeholder="会社名・氏名でしぼる" autoCapitalize="none" />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {(["all", ...SALES_STAGE_ORDER] as string[]).map((k) => {
            const label = k === "all" ? "すべて" : SALES_STAGE_LABEL[k].label;
            const on = stage === k;
            return (
              <Pressable
                key={k}
                onPress={() => setStage(k)}
                style={{
                  paddingHorizontal: 12,
                  minHeight: 34,
                  justifyContent: "center",
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: on ? c.primary : c.border,
                  backgroundColor: on ? c.accent : "transparent",
                }}
              >
                <Text style={{ color: on ? c.primary : c.mutedForeground, fontSize: 13 }}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {list.length === 0 ? (
          <Empty>この条件のリードはありません。</Empty>
        ) : (
          list.map((l) => {
            const st = SALES_STAGE_LABEL[l.salesStage || "approach"];
            const open = (l.nextActions ?? []).filter((a) => !a.done);
            const nearest = open.filter((a) => a.due).sort((a, b) => a.due.localeCompare(b.due))[0];
            const due = nearest ? classifyDue(nearest.due) : null;
            return (
              <Pressable key={l.id} onPress={() => router.push(`/lead/${l.id}`)}>
                <Card style={{ gap: 9 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: c.foreground, fontSize: 16, fontWeight: "600", flex: 1 }}
                    >
                      {mask(l.company) || "（会社名未入力）"}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={c.faint} />
                  </Row>
                  {l.name ? <Sub>{mask(l.name)}</Sub> : null}
                  <Row gap={8}>
                    {st ? <Badge color={st.color}>{st.label}</Badge> : null}
                    <Badge>{LEAD_STATUS_LABEL[l.status] ?? l.status}</Badge>
                    {l.dealValue ? <Badge color={c.info}>{mask(yen(l.dealValue))}</Badge> : null}
                    {due ? <Badge color={due.color}>{due.label}</Badge> : null}
                  </Row>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
