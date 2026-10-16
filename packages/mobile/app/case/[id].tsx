/**
 * 案件の詳細（外出先版）。
 * 見るのは要点だけ、書くのは商談メモと次にやること。
 * 設計・書類生成はブラウザ版で行う。
 */
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";
import { TopBar, useMaskText } from "@/components/topbar";
import {
  Badge,
  Body,
  Btn,
  Card,
  Divider,
  Empty,
  Input,
  Label,
  Note,
  Row,
  Sub,
  Title,
} from "@/components/ui";
import {
  caseProgress,
  classifyDue,
  yen,
  type MobileCase,
  type NextAction,
} from "@/lib/vault-store";
import { STAGE_COLOR, STAGE_LABEL } from "@/constants/labels";

const MEMO_FIELDS: [string, string, boolean][] = [
  ["attendees", "出席者", false],
  ["decisionMaker", "最終的に決める人", false],
  ["summary", "話したこと", true],
  ["decisions", "決まったこと", true],
  ["budget", "予算感", true],
];

export default function CaseDetail() {
  const c = useColors();
  const v = useVault();
  const mask = useMaskText();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<"overview" | "memo" | "actions">("overview");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const cs = useMemo(() => v.state?.cases.find((x) => x.id === id), [v.state, id]);

  if (!cs) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
        <TopBar title="案件" back />
        <View style={{ padding: 14 }}>
          <Empty>この案件は見つかりませんでした。同期してから開き直してください。</Empty>
        </View>
      </SafeAreaView>
    );
  }

  // 早期returnの後は必ず存在する。クロージャ内でも型が消えないよう受け直す。
  const C: MobileCase = cs;
  const p = caseProgress(C);
  const stage = String(C.gartner?.stage ?? C.maturity?.currentStage ?? "");
  const memoVal = (k: string) => draft[k] ?? String(C.memo?.[k] ?? "");

  async function saveMemo() {
    setSaving(true);
    try {
      await v.patchCase(C.id, (x) => {
        for (const [k, val] of Object.entries(draft)) x.memo[k] = val;
      });
      setDraft({});
      setSaved("保存しました" + (v.offline ? "（この端末に保留中）" : ""));
      setTimeout(() => setSaved(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function addAction() {
    if (!newText.trim()) return;
    setSaving(true);
    try {
      await v.patchCase(C.id, (x) => {
        x.nextActions = x.nextActions ?? [];
        x.nextActions.push({
          id: "a_" + Date.now().toString(36),
          text: newText.trim(),
          due: newDue,
          done: false,
        });
      });
      setNewText("");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAction(a: NextAction) {
    await v.patchCase(C.id, (x) => {
      const t = (x.nextActions ?? []).find((y) => y.id === a.id);
      if (t) {
        t.done = !t.done;
        t.doneAt = t.done ? new Date().toISOString() : undefined;
      }
    });
  }

  const dirty = Object.keys(draft).length > 0;
  const rec = C.pricing?.result?.recommended;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar title={mask(C.settings?.companyName) || "案件"} back />
      <Row gap={0} style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
        {(
          [
            ["overview", "要点"],
            ["memo", "商談メモ"],
            ["actions", "やること"],
          ] as const
        ).map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              borderBottomWidth: 2,
              borderBottomColor: tab === k ? c.primary : "transparent",
            }}
          >
            <Text style={{ color: tab === k ? c.foreground : c.mutedForeground, fontSize: 14 }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </Row>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {tab === "overview" ? (
            <>
              <Card style={{ gap: 10 }}>
                <Title>{mask(C.settings?.companyName) || "（企業名未入力）"}</Title>
                <Row gap={8}>
                  {C.settings?.industry ? <Badge>{C.settings.industry}</Badge> : null}
                  {stage && STAGE_LABEL[stage] ? (
                    <Badge color={STAGE_COLOR[stage]}>{STAGE_LABEL[stage]}</Badge>
                  ) : null}
                </Row>
                {C.settings?.meetingDate ? <Sub>商談日 {C.settings.meetingDate}</Sub> : null}
                <Divider />
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
              </Card>

              <Card style={{ gap: 8 }}>
                <Label>お金まわり</Label>
                <Row style={{ justifyContent: "space-between" }}>
                  <Sub>単価の目安</Sub>
                  <Body>{rec ? mask(yen(rec)) : "未算出"}</Body>
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <Sub>継続サポート</Sub>
                  <Body>
                    {C.support?.contract?.monthlyFee
                      ? `${mask(yen(C.support.contract.monthlyFee))}／月`
                      : "未設定"}
                  </Body>
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <Sub>入金</Sub>
                  <Body>
                    {C.invoice?.paidFlag
                      ? "入金済"
                      : C.invoice?.dueDate
                        ? `期日 ${C.invoice.dueDate}`
                        : "未設定"}
                  </Body>
                </Row>
                {C.execution?.contractEnd ? (
                  <Row style={{ justifyContent: "space-between" }}>
                    <Sub>契約終了</Sub>
                    <Body>{C.execution.contractEnd}</Body>
                  </Row>
                ) : null}
              </Card>

              {C.settings?.keywords ? (
                <Card style={{ gap: 6 }}>
                  <Label>相手の言葉（キーワード）</Label>
                  <Body>{mask(C.settings.keywords)}</Body>
                </Card>
              ) : null}

              <Note>
                ヒアリング設計・業務フロー分析・書類の生成はブラウザ版で行ってください。ここでは記録
                と確認に絞っています。
              </Note>
            </>
          ) : null}

          {tab === "memo" ? (
            <>
              <Card style={{ gap: 12 }}>
                <Title>商談メモ</Title>
                <Sub>帰り道に短く。記憶が新しいうちが一番正確です。</Sub>
                {MEMO_FIELDS.map(([k, label, multi]) => (
                  <View key={k} style={{ gap: 6 }}>
                    <Label>{label}</Label>
                    <Input
                      value={memoVal(k)}
                      onChangeText={(t) => setDraft({ ...draft, [k]: t })}
                      multiline={multi}
                    />
                  </View>
                ))}
                {saved ? <Note tone="ok">{saved}</Note> : null}
                <Btn
                  label={dirty ? "保存する" : "変更はありません"}
                  variant="primary"
                  disabled={!dirty}
                  loading={saving}
                  onPress={() => void saveMemo()}
                />
              </Card>
              <Note>
                決まっていないことは書かない。曖昧なまま残すと後で揉めます（ブラウザ版と同じ方針）。
              </Note>
            </>
          ) : null}

          {tab === "actions" ? (
            <>
              <Card style={{ gap: 10 }}>
                <Title>やることを足す</Title>
                <View style={{ gap: 6 }}>
                  <Label>内容</Label>
                  <Input
                    value={newText}
                    onChangeText={setNewText}
                    placeholder="例：見積書を送る"
                  />
                </View>
                <View style={{ gap: 6 }}>
                  <Label>期限（YYYY-MM-DD）</Label>
                  <Input value={newDue} onChangeText={setNewDue} keyboardType="numbers-and-punctuation" />
                </View>
                <Row gap={6}>
                  {[
                    ["今日", 0],
                    ["明日", 1],
                    ["3日後", 3],
                    ["1週間後", 7],
                  ].map(([label, d]) => (
                    <Btn
                      key={String(label)}
                      label={String(label)}
                      style={{ flex: 1, paddingHorizontal: 4 }}
                      onPress={() =>
                        setNewDue(
                          new Date(Date.now() + Number(d) * 86400000).toISOString().slice(0, 10),
                        )
                      }
                    />
                  ))}
                </Row>
                <Btn
                  label="追加する"
                  variant="primary"
                  disabled={!newText.trim()}
                  loading={saving}
                  onPress={() => void addAction()}
                />
              </Card>

              {(C.nextActions ?? []).length === 0 ? (
                <Empty>まだありません。</Empty>
              ) : (
                (C.nextActions ?? []).map((a) => {
                  const due = classifyDue(a.due);
                  return (
                    <Card key={a.id}>
                      <Row gap={10} style={{ alignItems: "flex-start" }}>
                        <Pressable
                          onPress={() => void toggleAction(a)}
                          hitSlop={10}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: a.done ? c.success : c.primary,
                            backgroundColor: a.done ? "rgba(74,124,89,0.18)" : "transparent",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {a.done ? <Ionicons name="checkmark" size={16} color={c.success} /> : null}
                        </Pressable>
                        <View style={{ flex: 1, gap: 6 }}>
                          <Text
                            style={{
                              color: a.done ? c.faint : c.foreground,
                              fontSize: 15,
                              lineHeight: 22,
                              textDecorationLine: a.done ? "line-through" : "none",
                            }}
                          >
                            {a.text}
                          </Text>
                          {a.done ? (
                            <Badge color={c.success}>完了</Badge>
                          ) : (
                            <Row gap={8}>
                              <Badge color={due.color}>{due.label}</Badge>
                              <Text style={{ color: c.faint, fontSize: 11 }}>{a.due || "期限なし"}</Text>
                            </Row>
                          )}
                        </View>
                      </Row>
                    </Card>
                  );
                })
              )}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
