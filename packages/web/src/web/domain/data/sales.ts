// 元アプリ v3 から移植：営業プロセス定数
export const LEAD_STATUS_LABEL = { pending:'未送信', sent:'送信済', replied:'返信あり', meeting:'面談化', converted:'案件化済' };

/** v7.1: 特定電子メール法 コンプライアンスパネル — 送信前チェック */
export const OPTIN_BASES = [
  ['inquiry',   '過去に問い合わせ・資料請求を受けた'],
  ['card',      '名刺交換・面談した相手'],
  ['event',     'イベント/セミナー/交流会で接点があった'],
  ['referral',  '紹介経由（紹介者の同意あり）'],
  ['existing',  '既存取引・継続的な関係がある'],
  ['public_b2b','企業サイト等で公開された問い合わせ用アドレス宛（会社宛の個別連絡）'],
  ['none',      '上記いずれにも該当しない（同意なし）'],
];

export const SALES_STAGES = [
  ['approach',     '① アプローチ',   '#6c757d'],
  ['firstMeeting', '② 初回商談',     '#3b6e8f'],
  ['proposal',     '③ 提案',         '#c9a961'],
  ['quote',        '④ 見積',         '#b8860b'],
  ['closing',      '⑤ クロージング', '#4a7c59'],
  ['won',          '⑥ 受注',         '#2e7d32'],
];
export const STAGE_ACTIONS = {
  approach:     ['初回メールを送付する', '3営業日後にフォローアップする'],
  firstMeeting: ['商談準備シートを記入する', 'ヒアリング設計を準備する'],
  proposal:     ['提案書骨子を生成する', '価格レンジを確認する'],
  quote:        ['見積書を発行する', '見積有効期限のリマインダーを設定する'],
  closing:      ['異議処理ハンドブックを確認する', '契約書類セット（NDA/契約書/免責）を準備する'],
  won:          ['案件化する（リード→案件転換）', 'キックオフ日程を調整する'],
};
export const OBJECTION_HANDBOOK = [
  { objection:'「高い」「予算がない」',
    empathy:'価格を重視されるのは当然のことです。',
    essence:'確認すべき本質：比較対象は何か（何もしない場合のコスト／他社／社内対応）。予算の問題か、価値が伝わっていない問題か。',
    options:'①スコープを絞ったライトプランの提示（Defend段階なら診断のみ）②効果測定後の段階拡張を提案 ③時期をずらした再提案。値引きで応じるのではなく、提供範囲で調整する（枕：値下げ要求の枕をおさえる）。' },
  { objection:'「今じゃない」「タイミングが悪い」',
    empathy:'導入時期のご判断は御社の状況が最優先です。',
    essence:'確認すべき本質：拍子チェック（繁忙期？組織改編？）。本当に時期の問題か、優先度が低いだけか。',
    options:'①「では、いつ頃が良いタイミングか」を具体的に伺う ②それまでの間にできる小さな準備（現状把握のみ等）を提案 ③時期が来たら連絡する許可を取り、次アクションに登録。' },
  { objection:'「上司に確認します」「稟議が必要」',
    empathy:'社内プロセスを尊重いたします。',
    essence:'確認すべき本質：目の前の方は賛成なのか。決裁者が気にするポイントは何か（費用対効果／リスク／実績）。',
    options:'①決裁者向けの1枚資料（成果サマリ形式）を提供 ②決裁者同席の場を提案 ③稟議に必要な情報（見積・契約条件・免責）を先回りで揃える。' },
  { objection:'「他社と比較中」',
    empathy:'複数社を比較されるのは健全なご判断です。',
    essence:'確認すべき本質：比較軸は何か（価格／実績／対応範囲／相性）。当方の強みが比較軸に乗っているか。',
    options:'①比較軸を一緒に整理することを提案（比較表の提供）②他社の方が適している場合は正直に伝える（信頼の獲得）③「小さく試す」選択肢の提示。' },
  { objection:'「効果が見えない」「本当に成果が出るのか」',
    empathy:'AI導入の効果に慎重になられるのは適切な姿勢です。',
    essence:'確認すべき本質：過去に効果の出なかった投資経験があるか。何をもって「効果」とするかの定義。',
    options:'①成果保証はできないことを誠実に伝える（免責事項第2版準拠）②効果測定の指標を先に合意する（KPI設計）③小さな1業務で試して判断いただく段階導入。誇張・無出典の数字は絶対に使わない。' },
  { objection:'「自分たちでできる」「社内でやる」',
    empathy:'内製化は素晴らしい方向性です。',
    essence:'確認すべき本質：本当にリソースとノウハウがあるか。過去に内製で頓挫した経験はないか。',
    options:'①内製化を支援する立場を提案（伴走型・自走ロードマップ）②「最初の型作りだけ」外部を使う選択肢 ③3ヶ月後に進捗を伺う許可を取る。' },
  { objection:'「忙しい」「時間がない」',
    empathy:'お忙しい中でのご検討、ありがとうございます。',
    essence:'確認すべき本質：忙しさこそが課題の兆候ではないか（属人化・業務過多）。優先度の問題か。',
    options:'①「忙しさの原因」を15分だけ伺う短時間ミーティングを提案 ②先方の工数がほぼ発生しない進め方（資料ベースの事前診断）を提示 ③時期を改める場合は次アクションに登録。' },
];

