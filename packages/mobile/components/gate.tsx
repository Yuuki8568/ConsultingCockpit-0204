/**
 * モバイルの入口。
 * サインイン → 金庫を開ける、が済むまで中身を出さない。
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useVault } from "@/hooks/use-vault";
import { Body, Btn, Card, Input, Label, Note, Row, Sub, Title } from "@/components/ui";

function Screen({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Mark() {
  return (
    <Row gap={10}>
      <Image
        source={require("../assets/adaptive-icon.png")}
        style={{ width: 34, height: 34 }}
        resizeMode="contain"
      />
      <View>
        <Body>Consulting Cockpit</Body>
        <Sub>外出先用（確認と記録）</Sub>
      </View>
    </Row>
  );
}

export function Gate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const v = useVault();
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  if (v.phase === "unlocked") return <>{children}</>;

  if (v.phase === "booting") {
    return (
      <Screen>
        <ActivityIndicator color={c.primary} />
      </Screen>
    );
  }

  if (v.phase === "signed-out") {
    return (
      <Screen>
        <Mark />
        <Card style={{ gap: 14 }}>
          <Title>サインイン</Title>
          <Sub>
            ブラウザ版と同じGoogleアカウントでサインインしてください。案件の中身は端末の中でだけ開き
            ます。サーバーには暗号文しか置かれません。
          </Sub>
          {v.error ? <Note tone="alert">{v.error}</Note> : null}
          <Btn
            label="Googleでサインイン"
            variant="primary"
            loading={busy}
            onPress={() => {
              setBusy(true);
              void v.signIn().finally(() => setBusy(false));
            }}
          />
        </Card>
      </Screen>
    );
  }

  if (v.phase === "denied") {
    return (
      <Screen>
        <Mark />
        <Card style={{ gap: 14 }}>
          <Title>本人専用です</Title>
          <Sub>
            サインインしたアカウントは、この操作卓に登録されていません。案件データは表示されず、書き
            込みもできません。ご自身のアカウントに切り替えてください。
          </Sub>
          <Btn label="サインアウトしてやり直す" variant="primary" onPress={() => void v.signOut()} />
        </Card>
      </Screen>
    );
  }

  if (v.phase === "no-vault") {
    return (
      <Screen>
        <Mark />
        <Card style={{ gap: 14 }}>
          <Title>金庫がまだありません</Title>
          <Sub>
            最初の金庫づくり（パスフレーズの設定）はブラウザ版で行ってください。ここは、できあがった
            金庫を外出先から開くための入口です。
          </Sub>
          <Btn label="もう一度確認する" onPress={() => void v.refresh()} />
          <Btn label="サインアウト" variant="ghost" onPress={() => void v.signOut()} />
        </Card>
      </Screen>
    );
  }

  const deriving = v.phase === "deriving";

  return (
    <Screen>
      <Mark />
      <Card style={{ gap: 14 }}>
        <Title>金庫を開ける</Title>
        {v.hasSavedKey ? (
          <>
            <Sub>この端末には鍵を預けてあります。端末の認証で開けます。</Sub>
            <Btn
              label="端末の認証で開ける"
              variant="primary"
              loading={busy}
              onPress={() => {
                setBusy(true);
                void v.unlockWithBiometrics().finally(() => setBusy(false));
              }}
            />
          </>
        ) : null}

        <View style={{ gap: 6 }}>
          <Label>パスフレーズ</Label>
          <Input
            value={pass}
            onChangeText={setPass}
            secureTextEntry
            autoCapitalize="none"
            placeholder="ブラウザ版と同じパスフレーズ"
            editable={!deriving}
          />
        </View>

        <Btn
          label={remember ? "この端末に鍵を預ける（推奨）" : "この端末に鍵を預けない"}
          variant="ghost"
          onPress={() => setRemember(!remember)}
        />

        {deriving || v.progressNote ? (
          <Row gap={10}>
            <ActivityIndicator color={c.primary} />
            <Sub>{v.progressNote ?? "鍵を作っています…"}</Sub>
          </Row>
        ) : null}

        {v.error ? <Note tone="alert">{v.error}</Note> : null}

        <Btn
          label="開ける"
          variant="primary"
          disabled={!pass || deriving}
          onPress={() => {
            void v.unlockWithPassphrase(pass, remember).then((ok) => {
              if (ok) setPass("");
            });
          }}
        />

        <Note>
          初回だけ鍵づくりに時間がかかります（携帯電話では十数秒）。鍵は端末の保管領域にだけ置き、
          サーバーには送りません。
        </Note>

        <Btn label="サインアウト" variant="ghost" onPress={() => void v.signOut()} />
      </Card>
    </Screen>
  );
}
