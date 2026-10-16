# 新規依頼（2026-10-10・11件目）セキュリティ再検証・修正・受入試験 — 実装・検証完了（未デプロイ）

## 依頼
- 添付の診断プロンプト（SEC-01〜11）を現行コードで再検証し、必要な修正を実装、ダミーデータで攻撃シナリオ試験と回帰試験まで行う

## 棚卸しの結論（現行コードとの照合）
- SEC-01 施錠後の書類: 再現。vaultStore.lock() は鍵と state を消すが doc-viewer-store を消さない。DocViewerModal はルートにマウントされ施錠後も開きうる → 修正する
- SEC-02 鍵変更と録画: 再現。reEncryptAll は records のみで media チャンクを更新しない。ローカル先行切替で通信失敗時に不整合 → 修正する（prepare→server→commit 化＋media 二相切替）
- SEC-03 試行制限: サーバー側は実装済み（unlockParams 20回/15分→5分停止、loginEvent 記録）。ブラウザ側 5回/5分 は補助。残余リスク（材料取得済みのオフライン総当たりは防げない）を画面説明に明記
- SEC-04 CSP: unsafe-inline/unsafe-eval/ws: を本番で除去可能（枠対策スクリプトを外部化、ビルド時に CSP 差し替え）。onedollarstats は参照なし・除去。api.runable.com は managed-auth の issuer なので残す
- SEC-05 localStorage トークン: managed-auth 基盤の仕様。変更不可部分は残存リスクとして明記。サインアウト後の旧トークン無効を試験で確認
- SEC-06 平文バックアップ: 修正する。金庫鍵で暗号化した控えを標準にし、平文は明示選択＋警告で残す。録画は含まないことを明示
- SEC-07 frame-ancestors: HTTP ヘッダーは __server.ts（編集禁止）が静的配信するため基盤制約で未対応。JS 枠対策を維持し、基盤への依頼事項として報告
- SEC-08 CSV: 再現（=1+1 がそのまま出る）。文字列セルの数式開始文字を無害化。XLSX も同様に処理
- SEC-09 平文ハッシュ: 再現（cyrb53 を idb に保存。サーバーには送っていない）。HMAC-SHA256（パスフレーズ派生・メモリのみの鍵）へ変更
- SEC-10 AAD なし: 再現。レコードは cc4r|type|id、録画は cc4m|mediaId|index を AAD に。旧形式はフォールバックで読み、次回保存時に新形式へ
- SEC-11 CORS: __core/app.ts は編集禁止で反射自体は残るが、api/index.ts（編集可）にオリジン検査を /api/auth/* へ追加し保護手続きを全て断る。業務RPCは既に 403 を確認済み

## 実装メモ（完了したものから順に追記）
## 実装メモ
- SEC-01: doc-viewer-store に discard()（保存せず本文・参照・タイマー破棄）。vault-store.lock() で discard()。use-vault の doLock は docViewer.close()→setPhase→flushPending() 完了後に鍵破棄（未保存編集は保存されてから施錠）。flushPending() 新設。doc-viewer-modal に vaultStore.isUnlocked() ガード
- SEC-02: vault-store に prepareReencrypt（録画は mediaId+"__rekey__" 仮チャンクに新鍵で封じ直し）/commitReencrypt/abortReencrypt/settleMediaRekey（解錠時の結末付け）/adoptMediaTemps。旧 reEncryptAll 削除。settings.tsx の RekeyModal を3段階（prepare→client.vault.rekey→commit、失敗時 abort）に。idb.ts に putMediaChunks/listMediaIds
- SEC-09: vault-crypto に deriveVaultKeys（PBKDF2 で AES-GCM鍵＋HMAC-SHA256鍵の2本導出、extractable:false）と hmacHex。cyrb53 廃止、指紋は全て HMAC 化。サーバーには hash を送っていない
- SEC-10: seal/open/sealBytes/openBytes に AAD 引数（open 側は legacyOk で旧形式フォールバック）。AAD: レコード cc4r|type|id、録画 cc4m|mediaId|index、競合コピーは元id/元typeのAAD、控えは cc4-backup。重要: AesGcmParams に additionalData: undefined を明示すると WebIDL が "Not a BufferSource" で落ちる → gcmParams() で aad がある時だけキーを載せる（E2E 初回で金庫作成が失敗して発覚・修正済み）
- SEC-08: xlsx.ts に sanitizeSheetCell（先頭が = + - @・タブ・改行の文字列セルに ' 前置。数値はそのまま）。CSV/XLSX 両方に適用
- SEC-06: lib/export/backup.ts 新規（buildEncryptedBackup/isEncryptedBackup/decryptBackup）。settings DataTab は「暗号化して書き出す（推奨）」が主、平文は ConfirmButton。取り込みで暗号化控えを検出して復号→確認画面。desktop-backup.tsx も暗号化に切替
- SEC-04: public/frameguard.js 新規（インラインの枠対策を外部化）。vite.config.ts に strictCspPlugin（build 時のみ本番CSP: script-src 'self' 等、ws:/wss:/unsafe-inline/unsafe-eval/onedollarstats 除去）。開発時は緩いまま
- SEC-11: api/index.ts に /api/auth/* への origin 検査ミドルウェア（isAllowedOrigin で 403）
- SEC-03: settings「どう守られているか」にサーバー側制限（15分20回→5分停止）と「材料取得済みのオフライン総当たりは防げない。パスフレーズが最後の防御」を明記
- 対応せず（基盤制約）: SEC-05（managed-auth が localStorage トークン保持。サインアウト後の旧トークン無効は試験で確認済み）、SEC-07（HTTP ヘッダーは __server.ts 編集禁止。frameguard.js 維持＋基盤依頼事項として報告）

## 検証（2026-10-10）
- 新規 E2E /home/user/verify-security.py 21/21 PASS: ①書類を開いたまま施錠→モーダル閉・本文/コピー/Word残らず・再解錠で未保存編集が保存済み、②録画入りでパスフレーズ変更→変更直後と再読み込み後に再生可・旧PW拒否・新PWで解錠、③暗号化控えが暗号化形式で平文不含・取り込みで復号、④CSV に '=1+1。注: 施錠はモーダルが画面を覆うため JS から onClick 発火（実運用の契機は無操作タイマーの自動施錠で同一コード）
- curl 試験: SEC-11 外部 Origin の /api/auth/* は 403（GET/POST とも）、同一/無 Origin は 200。SEC-05 サインアウト後の旧 Bearer は /api/rpc/vault/status で 401、旧 cookie の get-session は null
- 回帰9本すべて PASS: recording 35/35、hub-auto 32/32、sanpo-autofill 32/32、sanpo-spec 49/49、knowledge-spec 35/35、fde-gap 44/44、sales-spec 44/44、import-spec 100/100、case-lifecycle 25/25
- tsc 0件・bun run build 成功。dist/index.html で本番CSP・frameguard.js 参照・インライン script 無しを確認
- 後片付け済み: OWNER_EMAILS 復元・テストアカウント削除（cleanup.ts 実行済み）・/tmp の試験素材削除
- 補助: /home/user/node_modules は packages/web/node_modules への symlink（make-uitest.ts の依存解決用。今回新設）
- 未デプロイ（ローカルのみ）
# 新規依頼（2026-10-01・10件目）面談の録画・録音の取り込みと設問下書き — 実装・検証完了

## 依頼
- 「Google Meetで45分の無料相談など会議する際に会議の映像と音声を録音するようにしようとしてますが、それらを利用して該当の設問などを適切な形で埋められるようにする仕組みを導入したい。ドラッグアンドドロップ仕様で映像音声ファイルを大きなサイズでも読み込める仕組みを導入してください」

## 棚卸しの結論
- アプリは「外部通信ゼロ・全データAES-256-GCM暗号化」が設計の柱。文字起こしをアプリ内でやるには外部APIに音声を送る必要があり、この柱に反する → アプリ内文字起こしは実装しない。文字起こしは Meet の機能か自分のAIで行い、結果ファイル（vtt/srt/sbv/txt）や貼り付けで取り込む形にした
- 録画本体を金庫レコード（1MB上限・サーバー同期）に入れるのは不可能 → 本体は IndexedDB の新ストア「media」に暗号化チャンク（8MiBごと AES-GCM）として端末ローカルにだけ保存。属性（名前・容量・再生時間・同意日・メモ・文字起こし本文）は案件レコードに持ち、従来どおり暗号化＋同期される
- 「設問を埋める仕組み」はアプリの既存思想（AIは草案・確認は人）に合わせ、文字起こし＋⑤⑩項目＋②設問IDを埋め込んだコピペ用プロンプト生成 → 自分のAIに貼る → 固定形式の出力を貼り戻す → 解析してプレビュー → 空欄だけ既定で入れる（入力済みは既定で外れる・未知キーは飛ばす）
- 録画の同意記録（同意を得た日）を各ファイルに持たせ、未記入なら注意を出す

## 実装
- lib/crypto/vault-crypto.ts: sealBytes/openBytes（バイナリの AES-GCM。base64 を通さず容量を膨らませない）
- lib/store/idb.ts: DB_VERSION 2。STORE_MEDIA 追加（{id=mediaId:index, mediaId, index, iv, data}、mediaId 索引）。putMediaChunk/mediaChunks（index順）/deleteMediaChunks
- lib/store/vault-store.ts: saveMediaBlob（slice→1チャンクずつ暗号化してput。進捗コールバック付き）/readMediaBlob（復号して結合しBlob化）/deleteMediaBlob
- hooks/use-vault.tsx: 上記3つをコンテキストに公開
- domain/types.ts: RecordingMeta（id/name/size/mimeType/kind/addedAt/durationSec?/chunkCount/note/consentAt/transcriptName/transcript/transcriptAt）+ CaseRecord.recordings?
- domain/logic/state.ts: normalizeCase で recordings を配列に正規化
- domain/logic/recording.ts 新規: 拡張子判定・formatBytes/formatDuration・parseTranscript（vtt/srt/sbv のタイムスタンプ・順番行・タグ除去＋直前重複行の圧縮）・MEMO_AUTOFILL_FIELDS（⑤の10項目）・buildTranscriptPrompt（⑤項目＋②設問ID＋固定出力形式【memo:key】【answer:qid】＋「文字起こしにないことは書かない」等の規則）・parseAutofillOutput（【キー】区切り解析・（情報なし）・空欄は除外）
- pages/case/recordings.tsx 新規: CaseRecordings。DnD＋クリック選択の取り込みゾーン（複数可・サイズ上限なし・取り込み中は%表示）、一覧（種別バッジ・名前・容量・再生時間・取込日・メモ・同意日・再生/ダウンロード/文字起こし/削除）、再生は復号して blob: URL の video/audio 要素、文字起こしモーダル（ファイル or 貼り付け・タイムスタンプ除去・文字数表示）、下書きモーダル（プロンプトをコピー→貼り戻し→読み取る→項目ごとにチェック［空欄=既定オン「空欄に入る」/ 入力済み=既定オフ「入力済みを上書き」］→件数表示で取り込み）
- pages/case/memo.tsx: 「商談の記録」パネルの直下に CaseRecordings を挿入

## 検証（実 Chrome、2026-10-01）
- verify-recording.py 新規（35項目）: パネル表示 → 約44MB mp4 の取り込み（複数チャンク・容量MB表示・再生時間1分30秒・映像バッジ・同意注意）→ DnD（DragEvent dispatch）で音声取り込み → 同意日で注意が消える → 再生（blob: URL）→ ダウンロード（元ファイル名）→ リロード後の属性・本体の保持 → vtt 取り込み（タイムスタンプ・WEBVTT 除去・文字数）→ プロンプト生成（【memo:summary】・文字起こし本文・②設問ID を含む）→ 貼り戻し解析（空欄は拾う・未知キーは飛ばす・入力済みは上書き扱い＆既定オフ）→ 取り込み（出席者に入る・summary は上書きされない・合意に入る）→ ②回答の保持確認 → 削除で行が消え他件は残る → 35/35 PASS
- 回帰: hub-auto 32/32、sanpo-autofill 32/32、sanpo-spec 49/49、knowledge 35/35、fde-gap 44/44、sales 44/44、import 100/100、case-lifecycle 25/25（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- スクリプト側の修正（アプリ側は不変）: fde-gap の「営業工数の今月行」が 2026-09 固定だったため月またぎで FAIL → 当月を動的計算に修正。録画スクリプトはモーダルの「取り込む」ボタンが2個同名で .first だと「ファイルから取り込む」を掴む問題を text-is に修正、行の待機を容量表示が出るまでに修正
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-28・9件目）自動入力の再設計（必要箇所のみ） — 実装・検証完了

## 依頼
- 「自動で埋められるようにできるところは自動で埋めるように再設計する必要がある場合は、必要なところを再設計して下さい。必要がなければ無理に再設計しないで下さい」

## 棚卸しの結論
- 既に自動化済みで触らないもの: リード→案件の転記、①→②シート生成、②→③下書き、③→④プリセット、④見積確定→⑩三方良し（8件目）、⑤予算感→③④連携、⑦の前月引き継ぎ、ハブの自動項目（契約終了・入金待ち）
- 採用したもの（いずれも事実の転記・日付の可視化・事務所ルールの既定値で、判断の自動化ではない）:
  1. ハブに出ていなかった日付4種を自動項目に追加: ①面談日（未来=「面談」、過去＋⑤メモ未記入=「商談後メモが未記入」）、⑧次の請求日・継続契約の終了日、⑩三方良しの次回確認日（「次の行動に追加」済み＝source:"sanpo" かつ同 due の未完了がある時は重複させない）、⑦当月レポート未作成（月額稼働中のみ、期限=月末）
  2. 完了・失注の案件の自動項目はハブに出さない（手動分は残す）
  3. ⑦月次レポートの「こちらへの支払」既定値: 前月分 → ⑧月額 → 0
  4. ⑧開始日入力で終了日が空なら6ヶ月後を自動入力（事務所ルール「初回6ヶ月」。手で直せる・開始日を変えない限り再上書きしない。月末クランプあり）
  5. ⑧設定作成時、plan=monthly で見積確定済みなら月額の既定値を税込÷1.1で入れる（案内文つき）
- 見送り: ⑥契約日の推算（根拠なし）、⑦削減分を③推計から入れる（推計を実績として書くことになる）、支払条件文からの期限解析（自由文で信頼できない）

## 実装
- domain/logic/case.ts: collectAllNextActions を拡充。ymd() ヘルパ追加（toISOString のUTCずれ回避）。完了・失注は手動 nextActions の push 後に return。自動項目ID: auto_ce_（契約終了）・auto_due_（入金待ち）・auto_meet_（面談）・auto_memo_（メモ未記入）・auto_bill_（次の請求）・auto_send_（継続契約終了）・auto_rep_（今月分の月次レポート）・auto_sanpo_（三方良しの確認）
- pages/case/report.tsx: addReport() の支払既定値を last?.consultFee ?? supportMonthlyFee（supportMonthlyFee は早期 return 後のトップレベルで定義）
- pages/case/support.tsx: plus6Months() 追加。開始日 Field の onChange で終了日が空なら自動入力＋終了日に hint。!sp 分岐で feeDefault（plan==="monthly" かつ estimate.totalIncTax>0 なら Math.round(totalIncTax/1.1)）を計算し案内文表示、設定ボタンで s.contract.monthlyFee = feeDefault
- components/actions-hub.tsx: ヘッダーコメントと下部 Note(tone="info") を更新（自動で出る項目の一覧と「完了・失注にした案件の自動分は出ません」を明記）

## 検証（実 Chrome、2026-09-28）
- verify-hub-auto.py 新規（32項目）: 未設定時は自動なし → 面談日（未来）で「面談」→ 過去に変更で「商談後メモが未記入」→ ⑤記入で消える → ⑧設定（終了日=6ヶ月後の自動・請求日）→ 継続契約終了・次の請求・今月分レポートが出る → ⑦支払既定値150000・月は今月・作成で消える → 2ヶ月目は前月160000引き継ぎ → ⑧終了日の手修正が反映 → ⑩次回確認日で「三方良しの確認」→ 手動追加で自動分が消え【確認】行が出る → ⑥終了日で「契約終了・更新確認」→ done で自動0件・手動は残る → active に戻すと自動復活（終了日は手修正のまま）→ 案件B: ④月額プリセット → 計算 → 推奨の税込を入れる → ⑧作成で月額=税込÷1.1 → リロード後の保持 → 32/32 PASS
- 回帰: sanpo-autofill 32/32、sanpo-spec 49/49、knowledge 35/35、fde-gap 44/44、sales 44/44、import 100/100、case-lifecycle 25/25（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- 検証中に直したスクリプト側の誤り（アプリ側は不変）: ⑩のラベルは「次回の確認日」、⑥は未開始時「実行管理を始める」を押す、サイドバーは aside button で特定、④プリセットは「計算する」を押すまで見積ボタンが出ない
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-28・8件目）見積確定時に三方良しの空欄を自動で埋める — 実装・検証完了

## 依頼
- 「仮プランなどが確定した時に三方良しを自動的に埋められるところを埋める」

## 仕様（自分で設計）
- トリガー: ④単価設計の「見積として確定させる」パネルで税込金額が確定した時（NumField で >0 入力、または堅実/推奨/挑戦プランの税込を入れるボタン）。有効期限・発行日・支払条件の変更時も金額確定済みなら再実行。⑩タブに手動ボタン「④で確定した内容から空欄を埋める」も追加
- 自動で埋めるのは事実転記できる6項目のみ: target（対象となる提案）・customerValue（顧客にとっての価値と負担）・officeCondition（自事務所として続けられる条件）・stakeholderImpact（現場・取引先への影響。③フロー分析 result がある時のみ）・basis（根拠と不明点。転記元＋「金額と時間の削減は概算の見込みで、効果を確約するものではありません」等の注記を必ず含む）・compareNew（提案の比較メモ新規制作）
- 判断項目は自動では入れない: 状態3値（statusCustomer/statusOffice/statusStakeholder）・concerns・toConfirm・nextCandidate・compareKeep/compareReuse・振り返り
- 上書きルール: 空欄の項目だけを埋める。前回の自動転記から手を付けていない項目（現値===前回自動値）は最新に更新。手で書き換えた項目・空に戻した項目は以後いじらない（追跡から外す）。CaseRecord.sanpoAuto?: { at, source, fields, values } で前回の自動文面を保持
- 材料がない（pricing.result も estimate.totalIncTax>0 もない）場合は何もしない

## 実装
- domain/logic/sanpo.ts 新規: buildSanpoAutofill(c)（下書き組立。材料がない項目は返さない）・applySanpoAutofill(x, source)（上書きルール適用・sanpoAuto 更新・書き込んだ項目キー配列を返す）・SANPO_AUTO_FIELD_LABELS（6項目のラベル）。時間は分単位
- domain/types.ts: CaseRecord に sanpoAuto?: { at: string; source: string; fields: string[]; values: Record<string,string> } 追加
- pages/case/pricing.tsx: 見積確定パネルの NumField（税込金額）・Field（有効期限）・Field（発行日）・3つのプラン税込ボタン・支払条件 Field にトリガー追加。パネルの note に「金額を確定すると、⑩三方良しの空欄に確定内容の下書きが自動で入ります（あとから手で直せます）。」追記
- pages/case/sanpo.tsx: 懸念警告の下に sanpoAuto の転記記録 Note(tone="ok")（転記元・日付・項目名・「手で書き換えた項目は以後の自動転記で上書きしません」・「各視点の状態や懸念は自動では設定しません」）と手動ボタン行を追加。canAutofill = !!(c.pricing?.result || (c.estimate?.totalIncTax ?? 0) > 0)

## 検証（実 Chrome、2026-09-28）
- verify-sanpo-autofill.py 新規（32項目）: ⑩で未確定時の案内 → ④で「設計＋伴走（1ヶ月）」プリセット → 計算 → 推奨プランの税込を入れる → ⑩の6項目の転記確認（想定工数 25時間など）→ 対象を手修正 → ④で堅実プランの税込を入れる → 手修正は保持・未編集の顧客項目は更新 → 根拠を空に戻す → 手動ボタン → 再転記されない → リロード後の保持 → 32/32 PASS
- 回帰: sanpo-spec 49/49、knowledge 35/35、fde-gap 44/44、sales 44/44、import 100/100、case-lifecycle 25/25（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-28・7件目）案件管理のワークフロー再設計（必要箇所のみ） — 実装・検証完了

## 依頼
- 「私がビジネスで案件管理しやすいようにと、ワークフローを見失うことのないように再設計する必要がある場合は、必要なところを再設計して下さい。必要がなければ無理に再設計しないで下さい」

## 棚卸しの結論
- 既に十分で再設計しないもの: 次にやることハブ（全案件・リードの集約・期限切れ/今日/今週フィルタ・契約終了/入金待ちの自動項目・ヘッダーバッジ）、案件10タブの進捗ドット、リードのステータス管理とダッシュボード、自社モードの横断一覧。新しい画面（カンバン等）は追加しない（画面を増やすこと自体が見失いの元）
- 再設計が必要だった穴（3点）: ①案件にライフサイクルの状態がなく終わった案件が進行中と並び続ける（lostReasons は正規化のみで UI なしのデッドコードだった）②サイドバーが追加順固定で最終更新が画面に出ていない（updatedAt は patch で記録済みだったが未表示）③停滞に気づく手がかりがない

## 実装（最小変更）
- domain/types.ts: CaseRecord に status?: CaseStatus（""=未設定 / active / paused / done / lost）。空欄は未設定のまま・進行中と読み替えて保存しない原則を維持
- domain/logic/state.ts: normalizeCase で status undefined → ""
- pages/case/setup.tsx: ①案件設定の企業情報パネルに「案件の状態」Select（未設定(進行中として扱う)/進行中/休止中/完了/失注）＋畳まれ方の hint。状態変更の操作経路は①に一本化（サイドバーからは変えない）
- components/shell.tsx: CaseList を再構成。CaseRow 切り出し。状態で3グループ（進行中(未設定含む) → 休止中 → 終わった案件(完了・失注)は「終わった案件 (n)」で折りたたみ）。各グループ内は最終更新(updatedAt なければ createdAt)の新しい順（表示時ソート・永続データの並びは触らない）。案件行に「最終更新 ○前」（relativeTime）と状態ラベル（休止中/完了/失注のみ。進行中は無印）。絞り込み中は畳みを強制展開（filtered prop）
- 失注理由の記録・分析は今回スコープ外（リード側に既存。案件側は必要になってから）

## 検証（実 Chrome、2026-09-28）
- verify-case-lifecycle.py 新規（25項目）: 初期（全件進行中・状態未設定・最終更新表示）→ B社完了/C社休止中で分離・畳み → 畳み開閉・ラベル → A社を触ると先頭へ（最終更新順）→ 絞り込み中は畳みを開かずにB社が見える → リロード後の保持（状態・並び・畳み）→ 未設定に戻すと進行中に戻る → 25/25 PASS
- 回帰: sanpo 49/49、knowledge 35/35、fde-gap 44/44、sales 44/44、import 100/100（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-28・6件目）三方良しの視点の組み込み — 実装・検証完了

## 依頼
- 「この内容の提案で三方良しの心を取り入れたいと考えてます。必要なところを採用して組み入れて下さい」
- 添付: /home/user/Attachments/02_Consulting_Cockpit追加仕様_DP6Ys6.md（三方良しの追加アイディア提案集。確定仕様ではなく採否を選べる案。判断補助・合計点なし・既存構造に収める・AIは必須ではない・操作制限は未決定、という方針が明記されている）

## 採否
- 採用: 三方良しメモ（案件の新タブ⑩に構造化）・各視点の状態表示（未確認/懸念あり/確認済み・合計点なし）・提案比較メモ（現状維持/既存活用/新規制作）・次の行動の候補＋理由＋確認日（既存の次の行動への紐付け）・導入後の振り返り・懸念の注意表示（案件一覧バッジ＋タブ内警告。操作は止めない）
- 見送り: AI下書き補助（完全ローカル設計のため）・操作制限/必須確認（提案書で未決定）・顧客向け出力への自動連携（内部採算の混入リスク。出力は従来通り転記方式）・営業表現の候補保存（文面ライブラリで代替可）・合計点（提案書で明示的に否定）

## 実装
- domain/types.ts: CaseTab に "sanpo"、CaseRecord に sanpo: SanpoReview、SanpoReview 新規（target/customerValue/officeCondition/stakeholderImpact/basis/concerns/toConfirm/statusCustomer/statusOffice/statusStakeholder/compareKeep/compareReuse/compareNew/nextCandidate/nextReason/nextCheckDate/reviewDate/reviewResult の18キー・全て string）
- domain/logic/state.ts: normalizeCase に sanpo 正規化（オブジェクト保証＋18キーを undefined なら "" に）
- domain/logic/case.ts: computeCaseProgress に ["sanpo","⑩三方良し",sanpoTouched(c)] 追加（10件目）。sanpoTouched（いずれかの値が空でなければ着手済み）・sanpoHasConcern（concerns 非空または3状態のいずれかが "concern"）新規
- pages/case/sanpo.tsx 新規: CaseSanpo。Note(info) で位置付け注記（自動判定しない・合計点なし・空欄は未設定のまま・内部用で出力に含まれない）。懸念時は Note(warn)「懸念が記録されています。操作を止めるものではありません」。5パネル: 三方良しメモ/各視点の状態（3つの Select: 空/未確認/懸念あり/確認済み）/提案の比較メモ/次の行動の候補（追加確認・限定試行・提案・条件見直し・見送る＋理由＋次回確認日）/導入後の振り返り。「確認したいことを「次の行動」に追加」ボタンで toConfirm の各行を【確認】接頭辞付きで nextActions に追加（source: "sanpo"、due: nextCheckDate、同文面は二重追加しない）
- pages/case/index.tsx: 10タブ化（LABELS に sanpo: "⑩ 三方良し"）、ヘッダー進捗 /10、懸念時に Badge「三方良し: 懸念あり」、CaseSanpo 描画
- components/shell.tsx: 案件一覧の進捗 /10、企業名の右に懸念バッジ（#C9A961）
- lib/export/case-export.ts: 進捗の分母を 10 に（sanpo の内容自体は出力に含めない＝内部用のまま）
- components/kit.tsx: Tabs のコメントのみ

## 検証（実 Chrome、2026-09-28）
- verify-sanpo-spec.py 新規（49項目）: ⑩タブ存在・進捗/10・5パネル・初期状態（全て未設定・警告なし・完了ドットなし・合計点表示なし）→ 入力 → 懸念の注意表示（タブ内警告・ヘッダーバッジ・サイドバーバッジ）→ 確認事項2行の次の行動への追加（追加メッセージ・二重追加防止・⑤商談後メモに【確認】行が出る）→ リロード後の保持（全項目・警告・完了ドット・⑤の行）→ 懸念解消で警告・バッジが消える → 49/49 PASS
  - 注意: タブの完了ドットは span.shrink-0.rounded-full で特定すること（アクティブタブの下線 span も rounded-full を持つため span.rounded-full だと誤検出する）。次の行動は input の value で描画されるため inner_text ではなく input[value=...] で確認すること
- 回帰: knowledge 35/35、fde-gap 44/44、sales 44/44、import 100/100（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts
- make-uitest.ts / uitest-cookie.ts は packages/web を cwd にして実行すること（better-auth のモジュール解決のため）。.env の source も引き続き必須

---

# 新規依頼（2026-09-25・5件目）ファイル取り込みの読み取り精度強化 — 実装・検証完了

## 依頼
- 「ファイルを入れたが、読み取りが甘いようです。しっかりと認識して自動で振り分けられるようにして下さい」
- 実際に入れたファイルは特定できず（Attachments等に新規ファイルなし）。「読み取りが甘い」事例を網羅する方向で、キー名の揺れ・EMLの文字コード・Excel・日付表記・本文中の法人名など認識精度を全体的に強化

## 実装
- domain/logic/import-lead.ts を全面書き換え（約910行）
  - キー名の別名表 FIELD_ALIASES（社名/事業所名/連絡先/電子メール/送信日/結果/手段 等）＋ normKey（空白・括弧・コロン・装飾を落として小文字化）＋ ALIAS_TO_FIELD
  - extractFields（ネストした {name}/{value} を取る valToString、Date→isoDate）
  - normDate 強化: Excel数値日付（1899-12-30起点シリアル）・和暦（令和/平成/昭和/R/H/S＋元/数字）・YYYY.M.D・YYYY年M月D日・RFC2822（25 Sep 2026）対応
  - mapSendResult 拡張（送達/完了/成功/済/ok/delivered、不達/エラー/bounce、確認中/保留/pending 等）
  - mapChannel 拡張（完全一致→部分一致。「フォーム」含む→formOut 等）
  - 定型句追加: INBOUND_MARKS・FORM_OUT_MARKS・RESULT_MARKS（送信確認済/送信済み 等）
  - extractCorpName: 本文・件名から法人格（株式会社・医療法人・税理士法人等）を持つ文字列を抽出（様/御中/殿を除去）。company が空のとき候補として入れて警告
  - asRecordList: ラッパーキー（records/log/items/データ/送信履歴 等）や「配列が1つだけのオブジェクト」にも対応
  - parseNdjson: 1行1件のNDJSON/JSONL
  - テキスト: BODY_START_LABELS＋scanLabels＋buildFromText に整理。splitRecords で区切り線（---・=== 等）による複数件分割
  - .eml 本格解析: 折り返しヘッダ連結・multipart再帰（text/plain優先）・base64/quoted-printable復号・RFC2047件名復号（=?charset?B/Q?...?=）・ISO-2022-JPは7bit本文をバイト列に戻して TextDecoder で復号（文字化け修正の核心）
  - 表形式共通 parseRows＋parseSpreadsheetFile（SheetJS で .xlsx/.xls、cellDates: true）
  - ParseOptions { myEmails } 追加: .emlの差出人が設定画面のメールアドレスと一致すれば「こちらからの送信（emailOut）」と判定
- pages/leads/import.tsx
  - isSpreadsheetName/parseSpreadsheetFile 追加、opts.myEmails に state.profile.email を渡す
  - accept を .json,.jsonl,.ndjson,.csv,.tsv,.txt,.md,.eml,.xlsx,.xls に拡大、説明文にNDJSON/Excel/eml差出人判定を追記

## 検証（実 Chrome、2026-09-25）
- パーサ単体テスト（/tmp/parser-test.ts）: 14ファイル全て期待通り（ISO-2022-JPのeml文字化けは 7bit本文のバイト列復号で修正済み）
- 検証用ファイルを /tmp/import-test/ に追加: log.ndjson（別名キー2件）・legacy.csv（社名/連絡先/電子メール/令和8年9月18日/送達）・inquiry.eml（ISO-2022-JP 7bit・RFC2047件名）・sent.eml（UTF-8・差出人=info@yamashirogyomukaizen.com・本文に株式会社クライアント）・list.xlsx（openpyxl・日付セルはdatetime）
- verify-import-spec.py を100項目に更新: accept拡大・案内文・NDJSON/別名CSV/eml/Excel の種別判定・和暦→2026-09-18・RFC2822→2026-09-24・Excel日付セル→2026-09-17・送達→送信確認済み・ISO-2022-JP復号（担当者名「江 美玲」・相談メモ本文）・eml差出人照合→emailOut・本文からの企業名抽出の警告 → 100/100 PASS
  - 検証では設定モーダルでプロフィールのメールアドレスを info@yamashirogyomukaizen.com に設定してから.emlを読み込む手順を追加（差出人照合の前提）
- 回帰: knowledge 35/35、fde-gap 44/44、sales 44/44（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-25・4件目）ファイル取り込みのD&D対応・形式拡大・位置移動 — 実装・検証完了

## 依頼
- 「ドラッグアンドドロップとさまざまなファイル形式を読み取れる仕組みをもっと使いやすく見やすい位置に導入して下さい」
- 解釈: リード①のファイル取り込み（LeadImport）をドラッグ&ドロップ対応の大きなドロップゾーン化し、対応形式をCSV/TSV（Shift_JIS自動判別）に広げ、位置を①タブ先頭（「リードを追加する」より上）へ移動

## 実装
- domain/logic/import-lead.ts
  - CSV/TSVパーサ追加: parseDelimitedRows（引用符内の改行・区切り文字対応）、CSV_HEADER_KEYS（見出し行として認めるキー: 事業所名/企業名/会社名/法人名/company/チャネル/channel/宛名/担当者名/件名/subject）、parseDelimited（区切りは拡張子優先・先頭行でタブ/カンマ多い方。見出し行が読めなければ warnings 入り1件を返す。見出し行ありなら各行を parseJsonRecord に渡す）
  - decodeImportFile(buf) 追加: BOM優先→UTF-8 fatal→失敗時 Shift_JIS（Excel書き出しCSV対応）
  - parseImportFile 入口で ext === "csv" || "tsv" を parseDelimited に振り分け
- pages/leads/import.tsx
  - ファイル選択inputを隠し（className="hidden"）、大きなドロップゾーン（data-dropzone="lead-import"、onDragOver/onDragLeave/onDrop）に置き換え。ドラッグ中はティール枠 border-[#0e7490] bg-[rgba(14,116,144,0.14)]
  - 「ファイルを選ぶ」ボタンで fileRef.current?.click()。accept を .json,.csv,.tsv,.txt,.md,.eml に拡大
  - 対応形式の説明文（JSON/CSV・TSV/テキスト/メール、複数可、Shift_JIS可）を表示
  - onFiles を f.text() → f.arrayBuffer() + decodeImportFile(buf) に変更
- pages/leads/generate.tsx: LeadImport を①タブ先頭（「リードを追加する」Panel の前）に移動（旧位置の重複は削除済み）

## 検証（実 Chrome、2026-09-25）
- 検証用ファイルを /tmp/import-test/ に追加: list.csv（UTF-8・2件・本文に改行+カンマの引用符テスト）、list-sjis.csv（cp932・1件）、list.tsv（1件）、noheader.csv（見出しなし警告ケース）
- verify-import-spec.py を新UI・新形式対応に更新（76項目）: ドロップゾーン存在・案内文・「ファイルを選ぶ」ボタン・accept属性・「リードを追加する」より上の配置・CSV/TSVの種別判定・送信日正規化（2026/09/20→2026-09-20）・Shift_JISの担当者名が文字化けしない・見出しなしCSVの警告とブロック（作成ボタン=4件、見出しなし1件だけ残る）・CSV本文の改行・カンマ保持・CSV出典URL → 76/76 PASS
- 回帰: knowledge 35/35、fde-gap 44/44、sales 44/44（各スクリプトは新規アカウントで個別実施）
- tsc 0件（tsconfig.app.json）・bun run build 成功・pageerror なし
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-25・3件目）公式サイトとの整合性（配色・フォント）— 実装・検証完了

## 依頼
- 「https://yamashirogyomukaizen.com/ ホームページとの整合性を合わせて下さい」
- ユーザー選択: ダークのまま色だけ寄せる（背景は暗いまま、アクセントをオレンジ#c44d03→ティール#0e7490。長時間の入力作業向け）

## 実装
- styles.css と全コンポーネント・ページのオレンジ系を一括置換: #c44d03→#0e7490（ティール）、#e05c09→#0891b2（ホバー・ハイライト）、rgba(196,77,3,*)→rgba(14,116,144,*)。背景・墨黒ベースのダークは維持（ink-900 #0c0c0c のまま）。Word/印刷の書き出し色も同じティールに
- フォント: 表示・本文の先頭を Outfit → Noto Sans JP（公式サイトの font-family に合わせる）。等幅は JetBrains Mono のまま（金額・ID の桁揃え用）
- ロゴは既に公式と同一（packages/web/public/logo.png = 公式の矢印/回路モチーフ「A」、シアン→ネイビー）
- 確認済み・変更不要: 屋号「山代業務改善事務所」、公式URL https://yamashirogyomukaizen.com、サービス料金プリセット（ライト5万/設計+伴走月15万/集中伴走55万等、2026-07-25確定の値上げ後と一致）

## 検証（実 Chrome、2026-09-25）
- CSS --color-brand=#0e7490、html 内にオレンジ残存なし（dev の Vite モジュールキャッシュが古い accent クラスを出していたため node_modules/.vite を消して再起動で解消）
- tsc 0件・build 成功・pageerror なし
- 回帰: import 44/44、knowledge 35/35、fde-gap 44/44、sales 44/44（各スクリプトは新規アカウントで個別実施）
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200）・cleanup.ts

---

# 新規依頼（2026-09-25・2件目）ファイル取り込みで自動振り分け→新規リード作成 — 実装・検証完了

## 依頼
- 「ファイルを読み込ませると、自動で読み取ってメール送信した案件なのかフォーム問い合わせ案件なのか適切に読み取って自動振り分けまたは新規リード案件作成として作成するようにしてください」
- 解釈: リード①に「ファイルから読み取る」機能を追加。外部AIには接続せず、JSONのキー名・テキストのラベル行・定型句のルールだけで判定。判定できない項目は「不明（空欄）」のままにして人が選ぶ（推測で埋めない）。同名企業は警告のみ・自動統合しない（設計方針どおり）

## 実装
- 型: types.ts の LeadRecord に channel（"" / "email" / "form"。こちらから送った場合の接触経路）と sentBody（送信した本文の記録）を追加。state.ts normalizeLead で初期化（空欄のまま）
- 新規 domain/logic/import-lead.ts: parseImportFile(name, text)。JSON（配列・単一・{records|log|items|entries:[...]}）とテキスト（.txt/.md/.eml）対応。種別 ImportKind = "" / "emailOut" / "formOut" / "inbound"。チャネル語句（email/form/問い合わせ）・受信定型句（「お問い合わせがありました」等）・送信結果語句（送信確認済み/未送信確定/結果不明）で判定。送信結果がある=こちらから送った記録。日付は YYYY/MM/DD → YYYY-MM-DD 正規化。読み取れない項目は warnings に入れ空欄のまま
- 新規 pages/leads/import.tsx: LeadImport。ファイル複数選択 → 読み取り結果テーブル（取込チェック/種別セレクト/企業名・担当者/送信日/送信結果/確認事項）。種別「不明」または企業名空の行は作成ブロックして Note 警告。同名企業バッジ（既存・バッチ内）、連絡停止フラグバッジ。作成時: inbound は leadKind=hpInquiry・source=site・infoBasis=declared・consultMemo=本文。emailOut/formOut は channel/sendState/sentSubject/sentBody/sendLog（kind: import:email / import:form）、送信確認済みなら status=sent と sentAt。sourceUrl は sources へ。stopFlag は contactStop.stopped=true。audit("lead_import")。作成後は一覧から外す
- generate.tsx: 「リードを追加する」パネル直下に LeadImport を配置
- process.tsx: 「出典と窓口」に「接触経路（こちらから送った場合）」Select と「送信した本文（記録）」Area（channel または sentBody がある時だけ表示）
- list.tsx: 企業・担当セルに メール送信 / フォーム送信 / HP相談 バッジ

## 検証（実 Chrome、2026-09-25）
- 新規 /home/user/verify-import-spec.py: 44/44 PASS。4ファイル（JSON4件+テキスト3件）の振り分け、曖昧テキストは種別不明のまま人が判定、判定不能・企業名なしの警告と作成ブロック、送信日正規化、連絡停止フラグ継承、inbound はHP相談扱い（接触経路は空欄のまま）、結果不明は③照合一覧へ、同名企業の再読み込み警告、リロード後の保持、まで確認
- 回帰: verify-knowledge-spec.py 35/35、verify-fde-gap.py 44/44、verify-sales-spec.py 44/44（いずれも新規アカウントで実施。同一アカウント使い回しだと各スクリプトが同名の検証用リード「検証リード株式会社」を作るため衝突することが判明し、スクリプト側の企業名を 知見検証/FDE検証/営業検証リード株式会社 に一意化。アプリ側の退行ではない）
- sales-spec 堅牢化: 保持確認は必ず②一覧経由で対象行を開く、③の「④で照合する」は対象企業の行スコープ、連絡停止・同名企業バッジの件数も行スコープに変更
- bunx tsc --noEmit -p tsconfig.app.json: 0件・bun run build: 成功・pageerror なし
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200, tmux web）・cleanup.ts でテストユーザー削除。検証用ファイルは /tmp/import-test/

## 未実装（完成扱いしない）
- 外部AIによる読み取り、メール/フォームへの自動送信、外部システムとの連携アダプター（設計方針により対象外）

---

# 新規依頼（2026-09-25）添付「案件管理・営業支援の実装プロンプト」の取捨選択導入 — 実装・検証完了

## 依頼
- 「適切なところだけを汲み取って反映して下さい」＋添付 /home/user/Attachments/cockpit_sales_prompts_oPdFt0.md（Consulting Cockpit：案件管理・営業支援の実装プロンプト 2026-09-25）
- プロンプト1（Cockpit側の営業管理強化）とプロンプト2（外部の営業支援システム）の2本立て。設計方針と照合して取捨選択する旨の委任

## 取捨選択の方針
### 採用（設計に合う: ローカル完結・外部AI非接続・自動送信なし・空欄を確認済みにしない）
- 出典の記録: LeadSource[]（URL/ページ題名/根拠抜粋/確認日）→ リード④に新パネル「出典と窓口」
- 窓口判定 contactFit（受付明示あり/禁止・用途不一致/不明。初期値は未設定。「禁止の記載がない」を許可と読み替えない）
- 送信状態 sendState（未作成/下書き/送信確認済み/未送信確定/結果不明。案件段階と分離。結果不明は自動再送しない注記）
- 返信状態 replyState（未返信/返信あり/拒否・停止要請。拒否で連絡停止を同時に立てる）
- 連絡停止 contactStop（企業単位。同一企業の全リードに継承表示。禁止・停止中は接触承認チェックを無効化）
- 重複候補の警告: 同名企業リードのバッジ表示（自動統合しない）→ リード②一覧
- サービス台帳 ServiceRecord + 新タブ⑤（料金式は既存の価格プリセットを再利用、営業側に別料金式を作らない）
- 営業集計の拡張: リード③に流入元別の 接触→返信→受注 集計＋結果不明の送信の照合一覧

### 見送り（設計に反する/対象外）
- 外部API接続・自動送信・排他的送信権・自動追撃・開封追跡・外部営業支援システムとの連携アダプター（プロンプト2全般）
- 仮プラン自動生成（外部AI非接続のため。手動の商談準備シート prepSheet が既存）
- JSON/CSV取込アダプター（外部システム非接続のため。バックアップ/復元が既存）
- 稼働余力との自動照合（オフィスモードの容量判定が既存。自動連携は複雑化するため見送り）

## 実装メモ（進行中）
- 型: types.ts に LeadSource/ContactFit/SendState/ReplyState/ContactStop/ServiceRecord、LeadRecord に sources/contactFit/sendState/replyState/contactStop、VaultState に services、LeadTab に "services"
- normalize: state.ts normalizeLead/normalizeVaultState、vault-store.ts splitState の meta に services（knowledge/office と同じ消失バグを防ぐ）
- UI: leads/process.tsx 新パネル、leads/list.tsx バッジ、leads/dashboard.tsx 集計、新規 leads/services.tsx、leads/index.tsx タブ追加

## 検証（実 Chrome、2026-09-25）
- 新規 /home/user/verify-sales-spec.py: 44/44 PASS。出典の追加/削除、leadKind/contactFit/sendState/replyState の初期値が未設定、拒否→連絡停止の自動化、同一企業の継承表示、禁止・停止中は接触承認が無効、②一覧の連絡停止・同名企業バッジ、③流入元別4列化、byKind、結果不明の照合一覧→④遷移、⑤サービス台帳（capability 未確認の警告、料金式は既存プリセット再利用の注記）、連絡停止リスト、リロード後の全保持を確認
- 回帰 /home/user/verify-knowledge-spec.py: 35/35 PASS、/home/user/verify-fde-gap.py: 44/44 PASS（劣化なし）
- bunx tsc --noEmit -p tsconfig.app.json: 0件・bun run build: 成功・pageerror なし
- 検証時に3スクリプトを修正: 表示モード（リード/自社）が復元されるため unlock_or_create 末尾に必ず案件モードへ戻す処理を追加、リード追加時に既存詳細が開いている場合は「+ リードを追加」を押すフォールバックを追加
- 後片付け済み: OWNER_EMAILS 復元（,uitest@local.test 削除）・web 再起動（port 4200, tmux web）・cleanup.ts でテストユーザー削除

---

# 新規依頼（2026-09-20・2件目）追加指示文「模倣に依存しない品質蓄積の仕組み」導入 — 実装・検証完了

## 依頼
- 「この内容についても導入してください」＋添付 /home/user/Attachments/pasted-1_Sjb2OW.txt（Consulting Cockpit AIへの追加指示文 第1版 2026-09-20）
- 前タスク（FDE 14項目）を補う追加仕様。実装承認済みと解釈して実施（前タスクと同じパターン）

## 実装
- 知見台帳（新規 pages/case/knowledge.tsx）: 候補→確認中→試験待ち→レビュー待ち→内部再利用承認済みの状態遷移、終了状態（却下/要再検証/廃止）は削除せず折りたたみに退避、公開状態は別系統（非公開/公開審査中/公開承認済み/公開停止）。項目は指示文どおり（種別/一般化内容/適用条件/除外条件/根拠区分/確認済み・未確認範囲/権利審査/版/承認者/承認日時/見直し期限/適用参照）。削除は「候補」かつ適用参照なしのみ
- 案件への適用: 承認済み知見のみ。版を案件側へ固定し引用元ID・版・適用理由を記録。新版を出しても適用記録は自動更新されない（検証済み）
- ⑥実行管理: 実行状態に確認者・未実施理由の欄、事故記録に「知見候補にする」ボタン（例外→知見台帳へ候補登録）、末尾に知見台帳
- ⑧継続サポート: 見直し期限30日以内・超過の承認済み知見の一覧（KnowledgeReviewList）
- ①案件設定: 情報利用条件（dataUseTerms）・利用する基準の版（basisVersions）の欄
- リード④営業プロセス: 情報の区別（本人申告/こちらの解釈/未確認。初期値は未設定のまま）＋相談メモ貼り付け欄
- ⑦月次報告: 今月の振り返り6欄（迷った箇所/事前発見/次回追加/不要記録/負担増/再利用可否）
- 出力の三区分: Excel/Word/印刷の前に宛先確認モーダル（顧客引継ぎ用/内部再利用用は実行可、公開用見本はブロック＋警告）。全文一括出力を既定にしない。監査に case-export を記録
- 空欄を承認済み・正常・ゼロに変換しない方針は normalize でも維持（新規項目は全て空欄初期化）

## 修正した既存バグ（重要）
- vault-store.ts splitState: meta:app レコードがフィールド明示列挙のため knowledge が保存時に捨てられ、リロードで知見が全消えしていた → meta に knowledge を追加して修正
- 同じく office（自社の月次記録）も保存時に捨てられていた既存バグ → 同時に修正（meta に office を追加）
- 型検査の無効化を解消: packages/web/tsconfig.json はプロジェクト参照形式で `bunx tsc --noEmit` は実質無検査だった。正しい検査は `bunx tsc --noEmit -p tsconfig.app.json`。出た106件を全て解消（0件）。主な内訳: 必須化した型への narrowing 対応（hoisted function をアロー化）、diagnosis-legal.ts の GARTNER_DEFS 欠損フィールド、未使用 import、desktop-backup の null 可能性、auth.ts の applicationId 型、vault-store の hash 型（number→"0"）

## 検証（実 Chrome、2026-09-20）
- 新規 /home/user/verify-knowledge-spec.py: 35/35 PASS。知見の追加・状態遷移・終了退避・候補のみ削除・版固定の適用記録・新版でも自動更新されないこと・⑧見直し一覧の出/不出・①新欄・確認者/未実施理由・振り返り6欄・三区分モーダル（公開ブロック）・リード情報区別の初期値が未設定であること・リロード後の全保持を確認
- 回帰 /home/user/verify-fde-gap.py: 44/44 PASS（前タスク分の劣化なし）
- bunx tsc --noEmit -p tsconfig.app.json: 0件・bun run build: 成功・pageerror なし
- 受入試験16項目のうち実装で担保できるものは上記に含む。AI未接続時に「稼働中」と表示する機能は現行コードに存在しない（要件充足済み）
- 後片付け済み: OWNER_EMAILS 復元・web 再起動（port 4200, tmux web）・cleanup.ts でテストユーザー削除

## 残事項
- 本番 https://consult-rjau47t.runable.site/ への反映はデプロイ待ち（前タスク分・URL切替分と同じビルドに乗る）
- 既存ユーザーの金庫は normalize が新項目を空欄で初期化するため移行作業は不要（知見台帳は空から始まる）

---

# 新規依頼（2026-09-20）統合資料（content.docx・第1版第5巡）の読み込み — 全14項目実装・検証完了

## 依頼
- Google Drive の content.docx（file ID 1N7cq3exvGv1J3waQnp2bICi5XWSCGvZj）を「読み込んで情報を抽出して完璧に反映してください」
- 原本: /home/user/content.docx、抽出テキスト: /tmp/content.txt（/tmp は揮発するので必要なら content.docx から再抽出）

## 対応方針
- 資料0章・11章の指示どおり、アプリ改修・外部接続・料金変更は行わず、①〜⑦形式の差分分析を提示
- 差分分析ファイル: docs/2026-09-20-fde-gap-analysis.md（リポジトリ内。追加のみで既存コード無変更）
- 現行実装はコード実読で確認済み: リード3画面＋案件9タブ、execution は todo/inprogress/done/hold の4状態、承認台帳・時間4区分・A/F比較・M1〜M4・容量判定・FDE商品区分は未実装
- 次のステップ: ユーザーの実装指示待ち。提案した優先順位は (1)FDE商品区分+個別仕様 (2)実行状態+承認台帳 (3)時間4区分 (4)M1〜M4 (5)容量判定 (6)A/F比較

## 実装（2026-09-20 指示「管理サイトにする必要があるのは全て導入」）
- types.ts/state.ts: FdeProfile・RunItem(11状態)・ApprovalEntry・IncidentEntry・BuildStage・MonthlyReport拡張(M1-4/未実施/時間4区分/精算)・Support拡張(次月選択/依存先変更/安全期限/移管票)・FlowAnalysis.opsDesign・pricing.af・Lead.fit/fdeStage・VaultState.office・Mode "office"
- 画面: setup(FDE商品) sheet(受注条件7項目) flow(人/AI分担等) pricing(A/F) memo(合意/未合意等) execution(S1-S4/実行状態/承認台帳/事故) report(M1-4等) support(次月選択等) leads/process(適合確認) leads/dashboard(受注済みvs期待・営業工数) office新モード(共通時間/AI費用/容量判定/承認・事故横断)
- 検証: typecheck Exit 0・本番ビルド成功・実ブラウザ 44/44 PASS（/home/user/verify-fde-gap.py、2026-09-20）。金庫作成→案件・リード・自社の全14項目の表示/入力/リロード後保持を確認。pageerror なし
- 検証中に発見・修正: ①leads/dashboard「受注済みと期待の分離」パネル重複（簡易版を削除し完全版に統一）②execution 実行状態が旧テーブルのままだった（ID・担当・入力識別子・設定版・期待結果・実結果・証拠を持つカード型に置換）
- 後片付け済み: OWNER_EMAILS 復元（uitest除去）・web 再起動（port 4200, tmux web）・cleanup.ts でテストユーザー削除
- 残事項: 本番 https://consult-rjau47t.runable.site/ への反映はデプロイ待ち（URL切替修正と同じビルドに乗る）
- 注意: 資料の数値は全て計画仮説。既存確定料金（2026-07-25）とは別体系として扱い一括置換しない

# 新規依頼（2026-09-15）ポートフォリオURLの新旧ドメイン切替 — 完了

## 依頼
- 「ポートフォリオ：https://yuuki-yamashiro-portfolio.com が古いドメインでの登録になっているので、新しいドメインで登録してください」
- 新ドメイン = https://yamashirogyomukaizen.com（稼働確認済み: 200 で新サイト配信中。旧ドメインは Cloudflare Error 1000「DNS points to prohibited IP」で不通）

## 対応
- 書類の {{乙ポートフォリオ}} は `profile.url` 参照（docs.ts:43）。コード初期値は既に新ドメインだったが、既存金庫に保存済みの旧URLは暗号化されていてサーバー側からは書き換え不可 → 屋号と同じ方式のクライアント側マイグレーションを追加
- `state.ts` normalizeVaultState: `profile.url` が `yuuki-yamashiro-portfolio.com` を含む場合 `https://yamashirogyomukaizen.com` に書換（unlock/reload の rebuildFromLocal で必ず通る）
- 組込雛形に旧URLの直書きはなし（変数参照のみ）を rg で確認済み

## 検証（実 Chrome channel=chrome、/home/user/verify-url-migration.py）
- 新規金庫 → 設定→プロフィールで旧URLを保存 → リロード・再解錠 → URL欄が新ドメインに自動書換 PASS
- ⑨法務で免責事項を生成 → 本文「ウェブサイト：https://yamashirogyomukaizen.com」・旧ドメイン非含有 PASS
- 2回目リロード後も新ドメイン維持 PASS／pageerror なし／typecheck Exit 0／lint 新規エラーなし（既存3件は pricing.tsx・q4.ts・q5.ts 由来）

## 残事項
- 本番反映にはデプロイが必要（⑨法務モーダル修正と同じビルドに乗る）
- デプロイ後、ユーザーが本番で金庫を開けば自動で新ドメインに書き換わる（手動操作は不要）
- 後片付け済み: OWNER_EMAILS 復元・web 再起動・cleanup.ts でテストユーザー削除・本人1件（record 17件）のみ確認

---

# 新規依頼（2026-09-15）オフィス移転に伴う契約書類の新住所更新＋書類棚卸し

## 目的
- 契約書類を新住所 `〒107-0061 東京都港区北青山1-3-3 三橋ビル 3階`（山代業務改善事務所）に更新
- 書類全般の内容が現状と相違ないか棚卸しし、必要な修正を行う

## 実装タスク
- [x] state.ts: プロフィール初期値の屋号・住所を新値に変更（makeEmptyVaultState / normalizeVaultState 両方）＋マイグレーション（旧屋号 KokoroInkArt/Yuuki Yamashiro → 山代業務改善事務所、住所が空なら新住所を投入、設定済み値は保護）
- [x] case.ts / sheet.ts / compliance.ts: フォールバック `|| "Yuuki Yamashiro"` → `|| "山代業務改善事務所"`
- [x] doc-templates.ts: 免責事項の発行者欄を 屋号／氏名／所在地／ウェブサイト に刷新、個情法改正の注記を「2026年7月10日成立・7月17日公布（令和8年法律第56号）」に更新、referralLetter を「初回無料相談45分・診断ライト¥50,000〜・設計＋伴走月¥150,000〜」に更新、「免責事項(第2版)」参照を全ファイルで「第3版」に統一、見積書の見積者欄に `所在地：{{乙住所}}` を追加
- [x] diagnosis-legal.ts: PRICING_PRESETS を新料金の6種（spot/design/intro/intensive/monthly/training）に再構成、STAGE_PRICE_RANGE を新料金に更新（Defend 5〜8万／Extend 15〜18万／Transform 55〜80万／月8〜10万）
- [x] pricing.tsx: applyPreset の planMap/contractType 分岐を新プリセット6種に対応
- [x] settings.tsx: ProfileTab の旧表記に言及する注記を屋号統一の案内文に書き換え
- [x] typecheck / build 通過（Exit 0、2026-09-15）
- [x] 実ブラウザ検証（verify-address-update.py / verify-alldocs.py / verify-referral.py / verify-profile-inputs.py）
  - 法務タブで生成した全9書類（NDA・見積・発注請・業務委託・AI特約・DPA・検収・完了報告・免責）に新屋号が入り、住所欄を持つ6書類に新住所が入ることを確認（AI特約・検収書・完了報告書は元来住所欄なし）
  - 旧表記（Yuuki Yamashiro / KokoroInkArt / ¥120,000 / 無料相談30分 / 未成立 / 免責事項(第2版)）が全書類・設定画面に残らないことを確認
  - 免責事項に発行者所在地と改正法「成立・7月17日公布」の記述があることを確認
  - 金庫内の紹介関連文面が新料金・45分相談になっていることを確認（状態: 組込）
  - プロフィール入力欄の実値が 所在地=新住所・屋号=山代業務改善事務所 であることを確認
- [x] 後片付け: OWNER_EMAILS から uitest@local.test 除去・web 再起動・cleanup.ts でテストユーザー削除・q2.ts で本人1件（record 15件）のみ確認

## ユーザー側で必要な操作（既存金庫のため自動反映されない分）
- 設定 → 書類雛形 → 「組込雛形で全部上書き」を実行（金庫内の旧雛形を新雛形に更新）
- 設定 → プロフィール の所在地に旧住所が残っている場合は新住所に書き換え（空欄なら新住所が自動投入済み）

## 本番反映の確認（2026-09-15 ユーザーが本番で操作後）
- [x] 監査ログ: 2026-09-15 17:20〜17:26（JST）に macOS から vault_unlock ×4（新しい device）。作業時刻と整合
- [x] 雛形上書きの検証（q4.ts）: 新組込雛形を `JSON.stringify({key,body})` → AES-GCM(+16Bタグ) → base64 した予測長と、本番DBのテンプレートレコード12件の実測長が 12/12 バイト単位で完全一致 → 本番金庫の雛形は最新組込版と同一と断定
- [x] プロフィール: profile:main が 212→364 バイトに更新（+152。新住所≈56バイトの入力と整合する増加）
- [x] レコード総数 15・本人1ユーザーのみ。変化なし
- 注: 住所文字列そのものは暗号化されておりサーバー側からは読めない仕様。正確な住所の最終確認はアプリの設定画面または書類「作る」での目視が必要
- 注: 雛形上書き・プロフィール保存には専用の監査アクションがない実装のため、監査ログが vault_unlock のみなのは正常

## 症状1（法務タブ「作る」で書類が出ない／画面が固まる）→ 原因特定・修正済み（2026-09-15）

### 原因（実ブラウザの計測ログで特定）
- 主因: 金庫ストアの競合。書類生成（mutate）のidb保存が終わる前に定期同期（sync）が走ると、
  同期が読んだ古い行で新しい行を上書きし、さらに受信差分の取り込み（rebuildFromLocal = state を
  idb からまるごと作り直し）が保存途中の新規書類を巻き込んで消す。
  → 生成直後のモーダルが `found=true → false` に落ちて消える（計測ログで確認）。
  「作る」を押しても書類が出ない・直前の入力が消える、という症状の正体。
- 副因: sync/push の1レコード上限 256KB。書類を生成するたび generatedDocs に追加される設計のため
  案件レコードが育ち、256KB を超えると push が 400（too_big）で永久に失敗し続ける
  （テスト案件 256,372 chars で再現。他の正常レコードも巻き込んで一切同期されなくなる）。
- 画面が真っ暗に固まって見える件: 上記の state 置換の途中で描画例外が起きると、
  ErrorBoundary が無かったため React ツリー全体がアンマウントされ背景だけが残る仕様だった。

### 修正
- vault-store.ts: idb 書き込み・state 置換を直列化キュー（enqueue）に統一。
  sync 通信中にローカル編集（revision 変化 or キューに後続ジョブあり）を検知したら
  受信適用と cursor 進行を見送り、800ms 後にやり直す（編集を消さない）。
- sync.ts（API）: ciphertext 上限を 256KB → 1MB に引き上げ。
- vault-store.ts: それでも上限を超えるレコードはバッチから除外して残りだけ送り、
  ステータスに「同期上限超過」と対象IDを明示（静かに溜まり続ける状態を防止）。
- error-guard.tsx（新規）＋ provider.tsx: ErrorBoundary を追加。例外時は真っ暗ではなく
  「画面の表示で問題が起きました」＋エラー内容＋読み込み直す／コピー ボタンを表示し、
  localStorage `cockpit.lastError` に直近5件を保存。
- main.tsx: window.onerror / unhandledrejection でも cockpit.lastError に記録。
- legal.tsx: generate() 全体を try/catch（失敗時は alert）、doc id を時刻+乱数に、
  DocModal で content が文字列でない場合のフォールバック追加。

### 検証（実 Chrome channel=chrome、本番相当の重い案件 77KB・45問）
- 全9書類 作る→モーダル表示→本文あり→閉じる: 修正前は 9書類中2〜3件が再発、
  修正後は 4連続ランで 9/9 すべて成功・応答 2〜4ms・pageerror なし。
- オフライン（/api 全遮断）でも 作る→表示 成功。
- 256KB 超で同期が詰まっていたレコードが 1MB 化後に即同期再開（v7→v8、400 エラー消滅）。
- ErrorGuard: 意図的クラッシュで復帰画面・コピー・cockpit.lastError 記録を確認。
- typecheck / build Exit 0。検証用一時コード（crash トリガ・計測ログ）は全て除去済み。
- 後片付け済み: OWNER_EMAILS から uitest 除去・web 再起動・cleanup.ts → 本人1件・record 15件。

### 残事項
- 本番への反映には新ビルドのデプロイが必要（ローカル変更のみでは本番は直らない）。
- ユーザーの本番データ自体は監査ログ上 9/15 17:31 の doc_generate・保存とも成功しており、
  サーバー側の案件レコードも正常に更新されていた（データ損失はなし）。

## 2026-09-15 夕 追加検証（デプロイ後も症状が続いた件）

### 事実関係
- 本番配信物は修正済み最新コード（prod HTML → index-yoj_HnGO.js・修正文字列 all present）。
- しかしユーザーの本番再テスト（18:39〜18:42 JST）でも doc_generate ×4 はサーバー成功、
  画面表示は失敗の報告。ローカル dev では再現しない。
- 本番バンドルは 880KB。ローカルで `bun run build:web` し直すと 1,314KB（ハッシュ相違）→
  本番側のビルドは別の最適化（platform 側）が入っている可能性。CSS ハッシュは一致。

### 本番同等環境での再検証（2026-09-15 19時台）
- 構成: `bun run build:web` の dist を `src/__server.ts`（Bun.serve、本番と同じ配信経路）で
  PORT=4299 に配信 + 実 Chrome。テストユーザー uitest を一時作成（OWNER_EMAILS 追加）。
- データ: 重い案件 339KB（generatedDocs 8件・45問シート）を取込 + 組込雛形12種を読込。
- 結果: 全9書類 作る→モーダル（本文 870〜8,260字）→閉じる すべて成功（応答 2〜4ms、
  pageerror 0、console/HTTP エラー 0、cockpit.lastError なし）。「見る」も正常。
  リロード → 再解錠 → 見る も正常。サーバー側 record 15件すべて同期成功（case v9 へ）。
- 結論: コード上の不具合は本番同等環境では再現しない。残る可能性は
  (a) ユーザーの実案件データ固有の形状、(b) macOS Chrome 側のキャッシュが古い HTML/JS を
  保持（index.html に cache-control が無い＝platform の配信設定次第）、(c) ネットワーク経路の差。
- 後片付け: uitest ユーザー・record/audit/session/account を cleanup.ts で全削除。
  OWNER_EMAILS を元に戻し、prod 検証サーバー(4299)停止。dev サーバー(web/4200)は稼働継続。

### ユーザーへの依頼事項（症状が再発した場合）
1. Cmd+Shift+R（強制再読み込み）で古い HTML/JS を捨ててから再試行。
2. 再発したら Cmd+Option+J でコンソールを開き、赤いエラー行の有無、
   「画面の表示で問題が起きました」画面（ErrorGuard）が出たかを確認。
3. コンソールで `localStorage.getItem('cockpit.lastError')` を実行し、内容を共有。

---

# 新規依頼（2026-08-19）支援内容の具体化＋クライアント別メニュー提案

## 目的
1. 「支援の内容」について「何を・どれくらい」を具体的に明記できるようにする
2. クライアント（業種・規模・成熟度・課題）に合ったメニュー提案を自動生成できるようにする

## 設計方針（決定）
- 新規ファイル `packages/web/src/web/domain/data/service-menu.ts` を作成
  - `SERVICE_MENU_ITEMS`: 各メニューの「やること（複数）・工数レンジ・期間・成果物・含まないこと・推奨条件」
  - `MENU_RECOMMEND_RULES`: maturity stage / industry / size / keywords / gartner / leader でスコアリング
  - `scoreMenu()`: 点数順に並べ替えた推奨リストを返す
  - `buildMenuProposalText()`: 案件データからクライアント向け提案文（見積/提案に差し込める）を生成
- `pricing.tsx` に「支援メニュー（何を・どれくらい）」パネルを追加
  - 現在の inputs に対応する推奨メニューを点数順に3件表示
  - 各メニューを展開すると「内容・工数・期間・成果物・含まないこと」を表示
  - 「このメニューを積算に反映」ボタンで inputs を上書き
  - 「提案文に差し込む」で proposalDraft.sections.menu に本文を保存
- `setup.tsx` の「企業情報」パネル直下に「この案件に合いそうな支援メニュー」パネルを追加（settings が変わるたびに再計算、閲覧のみ）
- `docs.ts` / `doc-templates.ts` の見積書・提案書に「支援内容」セクションを差し込めるようにする（`{{serviceSummary}}` 変数）

## 実装タスク
- [x] service-menu.ts の作成
- [x] types.ts に ServiceMenuItem / MenuScore を追加
- [x] pricing.tsx 改修（推奨パネル＋明細表示）
- [x] setup.tsx 改修（推奨パネル）
- [x] docs.ts / doc-templates.ts へ {{支援内容}} 追加
- [x] typecheck / build 通過（Exit 0、2026-08-19）
- [x] 実ブラウザで推奨表示・反映・提案文の確認（/tmp/verify-menu.py / verify-menu2.py / verify-menu-doc.py で全項目 True）
  - 設定モーダル「組込雛形で全部上書き」後、見積書と業務委託契約書の本文に「【支援内容（何を・どれくらい）】」「［含まれるもの］」「［含まれないもの］」が差し込まれることを確認
  - メニュー未選択時は案内文「（④単価設計で支援メニューを選ぶと…）」が入るように docs.ts を変更（2026-08-19 追記・typecheck Exit 0）
- [x] 支援メニュー一覧 PDF（deliverables/service-menu.pdf）の作成・納品（7ページ・A4・weasyprint・全7メニュー・前払い表記8箇所・屋号=山代業務改善事務所・金額は税抜+2026年8月時点の注記）
- [ ] 後片付け: `.env` OWNER_EMAILS から `,uitest@local.test` 削除 → web 再起動 → cleanup.ts でテストユーザー削除
- [x] task.md 更新（このファイル）

---

# 本件（2026-08-14 追加分）3件の改修

- [x] 1. 法務タブ「作る/見る」→ 現行コードでは再現せず（実ブラウザ検証済み：モーダル本文・Word書き出しとも正常）。ユーザーに再現条件を確認する。
- [ ] 2. 料金は「前払い・入金確認後に着手」へ文言・書類・UI改修
  - [x] 追加修正4点（flow-pricing.ts / pricing.ts / diagnosis-legal.ts / state.ts）
  - [x] lint・typecheck・build 全部通過（2026-08-14）
  - [ ] UI実画面での再確認（④単価設計タブの既定表示・アラート文言）
- [x] 3. モバイルのGoogleログイン不能の原因特定・可能な範囲で修正
  - 原因特定済み: Expo Go では Linking.createURL が exp://IP:8081/--/auth/callback を返すが、Runable認証基盤(api.runable.com)は exp:// 形式を戻り先として登録していない → 400 "Unrecognized managed auth origin"。ネイティブスキーム runable-consult-rjau47t://auth/callback は登録済みで Google ログイン画面まで到達確認済み。
  - 結論: Expo Go の構造的制約。開発ビルド(eas build)またはインストール版なら動く設計。
  - 修正: use-vault.tsx の signIn で Expo Go（Constants.executionEnvironment === "storeClient"）を検出し、サーバーの分かりにくいエラー画面の代わりに「Expo Go ではGoogleサインインを使えません。開発ビルドまたはインストール版でお試しください」と表示するよう変更。
  - 検証: iOS/Android 両バンドル成功・変更込みを確認。型チェック通過。

## 保留中（既存依頼）
- [x] 機能一覧 PDF → deliverables/features.pdf（5ページ・A4）
- [x] セキュリティ（侵入試験）報告 PDF → deliverables/security.pdf（4ページ・A4）
- [x] H4〜H9 の強化（実装＋稼働検証 完了）
  - H4: vault/status に kdfSalt/verifier を含まない / unlockParams は15分窓・20回上限・429「解錠の試行が続いたため、5分ほどお待ちください。」（25回試行で 200×20 + 429×5 を確認）
  - H5: devices.revoke で他セッション即時無効化（Aでrevoke→Bが401化を実証。h5-seed.ts で session 2件直投入して検証）
  - H6: sync/push・vault/rekey の暗号文上限 262144 bytes（262154→400 too_big / 1000→200 を確認）
  - H7: state.ts に取込防御（20MB上限・__proto__/constructor/prototype 除去・深さ64上限）
  - H8: desktop ipc.ts の fs:read/fs:write を dialog 選択パスに限定（allowedPaths/assertAllowed）
  - H9: audit/verifyChain が切り詰め後の先頭 seq を起点に検証（startsAtSeq を返す。/tmp/verify-h4h9.py で ok:true, checked:16, startsAtSeq:1 を確認）
- [x] 試験用アカウント後片付け 完了（2026-08-14）
  - sectest 削除済み（対象なし）
  - H5検証で投入した h5-sess-A/B・h5-device-B・record h6ok を削除（h5-sess-B は revoke で既に消滅）
  - .env の OWNER_EMAILS から uitest@local.test を除去（現在は info@yuuki-yamashiro-portfolio.com, info@yamashirogyomukaizen.com のみ）
  - web tmux セッション再起動で環境変数反映済み
  - cleanup.ts 実行 → user は本人1件（R4PGCk91...）のみ、record 15件（雛形・profile）に復元
  - 検証用スクリプト make-uitest.ts / reset-sectest.ts / h5-seed.ts / cleanup-h5.ts は削除済み
  - 残スクリプト: q*.ts / cryptotest*.ts / mut.ts / migrate-record-pk.ts / cleanup.ts（調査用）

## 現状メモ
- auth.ts は既に最新（trustedOrigins=allowedOrigins+runable scheme / rateLimit 有効 / disableSignUp=true）。H1〜H3は完了済み。
- web 4200 起動中（tmux web）。プレビューURL https://consult-rjau47t-preview-4200.runable.site/ は 200。
- モバイル app.json: extra.apiUrl=↑ / applicationId=consult-rjau47t / scheme=runable-consult-rjau47t。auth.ts に expo() プラグインあり。
- 前払い化の対象: doc-templates.ts（業務委託契約書 第4条/別紙B、見積書、発注請書、月額継続サポート契約書 第4条）+ templates-msg.ts（請求メール）+ pricing.tsx（支払条件・入金・着手）+ case.ts（次にやること）

## 2026-08-14 検証メモ（症状1の再現準備）
- 金庫作成が通った（uitest@local.test サインイン→クッキー注入→CreateVault 成功→メイン画面到達）。以前の停止原因は確認欄・同意チェック未入力。
- 新規案件ボタンはモーダルではなく即座に makeEmptyCase で state.cases に追加（pages/index.tsx:18）→ クリックだけで案件作成可。
- 雛形は空の可能性 → 設定モーダル「書類雛形」タブの「組込雛形で全部上書き」ボタン（ConfirmButton: 1回目クリック→confirmLabel 表示→2回目で確定）。
- DocModal は open={!!g}、g=c.generatedDocs.find(id)。Modal は fixed inset-0 z-50 + panel（max-w-[1000px]）。コード上は正しく見える → 実ブラウザ再現で DOM 状態を採取する。
- 次: /tmp/verify-docmodal.py を拡張して案件作成→雛形読込→法務タブ→作る/見る→モーダル DOM 採取。

## 2026-09-15 法務タブ書類モーダル消失バグ — 抜本改修と本番同等検証（完了）

### ユーザー報告
本番 https://consult-rjau47t.runable.site/ で⑨法務の「作る」「見る」を押してもモーダルが出ない。エラー表示も cockpit.lastError も空。監査ログには doc_generate が残る（生成自体は成功）。

### 根本原因（2件）
1. **表示が金庫 state に連動していた**: 旧 DocModal は `c.generatedDocs.find(z => z.id === docId)` で表示物を引く。currentTab は同期対象（meta:app）なので、別端末・別セッションの同期でタブが切り替わると CaseLegal がアンマウントされ、viewDoc state ごとモーダルが消える。エラーはどこにも出ない。
2. **セッション再取得で金庫が強制ロックされていた（重大）**: use-vault.tsx の `[session, sessionPending]` effect が、解錠済みでも `setPhase("locked")` まで無条件で進む。better-auth の useSession は focus / online イベントごとにセッションを取り直し、参照が新しくなって effect が再実行される。再現: 解錠後に `window.dispatchEvent(new Event('online'))` を投げるだけでロック画面に戻る（実 Chrome + 本番ビルドで確認）。

### 実装した新機構
- `lib/trace.ts`: localStorage `cockpit.trace` に直近100件の操作足跡（イベント名・時刻・ランダムIDのみ。本文・社名は書かない）。
- `lib/store/doc-viewer-store.ts`: 書類ビューア専用のメモリオンリーストア。開いた瞬間のスナップショットを保持し、表示は金庫 state と完全分離。編集は 800ms デバウンスで金庫へ保存。保存失敗が表示に影響しない。
- `components/doc-viewer-modal.tsx`: docViewer だけを購読するモーダル（textarea + コピー + Word 書き出し + 要入力警告）。
- `app.tsx`: `<DocViewerModal />` を Provider 内に1つだけマウント（タブの再マウントで消えない）。
- `pages/case/legal.tsx`: 旧 DocModal 撤去。openViewer() がスナップショットを渡す。generate() に generate_begin/done/fail トレース。削除時にその書類が開いていればビューアも閉じる。
- `hooks/use-vault.tsx`: 上記 effect に `if (keyRef.current) return;` ガード追加（解錠済みならセッション再取得でフェーズを巻き戻さない）。

### 本番同等検証（bun run build:web の dist を src/__server.ts で配信 + 実 Chrome）
- 認証: better-auth のセッションCookieは署名付き（HMAC-SHA256、raw秘密鍵、base64、encodeURIComponent）。DB に session 行を直接 INSERT し Cookie 値を自前署名して注入する方式に切替（sign-in API のレート制限 8回/5分 を回避）。/home/user/uitest-cookie.ts。
- **verify-adversarial.py 全パス**: S1 新規金庫+組込雛形で9種類すべて生成&モーダル表示 / S2 別端末がタブ①に切替→強制pull→タブ実際に反転・CaseLegal アンマウント後もモーダル生存・内容1323字完全一致 / S3 タブ往復で再表示、オフライン編集→オンライン復帰→リロード後も編集保持 / S4 作る・見る連打でエラーなし / trace に fail なし / cockpit.lastError 空。
- **verify-prodbuild.py（重い案件 339KB・45問シート・8 generatedDocs 取込）9/9 パス**: 全書類の生成→モーダル（870〜8,260字）、見る、リロード→解錠→見る。エラー0。
- typecheck 3/3、oxlint 0警告。

### テスト自体の落とし穴（備忘）
- `tr:has-text("見積書")` は雛形表の行にもマッチする → `:has(button:has-text("見る"))` で絞る。
- モーダルの textarea は `.fixed.inset-0 textarea` で特定すること（①タブのフィールドと混ざる）。
- 金庫を消しても Gate は必ず作成画面（パス欄2個）になる（status.exists は削除済みvaultでも true を返すらしい）。新規ユーザーは cleanup で user ごと消す。

### 後片付け（済）
- uitest ユーザー・全データ削除（record 16 / audit 25 / session 1 / account 1 / user 1）
- .env OWNER_EMAILS から uitest@local.test 除去、packages/web/make-uitest.ts 削除、prod tmux(4299) 停止
- web tmux(4200) は稼働中

### 残タスク
- **本番デプロイまではユーザーの環境は直らない**。デプロイ後に https://consult-rjau47t.runable.site/ で ⑨ 作る/見るの実地確認を依頼する。
