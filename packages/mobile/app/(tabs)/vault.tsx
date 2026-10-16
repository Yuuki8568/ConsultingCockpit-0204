/** 保全タブ。同期状態・この端末の鍵・サインアウト。 */
import { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";
import { TopBar } from "@/components/topbar";
import { Body, Btn, Card, Divider, Label, Note, Row, Sub, Title } from "@/components/ui";
import { pendingCount } from "@/lib/vault-store";
import { KDF_ITERATIONS } from "@/lib/vault-crypto";

function confirmThen(title: string, message: string, onOk: () => void) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onOk();
    return;
  }
  Alert.alert(title, message, [
    { text: "やめる", style: "cancel" },
    { text: "実行する", style: "destructive", onPress: onOk },
  ]);
}

export default function VaultTab() {
  const c = useColors();
  const v = useVault();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void pendingCount().then(setPending);
  }, [v.state]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: c.background }}>
      <TopBar title="保全" />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 30 }}>
        <Card style={{ gap: 10 }}>
          <Title>同期</Title>
          <Row style={{ justifyContent: "space-between" }}>
            <Sub>状態</Sub>
            <Body>{v.offline ? "未同期（この端末に保留中）" : "同期済み"}</Body>
          </Row>
          <Row style={{ justifyContent: "space-between" }}>
            <Sub>送信待ち</Sub>
            <Body>{pending}件</Body>
          </Row>
          {v.error ? <Note tone="warn">{v.error}</Note> : null}
          <Btn label="今すぐ同期する" onPress={() => void v.refresh()} />
        </Card>

        <Card style={{ gap: 10 }}>
          <Title>この端末の鍵</Title>
          <Sub>
            金庫の鍵はこの端末の保管領域（iOSはキーチェーン／Androidはキーストア）にだけ置いてい
            ます。サーバーは暗号文と初期化ベクトルしか持っていないので、鍵がなければ誰も中身を読め
            ません。
          </Sub>
          <Row style={{ justifyContent: "space-between" }}>
            <Sub>鍵の預け入れ</Sub>
            <Body>{v.hasSavedKey ? "あり（端末の認証で開ける）" : "なし（毎回パスフレーズ）"}</Body>
          </Row>
          <Row style={{ justifyContent: "space-between" }}>
            <Sub>鍵の作り方</Sub>
            <Text style={{ color: c.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] }}>
              PBKDF2-SHA256 {KDF_ITERATIONS.toLocaleString("ja-JP")}回 / AES-GCM 256
            </Text>
          </Row>
          <Divider />
          <Label>端末を手放すとき</Label>
          <Btn
            label="この端末から鍵と控えを消す"
            variant="danger"
            onPress={() =>
              confirmThen(
                "この端末から鍵と控えを消します",
                "サーバー側のデータは消えません。次に開くときはパスフレーズの入力が必要になります。",
                () => void v.forgetThisDevice(),
              )
            }
          />
        </Card>

        <Card style={{ gap: 10 }}>
          <Title>この画面でできること・できないこと</Title>
          <Sub>
            外出先での確認と記録に絞っています。案件の新規作成、書類の生成と出力、雛形の編集、v3から
            の取り込みはブラウザ版で行ってください。
          </Sub>
        </Card>

        <View style={{ gap: 8 }}>
          <Btn label="いま閉じる（施錠）" onPress={v.lock} />
          <Btn
            label="サインアウト"
            variant="ghost"
            onPress={() =>
              confirmThen("サインアウトします", "この端末に預けた鍵は残ります。", () =>
                void v.signOut(),
              )
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
