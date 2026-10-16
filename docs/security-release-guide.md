# テスト・デプロイ・元に戻す操作

## スマートフォンからの操作

このPRのworkflowがdefault branchへ入った後、GitHubの対象リポジトリ → **Actions** → **Security tests and release** → **Run workflow** を開きます。

- `test`：型検査、隔離攻撃シナリオ、ビルド、HTTP/ブラウザ試験を実行。結果と配布物をArtifactsへ保存。
- `deploy`：上の試験が全て通った成果物を専用サーバーへ配置。mainだけが対象。
- `rollback`：専用サーバーの直前リリースへコードを戻す。DBを自動で戻しません。

**Runable本番への接続は未設定です。** Runableの公開API・デプロイhook・ホストの操作権限は今回確認できていません。架空のデプロイURLは使っていません。Runableを継続する場合、このPRをRunableのGitHub連携へ取り込み、Runable側でプレビュー→公開の順で検証します。Actionsのdeployは下記の管理可能な専用サーバー向けです。初期設定前にdeployを実行してもRunableへ自動公開されません。

## 初回に管理者が設定する項目

1. production Environmentを作り、承認者・main制限を設定。
2. リポジトリ変数 `VITE_APPLICATION_ID`, `VITE_RUNABLE_AUTH_ISSUER`, `VITE_WEBSITE_URL` に正しい公開設定を登録。認証secretをVITE変数へ入れない。
3. 専用サーバーにBun 1.3.14、Node、curl、flock、GitHub Runnerを用意し、`cockpit-deploy` ラベルを付与。公開PRを実行するrunnerと共用しない。
4. 配置先 `/srv/consulting-cockpit/{releases,shared}` を作成。runtime設定は `shared/.env` へ0600で保管。DATABASE_URL/TOKEN、BETTER_AUTH_SECRET、OWNER_EMAILS、WEBSITE_URL、APPLICATION_ID、VITE_RUNABLE_AUTH_ISSUER等は既存環境と照合する。秘密はチャットへ送らない。
5. HTTPS終端/プロキシをローカル4200へ設定。Cookie・CSP・Origin・本番認証をstagingで確認。
6. 初回からrollback可能にするため、現行リリースを `releases/<基準SHA>` に保全し、`current` をそこへ向けておく。新コードの適用前データバックアップは別途必要。
7. `docs/security-review-2026-10-17.md` の未完了項目を確認し、本番リリース可否を判断。

デプロイはSHA別ディレクトリへ展開し、依存インストール後、currentリンクを切替、PM2を再起動。health応答のリリースSHAも確認します。失敗時には既存currentがあれば戻します。マイグレーション・DB削除は自動実行しません。ロールバックも同じ切替方式です。実ホストでの配置/復帰試験は未実施です。

## ローカル試験

```
bun install --frozen-lockfile
node packages/web/node_modules/@playwright/test/cli.js install --with-deps chromium
bun run verify:security
```

本番用環境変数は不要です。fixture-serverは一時DBとダミーsessionを作成して自分自身のローカルHTTPサーバーだけを試験します。本番に認証バイパスやfixtureルートは追加しません。
