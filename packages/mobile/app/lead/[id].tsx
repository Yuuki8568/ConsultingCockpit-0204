/**
 * リードの詳細（外出先版）。
 * 段階を進める・金額と確度を直す・商談前メモを見返す・やることを足す。
 * リードの新規追加と案件化はブラウザ版で行う。
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
import { classifyDue, yen, type MobileLead, type NextAction } from "@/lib/vault-store";
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  SALES_STAGE_LABEL,
  SALES_STAGE_ORDER,
} from "@/constants/labels";

/** ブラウザ版 pages/leads/process.tsx と同じ8項目 */
const PREP_FIELDS: [string, string][] = [
  ["companyResearch", "下調べ"],
  ["assumedIssues", "課題の見立て"],
  ["keyPerson", "鍵になる人"],
  ["budget", "予算感"],
  ["competitors", "比較されそうな相手"],
  ["questions", "この場で必ず聞くこと"],
  ["goal", "この商談のゴール"],
  ["nextStepPlan", "次の一歩の案"],
];

export default function LeadDetail() {
  const c = useColors();
  const v = useVault();
  const mask = useMaskText();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<"overview" | "prep" | "actions">("overview");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [prepDraft, setPrepDraft] = useState<Record<string, string>>({});
  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const lead = useMemo(() => v.state?.leads.find((x) => x.id === id), [v.state, id]);

  if (!lead) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: c.background }}
      >
        <TopBar title="リード" back />
        <View style={{ padding: 14 }}>
          <Empty>このリードは見つかりませんでした。同期してから開き直してください。</Empty>
        </View>
      </SafeAreaView>
    );
  }

  // 早期returnの後は必ず存在する。クロージャ内でも型が消えないよう受け直す。
  const L: MobileLead = lead;
  const stage = L.salesStage || "approach";
  const st = SALES_STAGE_LABEL[stage];
  const flash = (msg: string) => {
    setSaved(msg + (v.offline ? "（この端末に保留中）" : ""));
    setTimeout(() => setSaved(null), 2500);
  };

  async function setStage(next: string) {
    if (next === stage) return;
    setSaving(true);
    try {
      await v.patchLead(L.id, (x) => {
        x.salesStage = next;
        if (next === "won" && x.status !== "converted") x.status = "meeting";
      });
      flash("段階を変えました");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(next: string) {
    if (next === L.status) return;
    setSaving(true);
    try {
      await v.patchLead(L.id, (x) => {
        x.status = next;
      });
      flash("状態を変えました");
    } finally {
      setSaving(false);
    }
  }

  async function saveNumbers() {
    setSaving(true);
    try {
      await v.patchLead(L.id, (x) => {
        if (draft.dealValue !== undefined) {
          x.dealValue = Number(draft.dealValue.replace(/[^\d]/g, "")) || 0;
        }
        if (draft.winProbability !== undefined) {
          const raw = draft.winProbability.replace(/[^\d]/g, "");
          x.winProbability = raw === "" ? null : Math.min(100, Number(raw));
        }
      });
      setDraft({});
      flash("保存しました");
    } finally {
      setSaving(false);
    }
  }

  async function savePrep() {
    setSaving(true);
    try {
      await v.patchLead(L.id, (x) => {
        x.prepSheet = x.prepSheet ?? {};
        for (const [k, val] of Object.entries(prepDraft)) x.prepSheet[k] = val;
      });
      setPrepDraft({});
      flash("保存しました");
    } finally {
      setSaving(false);
    }
  }

  async function addAction() {
    if (!newText.trim()) return;
    setSaving(true);
    try {
      await v.patchLead(L.id, (x) => {
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
    await v.patchLead(L.id, (x) => {
      const t = (x.nextActions ?? []).find((y) => y.id === a.id);
      if (t) {
        t.done = !t.done;
        t.doneAt = t.done ? new Date().toISOString() : undefined;
      }
    });
  }

  const numbersDirty = Object.keys(draft).length > 0;
  const prepDirty = Object.keys(prepDraft).length > 0;
  const dealVal = draft.dealValue ?? (L.dealValue ? String(L.dealValue) : "");
  const winVal =
    draft.winProbability ??
    (L.winProbability === null || L.winProbability === undefined
      ? ""
      : String(L.winProbability));
  const weighted = (Number(L.dealValue) || 0) * ((Number(L.winProbability) || 0) / 100);

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <TopBar title={mask(L.company) || "リード"} back />
      <Row gap={0} style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
        {(
          [
            ["overview", "要点"],
            ["prep", "商談前メモ"],
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
            <Text
              style={{ color: tab === k ? c.foreground : c.mutedForeground, fontSize: 14 }}
            >
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
          {saved ? <Note tone="ok">{saved}</Note> : null}

          {tab === "overview" ? (
            <>
              <Card style={{ gap: 10 }}>
                <Title>{mask(L.company) || "（会社名未入力）"}</Title>
                {L.name ? <Sub>{mask(L.name)}</Sub> : null}
                <Row gap={8}>
                  {st ? <Badge color={st.color}>{st.label}</Badge> : null}
                  <Badge>{LEAD_STATUS_LABEL[L.status] ?? L.status}</Badge>
                </Row>
                {typeof L.channel === "string" && L.channel ? (
                  <Sub>きっかけ {String(L.channel)}</Sub>
                ) : null}
                <Sub>登録 {String(L.createdAt).slice(0, 10)}</Sub>
              </Card>

              <Card style={{ gap: 8 }}>
                <Label>いまの段階</Label>
                <View style={{ gap: 6 }}>
                  {SALES_STAGE_ORDER.map((k) => {
                    const on = k === stage;
                    const item = SALES_STAGE_LABEL[k];
                    return (
                      <Pressable
                        key={k}
                        onPress={() => void setStage(k)}
                        style={{
                          minHeight: 44,
                          paddingHorizontal: 12,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          borderWidth: 1,
                          borderRadius: 5,
                          borderColor: on ? item.color : c.border,
                          backgroundColor: on ? item.color + "1f" : "transparent",
                        }}
                      >
                        <Ionicons
                          name={on ? "radio-button-on" : "radio-button-off"}
                          size={18}
                          color={on ? item.color : c.faint}
                        />
                        <Text
                          style={{
                            color: on ? c.foreground : c.mutedForeground,
                            fontSize: 14,
                            fontWeight: on ? "600" : "400",
                          }}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>

              <Card style={{ gap: 8 }}>
                <Label>連絡の状態</Label>
                <Row gap={6} style={{ flexWrap: "wrap" }}>
                  {LEAD_STATUS_ORDER.map((k) => {
                    const on = k === L.status;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => void setStatus(k)}
                        style={{
                          minHeight: 38,
                          paddingHorizontal: 12,
                          justifyContent: "center",
                          borderWidth: 1,
                          borderRadius: 4,
                          borderColor: on ? c.primary : c.border,
                          backgroundColor: on ? c.accent : "transparent",
                        }}
                      >
                        <Text
                          style={{ color: on ? c.primary : c.mutedForeground, fontSize: 13 }}
                        >
                          {LEAD_STATUS_LABEL[k]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Row>
              </Card>

              <Card style={{ gap: 12 }}>
                <Label>金額と確度</Label>
                <View style={{ gap: 6 }}>
                  <Label>見込み金額（円・税抜）</Label>
                  <Input
                    value={dealVal}
                    onChangeText={(t) => setDraft({ ...draft, dealValue: t })}
                    keyboardType="number-pad"
                    placeholder="例：150000"
                  />
                </View>
                <View style={{ gap: 6 }}>
                  <Label>確度（％・自分の見立て）</Label>
                  <Input
                    value={winVal}
                    onChangeText={(t) => setDraft({ ...draft, winProbability: t })}
                    keyboardType="number-pad"
                    placeholder="例：40"
                  />
                  <Row gap={6}>
                    {[10, 30, 50, 70, 90].map((n) => (
                      <Btn
                        key={n}
                        label={`${n}%`}
                        style={{ flex: 1, paddingHorizontal: 4 }}
                        onPress={() => setDraft({ ...draft, winProbability: String(n) })}
                      />
                    ))}
                  </Row>
                </View>
                <Divider />
                <Row style={{ justifyContent: "space-between" }}>
                  <Sub>金額 × 確度</Sub>
                  <Body>{mask(yen(Math.round(weighted)))}</Body>
                </Row>
                <Btn
                  label={numbersDirty ? "保存する" : "変更はありません"}
                  variant="primary"
                  disabled={!numbersDirty}
                  loading={saving}
                  onPress={() => void saveNumbers()}
                />
              </Card>

              <Note>
                確度は自分の見立てです。確定した売上ではありません。見積の作成と案件化はブラウザ版で
                行ってください。
              </Note>
            </>
          ) : null}

          {tab === "prep" ? (
            <>
              <Card style={{ gap: 12 }}>
                <Title>商談前メモ</Title>
                <Sub>移動中に読み返す用。空欄のままでも構いません。</Sub>
                {PREP_FIELDS.map(([k, label]) => (
                  <View key={k} style={{ gap: 6 }}>
                    <Label>{label}</Label>
                    <Input
                      value={prepDraft[k] ?? String(L.prepSheet?.[k] ?? "")}
                      onChangeText={(t) => setPrepDraft({ ...prepDraft, [k]: t })}
                      multiline
                    />
                  </View>
                ))}
                <Btn
                  label={prepDirty ? "保存する" : "変更はありません"}
                  variant="primary"
                  disabled={!prepDirty}
                  loading={saving}
                  onPress={() => void savePrep()}
                />
              </Card>
              <Note>
                推測は推測として書く。確かめていないことを事実のように書くと、商談で足をすくわれます。
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
                    placeholder="例：提案書のたたき台を送る"
                  />
                </View>
                <View style={{ gap: 6 }}>
                  <Label>期限（YYYY-MM-DD）</Label>
                  <Input
                    value={newDue}
                    onChangeText={setNewDue}
                    keyboardType="numbers-and-punctuation"
                  />
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
                          new Date(Date.now() + Number(d) * 86400000)
                            .toISOString()
                            .slice(0, 10),
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

              {(L.nextActions ?? []).length === 0 ? (
                <Empty>まだありません。</Empty>
              ) : (
                (L.nextActions ?? []).map((a) => {
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
                          {a.done ? (
                            <Ionicons name="checkmark" size={16} color={c.success} />
                          ) : null}
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
                              <Text style={{ color: c.faint, fontSize: 11 }}>
                                {a.due || "期限なし"}
                              </Text>
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
