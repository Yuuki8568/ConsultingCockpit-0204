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
      <div className="panel-body space-y-3">
        <h3 className="font-semibold">パスキーで重要操作を保護</h3>
        <p className="text-xs text-paper-dim">
          初回はパスキー登録後、管理者が照合番号を別途確認します。承認後にこの端末を登録し、金庫の解錠後に書き込み署名を有効にしてください。
        </p>
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