/* =====================================================================
 * v7.3: プロ営業モジュール（BANT+MEDDIC / 予測 / ステークホルダー / 速度 / NBA）
 * ===================================================================== */
// ステージ別デフォルト成約確率（重み付き予測用・編集可の初期値）
export const STAGE_PROBABILITY = { approach:10, firstMeeting:25, proposal:50, quote:70, closing:90, won:100 };

// BANT（4軸）＋MEDDIC（6軸）＝10軸評価
export const QUALIFICATION_AXES = [
  // BANT
  { id:'budget',    fw:'BANT',   label:'B: 予算（Budget）',           hint:'投資余力・予算枠が確認できているか' },
  { id:'authority', fw:'BANT',   label:'A: 決裁権（Authority）',       hint:'目の前の人／決裁者との接触度' },
  { id:'need',      fw:'BANT',   label:'N: 必要性（Need）',           hint:'課題の切実さ・優先度' },
  { id:'timeline',  fw:'BANT',   label:'T: 導入時期（Timeline）',     hint:'いつ動くかが具体的か' },
  // MEDDIC
  { id:'metrics',   fw:'MEDDIC', label:'M: 指標（Metrics）',          hint:'相手が測りたい成果指標が明確か' },
  { id:'ebuyer',    fw:'MEDDIC', label:'E: 決裁者（Economic Buyer）', hint:'最終的に予算を出す人を特定できているか' },
  { id:'criteria',  fw:'MEDDIC', label:'D: 決定基準（Decision Criteria）', hint:'選定基準を把握しているか' },
  { id:'process',   fw:'MEDDIC', label:'D: 決定プロセス（Decision Process）', hint:'稟議・承認フローが見えているか' },
  { id:'pain',      fw:'MEDDIC', label:'I: 課題の痛み（Identify Pain）', hint:'放置コスト・痛みが言語化できているか' },
  { id:'champion',  fw:'MEDDIC', label:'C: 推進者（Champion）',       hint:'社内で推してくれる人がいるか' },
];
// ステークホルダー役割
export const STAKEHOLDER_ROLES = [
  ['decision', '決裁者',   '#2e7d32', '最終的に予算を承認する人'],
  ['champion', '推進者',   '#3b6e8f', '社内で提案を推してくれる人'],
  ['user',     '利用者',   '#c9a961', '実際にツールを使う現場'],
  ['blocker',  '障害者',   '#b85c38', '反対・慎重・抵抗する人'],
];
export const LEAD_SOURCES = ['note','X','site','LinkedIn','紹介','セミナー','その他'];

/** 募集種別。雇用求人は課題仮説の参考情報で、外注ニーズとは区別する。空欄は未設定 */
export const LEAD_KINDS: [string, string][] = [
  ['',            '未設定'],
  ['outsourcing', '業務委託・外注募集'],
  ['partnership', '協業・パートナー募集'],
  ['jobPosting',  '雇用求人（参考情報。外注ニーズとは区別）'],
  ['hpInquiry',   'HP相談'],
  ['other',       'その他'],
];
export const FUNNEL_STATUSES = [
  ['consult_booked','相談予約','#6c757d'],
  ['consult_done','相談実施','#3b6e8f'],
  ['diagnosed','診断','#c9a961'],
  ['engaged','伴走','#4a7c59'],
  ['lost','失注','#b85c38']
];

export const LOST_REASON_TAGS = ['価格','タイミング','競合','社内事情','要件不一致','予算未確保','その他'];
