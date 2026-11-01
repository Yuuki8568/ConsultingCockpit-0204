import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { client } from "../lib/api";
import { authorize } from "../lib/step-up";
import { deviceIdFor, vaultStore } from "../lib/store/vault-store";
import { deviceLabel, platformGuess, shortUA } from "../lib/security";
export function PasskeyPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel my-4">
      <div className="panel-body flex flex-col items-stretch gap-3 sm:items-start">
        <h3 className="font-semibold">パスキーで重要操作を保護</h3>
        <p className="text-xs text-paper-dim">
          初回はパスキー登録後、管理者が照合番号を別途確認します。承認後にこの端末を登録し、金庫の解錠後に書き込み署名を有効にしてください。
        </p>
        <details className="w-full text-sm text-paper-dim">
          <summary className="cursor-pointer py-3">MacとAndroidで使う手順</summary>
          <ol className="list-decimal space-y-2 pl-5">
            <li>AndroidのChromeで同じCockpitアカウントにログインします。</li>
            <li>使える承認済みパスキーがある場合は「本人確認してこの端末を登録」を押します。見つからない場合は、この端末でパスキーを追加登録し、表示された照合番号を管理者へ伝えてください。</li>
            <li>承認後に端末登録し、再読み込みして同じ金庫のパスフレーズで解錠します。</li>
            <li>既存の書き込み署名は金庫の解錠後に利用できます。初回設定が必要と表示された場合だけ、下の有効化ボタンを使ってください。</li>
          </ol>
          <p className="mt-3">Googleパスワードマネージャーに保存したパスキーは、対応するMac版ChromeとAndroidで同期して利用できます。Appleのパスワードに保存したものがAndroidにも自動で届くとは限りません。</p>
          <p className="mt-2">端末を替える前に「同期済み」を確認してください。録音・動画原本は自動同期されません。Macの精密文字起こし補助ツールとフォルダーへの自動バックアップはMac側で利用してください。</p>
        </details>
        <button
          disabled={busy}
          className="btn btn-primary btn-sm"
          onClick={() =>
            void run(async () => {
              const c = await client.passkeys.registrationOptions();
              const response = await startRegistration({ optionsJSON: c.options });
              const r = await client.passkeys.register({ id: c.id, response });
              setMessage(`今回登録した照合番号：${r.fingerprint}（管理者による承認待ち）`);
            })
          }
        >
          パスキーを登録
        </button>
        <button
          disabled={busy}
          className="btn btn-sm"
          onClick={() =>
            void run(async () => {
              const input = {
                id: deviceIdFor(),
                label: deviceLabel(),
                platform: platformGuess(),
                userAgent: shortUA(),
              };
              await client.devices.register({
                ...input,
                authorization: await authorize("device:register", input),
              });
              setMessage("端末登録が完了しました。ページを再読み込みしてください。");
            })
          }
        >
          本人確認してこの端末を登録
        </button>
        {vaultStore.isUnlocked() && (
          <button
            disabled={busy}
            className="btn btn-primary btn-sm"
            onClick={() =>
              void run(async () => {
                await vaultStore.enableWriteSigning();
                setMessage("書き込み署名を有効にしました。");
              })
            }
          >
            書き込み署名を有効にする
          </button>
        )}
        {busy && <p role="status">本人確認を処理しています…</p>}
        {message && (
          <p role="status" className="break-all text-xs">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
