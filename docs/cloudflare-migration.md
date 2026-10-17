# Cloudflare移行版（2026-10-17）

## 状態

実装・ローカル検証段階。Cloudflare、Google OAuth、独立Turso DBの実アカウントには未接続。
公開・ドメイン購入・本番DB移行・録画移行は未実施。全件完了を意味しない。
Runableのmain、セキュリティ修正ブランチ、本番DBは変更しない。
このブランチをRunableの自動同期先mainへマージしない。独立デプロイ対象は `feat/cloudflare-independent`。

## 構成と境界

- 画面とAPI: Workers + Static Assets。`wrangler.jsonc`。Bun用server.tsはローカル試験用に残す。
- DB: 新規の独立Turso/libSQL。Workersではwebクライアントを使用し、接続はAsyncLocalStorageでリクエスト単位に分離・終了。同期/再鍵交換の既存トランザクションを保持。
- D1への変換は未実装。DB費用はWorkersとは別。RunableのDB URL・tokenを再利用しない。
- 認証: 自分で管理するGoogle OAuth + Better AuthのHttpOnly/Secure Cookie。Runable managedAuthと計測処理をWebの実行経路から除去。旧Bearerは拒否。
- Access: 全ページ/APIでAccess JWTの署名、issuer、audience、期限を検証。正式ホスト以外も拒否。Accessはアプリ内認証を代替しない。
- 本番のOWNER_EMAILS未設定は全員拒否。認証rateLimitをDB保存。
- 録画: まだ端末内IndexedDB。R2への移送・新URLへの録画import UIは未実装。
- Mobile/desktop: 今回はWeb移行版。旧Runable向けnativeクライアントを新APIへ向けない。
- 旧AAD互換等、既存security-reviewの未完了項目は引き続き残る。

## 必要なアカウント設定

1. Cloudflareアカウントを本人名義で用意し、多要素認証を設定。Workersの契約/使用量を確認。
2. 独自ドメインの希望名・初年度/更新予算を決め、空きと実価格を確認して取得。自動更新は別に選択。登録者情報/決済/規約への同意は本人が確認。ドメインの名前だけでは取得保証はできない。
3. Cloudflare Accessで検証/本番それぞれ別のアプリを用意し、許可メールを限定。GoogleなどのIdPでMFAを設定。issuerとaudienceを保管。
4. 自分のGoogle CloudでOAuth Webクライアントを作成。`https://<対象ホスト>/api/auth/callback/google` を登録。検証/本番を分離。client secretは画面コードに入れない。
5. 新しいTurso DBを検証/本番別々に作る。既存DBとは別ホスト・別token。新DBだけを指したローカル環境でschemaを適用（rate_limitを含む）。旧DBへ `db:push` を実行しない。
6. Cloudflareの検証/本番それぞれに `cloudflare/secrets.example.json` の設定項目をSecretsとして登録。例の値は使わない。
7. Workerのカスタムドメインを接続し、Accessの対象にする。workers.devとpreview URLは初期設定で無効。全機能はAccessとアプリ認証の両方を通す。

## GitHubからの公開

`cloudflare-staging` / `cloudflare-production` Environmentsを作成。productionにはレビュー制限を設定。
各Environmentに以下を設定（秘密の値はチャットへ送らない）:
- Secrets: CLOUDFLARE_API_TOKEN（必要な対象権限だけ）, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_RUNTIME_SECRETS（設定JSON）
- Variable: RUNABLE_DATABASE_HOST_SHA256（旧DATABASE_URLのhostを小文字化してSHA256。旧token不要）

設定検査は旧DBと同一hostを拒否。旧DBを複製した独立hostの中身の正しさまでは証明しない。
Actions → Cloudflare isolated release → ブランチ `feat/cloudflare-independent` → staging / production。
ローカル隔離テストとWorker dry-runの成功後、同じコミットと検査済み画面成果物を公開する。
このworkflowは新DBの初期化、DNS購入、Access/OAuth設定、データ移行を自動実行しない。
初回にはworkflowファイルをdefault branchに登録するなどGitHub側の設定が必要になる場合がある。アプリ本体をRunableのmainへ混ぜないこと。
公開後の実Google/Access認証・遠隔DBトランザクション・ユーザー操作は別途実機確認。workflow成功だけで移行完了と判定しない。

## 元データを残す移行手順

1. Runable版の全端末で同期を完了し、移行時点を決める。旧側で編集を続けると別々に分岐する。
2. 旧DBを整合したSQLiteスナップショットとして取得し、別の安全な保存先へ保全。取得権限が未確認なので未実施。
3. 各端末のIndexedDBと録画を別途保全。通常の暗号化JSONバックアップは録画を含まない。ブラウザー保存領域や旧ドメインを消さない。
4. 新しいDBで本人のGoogleログインだけを完了する。金庫作成・業務データ入力はまだしない。新ユーザーIDを確認し新DBスナップショットを取得する。
5. オフラインで次を実行する。両入力はread-only、出力は新規0600ファイル。既存出力/異なる所有者/既存業務データを拒否する。

```
python security-ops/prepare-migration.py OLD_SNAPSHOT.db NEW_EMPTY_SNAPSHOT.db MIGRATED_COPY.db --source-user OLD_UID --target-user NEW_UID
```

- vault/record/device/audit_event/login_eventを新ユーザーへ対応付け、暗号文・KDFは維持する。
- 旧OAuth credentialsと旧sessionは移さない。新側sessionも無効化し、新Google accountだけ保持。
- 旧端末は新側で失効状態。新URLで登録し直す。
- 元の2ファイルは上書きしない。生成物を新DBへ取り込む段階は別操作。クラウドへのimportは未実装。
- 出力には認証情報やメタデータが含まれる。GitHubや公開添付へ入れない。
- 新DBで件数、復号、監査連鎖、録画、書類、同期競合、鍵変更、復元を確認するまで切り替えない。
- 未同期データや再鍵交換途中の端末がある場合は作業を止め、原本を先に保全する。

## 戻し方

Runable版のコードとDBを削除しない。Cloudflare側を止めて旧URLを再利用できるよう保持する。
新側の編集が旧DBへ自動逆同期されることはない。切替後の編集を保全しない復帰はデータ損失になる。
WorkerのrollbackとDB復元は別。新旧フォーマットの互換性と復元時点を確認してから戻す。

## 検証結果

- 型検査: 成功。
- 既存セキュリティ単体: 14件成功、40 assertions。
- Worker入口の未設定/別host/Access欠落・偽装拒否: 2件成功。
- 元DBの不変・所有者照合・新規出力・旧session排除・端末失効: Python隔離試験成功。
- HttpOnly Cookie方式のHTTP/Chromiumブラックボックス: 9件成功。
- Workers配布物: Wrangler dry-run成功（本番へは送信していない）。
- 実Cloudflare、実Access、実Google OAuth、実Turso、D1、R2、実データ復旧は未検証。
