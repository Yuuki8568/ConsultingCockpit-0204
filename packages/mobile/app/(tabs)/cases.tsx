/** 案件一覧。名前・進み具合・直近のやること件数だけを出す。 */
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";
import { TopBar, useMaskText } from "@/components/topbar";
import { Badge, Card, Empty, Input, Row, Sub } from "@/components/ui";
import { caseProgress, classifyDue, yen } from "@/lib/vault-store";
import { STAGE_COLOR, STAGE_LABEL } from "@/constants/labels";

export default function Cases() {
  const c = useColors();
  const v = useVault();
  const mask = useMaskText();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const cases = v.state?.cases ?? [];
    const key = q.trim().toLowerCase();
    if (!key) return cases;
    return cases.filter((x) =>
      [x.settings?.companyName, x.settings?.industry, x.name]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(key)),
    );
  }, [v.state, q]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar title={`案件 ${v.state?.cases.length ?? 0}件`} />
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
        <Input value={q} onChangeText={setQ} placeholder="企業名・業種でしぼる" autoCapitalize="none" />

        {list.length === 0 ? (
          <Empty>
            案件がありません。{"\n"}新しい案件づくりはブラウザ版で行ってください。
          </Empty>
        ) : (
          list.map((cs) => {
            const p = caseProgress(cs);
            const open = (cs.nextActions ?? []).filter((a) => !a.done);
            const nearest = open
              .filter((a) => a.due)
              .sort((a, b) => a.due.localeCompare(b.due))[0];
            const due = nearest ? classifyDue(nearest.due) : null;
            const stage = String(cs.gartner?.stage ?? cs.maturity?.currentStage ?? "");
            const fee = cs.support?.contract?.monthlyFee;
            return (
              <Pressable key={cs.id} onPress={() => router.push(`/case/${cs.id}`)}>
                <Card style={{ gap: 10 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: c.foreground, fontSize: 16, fontWeight: "600", flex: 1 }}
                    >
                      {mask(cs.settings?.companyName) || "（企業名未入力）"}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={c.faint} />
                  </Row>

                  <Row gap={8}>
                    {cs.settings?.industry ? <Badge>{cs.settings.industry}</Badge> : null}
                    {stage && STAGE_LABEL[stage] ? (
                      <Badge color={STAGE_COLOR[stage]}>{STAGE_LABEL[stage].split(" ")[0]}</Badge>
                    ) : null}
                    {fee ? <Badge color={c.success}>{mask(yen(fee))}/月</Badge> : null}
                  </Row>

                  <View style={{ gap: 5 }}>
                    <Row style={{ justifyContent: "space-between" }}>
                      <Sub>進み具合</Sub>
                      <Text style={{ color: c.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] }}>
                        {p.done} / {p.total}
                      </Text>
                    </Row>
                    <View style={{ height: 4, backgroundColor: c.secondary, borderRadius: 2 }}>
                      <View
                        style={{
                          height: 4,
                          width: `${(p.done / p.total) * 100}%`,
                          backgroundColor: c.primary,
                          borderRadius: 2,
                        }}
                      />
                    </View>
                  </View>

                  <Row gap={8}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={c.mutedForeground} />
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                      やること {open.length}件
                    </Text>
                    {due ? <Badge color={due.color}>直近 {due.label}</Badge> : null}
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
