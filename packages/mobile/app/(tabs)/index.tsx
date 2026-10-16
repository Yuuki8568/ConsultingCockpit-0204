/** 次にやること Hub。外出先で最初に開く画面。 */
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";
import { TopBar, useMaskText } from "@/components/topbar";
import { Badge, Card, Empty, Note, Row, Sub } from "@/components/ui";
import { classifyDue, type HubAction } from "@/lib/vault-store";

const FILTERS = [
  ["overdue", "遅れ"],
  ["today", "今日"],
  ["week", "7日"],
  ["all", "すべて"],
] as const;

export default function Hub() {
  const c = useColors();
  const v = useVault();
  const mask = useMaskText();
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("week");
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const shown = useMemo(() => {
    const open = v.actions.filter((a) => !a.done);
    if (filter === "all") return open;
    return open.filter((a) => {
      if (!a.due) return false; // 期限なしは「すべて」でだけ出す
      const diff = Math.floor(
        (new Date(a.due).getTime() - new Date(today).getTime()) / 86400000,
      );
      if (filter === "overdue") return diff < 0;
      if (filter === "today") return diff <= 0;
      return diff <= 7;
    });
  }, [v.actions, filter, today]);

  const counts = useMemo(() => {
    const open = v.actions.filter((a) => !a.done);
    const n = (f: (d: number) => boolean) =>
      open.filter((a) => {
        if (!a.due) return false;
        const d = Math.floor((new Date(a.due).getTime() - new Date(today).getTime()) / 86400000);
        return f(d);
      }).length;
    return { overdue: n((d) => d < 0), today: n((d) => d === 0), week: n((d) => d >= 0 && d <= 7) };
  }, [v.actions, today]);

  async function toggle(a: HubAction) {
    if (a.sourceType === "case_auto") return;
    setBusy(true);
    try {
      if (a.sourceType === "lead") {
        await v.patchLead(a.sourceId, (l) => {
          const t = (l.nextActions ?? []).find((x) => x.id === a.id);
          if (t) {
            t.done = !t.done;
            t.doneAt = t.done ? new Date().toISOString() : undefined;
          }
        });
      } else {
        await v.patchCase(a.sourceId, (cs) => {
          const t = (cs.nextActions ?? []).find((x) => x.id === a.id);
          if (t) {
            t.done = !t.done;
            t.doneAt = t.done ? new Date().toISOString() : undefined;
          }
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar title="次にやること" />
      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 30 }}
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
        <Row gap={8}>
          <Card style={{ flex: 1, paddingVertical: 10 }}>
            <Sub>遅れ</Sub>
            <Text style={{ color: counts.overdue ? c.destructive : c.foreground, fontSize: 21, fontWeight: "700" }}>
              {counts.overdue}
            </Text>
          </Card>
          <Card style={{ flex: 1, paddingVertical: 10 }}>
            <Sub>今日</Sub>
            <Text style={{ color: counts.today ? c.warning : c.foreground, fontSize: 21, fontWeight: "700" }}>
              {counts.today}
            </Text>
          </Card>
          <Card style={{ flex: 1, paddingVertical: 10 }}>
            <Sub>7日以内</Sub>
            <Text style={{ color: c.foreground, fontSize: 21, fontWeight: "700" }}>{counts.week}</Text>
          </Card>
        </Row>

        {v.offline ? (
          <Note tone="warn">
            通信できていません。記録はこの端末に残り、つながったときに送られます。
          </Note>
        ) : null}

        <Row gap={6}>
          {FILTERS.map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setFilter(k)}
              style={{
                paddingHorizontal: 12,
                minHeight: 34,
                justifyContent: "center",
                borderRadius: 4,
                borderWidth: 1,
                borderColor: filter === k ? c.primary : c.border,
                backgroundColor: filter === k ? c.accent : "transparent",
              }}
            >
              <Text style={{ color: filter === k ? c.primary : c.mutedForeground, fontSize: 13 }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </Row>

        {shown.length === 0 ? (
          <Empty>この条件のやることはありません。{"\n"}案件・リードのタブから登録できます。</Empty>
        ) : (
          shown.map((a) => {
            const due = classifyDue(a.due);
            return (
              <Card key={a.sourceType + a.id} style={{ gap: 8 }}>
                <Row gap={10} style={{ alignItems: "flex-start" }}>
                  <Pressable
                    onPress={() => void toggle(a)}
                    hitSlop={10}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: a.sourceType === "case_auto" ? c.border : c.primary,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {a.sourceType === "case_auto" ? (
                      <Ionicons name="alarm-outline" size={15} color={c.faint} />
                    ) : null}
                  </Pressable>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={{ color: c.foreground, fontSize: 15, lineHeight: 22 }}>{a.text}</Text>
                    <Row gap={8}>
                      <Badge color={due.color}>{due.label}</Badge>
                      <Text style={{ color: c.faint, fontSize: 11, fontVariant: ["tabular-nums"] }}>
                        {a.due || "期限なし"}
                      </Text>
                    </Row>
                    <Pressable
                      onPress={() =>
                        router.push(
                          a.sourceType === "lead" ? `/lead/${a.sourceId}` : `/case/${a.sourceId}`,
                        )
                      }
                    >
                      <Row gap={4}>
                        <Ionicons
                          name={a.sourceType === "lead" ? "person-outline" : "briefcase-outline"}
                          size={13}
                          color={c.mutedForeground}
                        />
                        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                          {mask(a.sourceName) || "（名称未設定）"}
                        </Text>
                        <Ionicons name="chevron-forward" size={13} color={c.faint} />
                      </Row>
                    </Pressable>
                  </View>
                </Row>
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
