// 元アプリ v3 から移植：成熟度・ガートナー・単価プリセット・法務チェック
export const MATURITY_AXES = [
  { id:'exec',    label:'経営層のAI関与度',           opts:[['1','無関心'],['2','興味だけ'],['3','旗振り役がいる']] },
  { id:'aiuse',   label:'現状のAI利用',               opts:[['1','未導入'],['2','一部部署が試用'],['3','全社で運用']] },
  { id:'data',    label:'データ整備状況',             opts:[['1','紙・属人'],['2','一部デジタル'],['3','一元管理']] },
  { id:'process', label:'業務の標準化度',             opts:[['1','属人的'],['2','一部マニュアル化'],['3','仕組み化済']] },
  { id:'invest',  label:'失敗許容度・投資意欲',       opts:[['1','守りたい'],['2','改善したい'],['3','作り変えたい']] },
  { id:'leader',  label:'AIリーダー（旗振り役）の有無', opts:[['1','いない'],['2','兼任で一応'],['3','専任あり']] }
];
export const GARTNER_DEFS = {
  Defend: {
    label:'Defend（防御）', icon:'🛡', color:'#3b6e8f',
    desc:'今ある業務を守る・既存資産の保全・コスト最適化が主目的',
    musashi:'守りの構え。今あるものを失わない型を固める。新規より既存の整流化。',
    honda:'動くものは何でも分解して直す。まず手で触れて型を体に入れる。',
    nextMove:'まず属人化解消・マニュアル化・運用台帳。AIは「補助輪」レベルで導入',
    state:'今ある業務を守る段階。既存資産の保全とコスト最適化が主目的',
    action:'属人化の解消・マニュアル化・運用台帳の整備から始める',
    price:'AI業務診断（ライト）5万円〜（税抜・2026-07-25確定料金）'
  },
  Extend: {
    label:'Extend（拡張）', icon:'🌱', color:'#c9a961',
    desc:'今の延長線上で業務を拡げる・効率化・スピード化',
    musashi:'勝ち癖を作る。同じ型で繰り返し打ち、相手より速く動けるよう鍛える。',
    honda:'動くプロトタイプを早く作る。机上では決めず、現場で試す。',
    nextMove:'プロンプト集・ワークフロー自動化・部分的AI業務代行で生産性を底上げ',
    state:'今の延長線上で業務を拡げる段階。効率化・スピード化が主目的',
    action:'プロンプト集とワークフロー自動化を整え、標準化して横展開する',
    price:'設計＋伴走 月15万円〜（税抜・2026-07-25確定料金）'
  },
  Transform: {
    label:'Transform（転換）', icon:'🚀', color:'#4a7c59',
    desc:'業務モデル自体を作り替える・新しい価値創造',
    musashi:'打ちて変わる。一手で局面を変える機を見極め、思い切って捨てる。',
    honda:'今までの常識を疑え。「できない理由」より「やる方法」を100案出す。',
    nextMove:'業務プロセス再設計・新規事業AI連携・組織構造の変革まで踏み込む',
    state:'業務モデル自体を作り替える段階。新しい価値創造が主目的',
    action:'業務プロセスの再設計と新規事業のAI連携に踏み込む',
    price:'個別見積（構築〜月額継続。範囲確定後に提示）'
  }
};

export const PRICING_PRESETS = {
  spot:    { title:'スポット相談（2時間）', hours:2, baseline:15000, difficulty:2, urgency:'normal', clientSize:'small', experience:'yes', scopeRisk:'low', payment:'immediate', decisionMakers:'one', deliverables:['analysis'], duration:'short' },
  design:  { title:'業務改善 設計（単発）', hours:20, baseline:10000, difficulty:3, urgency:'normal', clientSize:'medium', experience:'yes', scopeRisk:'medium', payment:'immediate', decisionMakers:'few', deliverables:['strategy','analysis','prompts'], duration:'mid' },
  intro:   { title:'設計＋伴走（1ヶ月）', hours:25, baseline:6000, difficulty:3, urgency:'normal', clientSize:'medium', experience:'yes', scopeRisk:'medium', payment:'immediate', decisionMakers:'few', deliverables:['strategy','analysis','prompts','training'], duration:'mid' },
  intensive: { title:'集中伴走（3ヶ月）', hours:80, baseline:7500, difficulty:4, urgency:'normal', clientSize:'medium', experience:'yes', scopeRisk:'medium', payment:'immediate', decisionMakers:'few', deliverables:['strategy','analysis','prompts','training'], duration:'long' },
  monthly: { title:'定着サポート（月額継続）', hours:8, baseline:11000, difficulty:3, urgency:'normal', clientSize:'medium', experience:'yes', scopeRisk:'low', payment:'immediate', decisionMakers:'one', deliverables:['ongoing'], duration:'vlong' },
  training: { title:'社内研修（半日／1日）', hours:12, baseline:12500, difficulty:3, urgency:'normal', clientSize:'medium', experience:'yes', scopeRisk:'low', payment:'immediate', decisionMakers:'few', deliverables:['training','prompts'], duration:'short' }
};

// 料金の正本は service-menu.ts（2026-07-25確定・税抜）。こちらは成熟度ステージ表示用の目安レンジ。
export const STAGE_PRICE_RANGE = {
  Defend:    { name:'AI業務診断（ライト）', lo:50000,  std:50000,   hi:80000,    desc:'現状把握・AI適性診断・優先順位づけ（1〜2週間／単発）',
               why:'守りを固める段階。最初から大規模投資すると現場が崩れる。まず1件で型を作る。',
               upCond:'対象業務を2件以上に拡張する場合は ¥80,000〜', monthly:'月¥80,000〜（定着サポート）' },
  Extend:    { name:'設計＋伴走（1ヶ月）', lo:150000, std:150000,  hi:180000,   desc:'部門展開・標準化・運用台帳作成（月20〜30時間）',
               why:'1部署の型を横展開する段階。標準化と運用台帳が無いと崩れるので、設計と伴走をセットで。',
               upCond:'対象業務3件以上は ¥200,000〜／緊急度高は +20%', monthly:'月¥80,000〜（継続伴走）' },
  Transform: { name:'集中伴走（3ヶ月）', lo:550000, std:600000,  hi:800000,  desc:'フロー再設計・AIリーダー育成・新フロー設計（月60〜100時間）',
               why:'業務そのものを作り変える段階。リーダー育成と新フロー設計に時間がかかるので3ヶ月単位。',
               upCond:'多部署横断は ¥800,000〜／要件未確定は要件定義フェーズを別途', monthly:'月¥80,000〜100,000（卒業後の定着サポート）' }
};

export const LEGAL_CHECKLIST_ITEMS = {
  pre: {
    title: '契約前',
    items: [
      ['scope',     '業務範囲・成果物の定義が明確か'],
      ['annex',     '別紙A・B・C（金額／稼働時間／成果物）を埋めたか'],
      ['privacy',   '機密情報・個人情報の取扱い範囲を確認したか（DPA要否）'],
      ['ai',        'AI利用範囲（学習無効化・越境移転）をAI特約で合意したか'],
      ['exclusive', '独占業務（弁護士法72／税理士法52／医師法等）に踏み込んでいないか'],
      ['security',  '納品環境のセキュリティ条件を確認したか（USB／メール不可等→納品方式判定へ）']
    ]
  },
  during: {
    title: '契約時',
    items: [
      ['period',    '契約期間・更新条項（初回6ヶ月／更新3ヶ月）を入れたか'],
      ['payment',   '支払条件を明記したか（基本は前払い・入金確認後に着手。後払いの場合は給付受領日起算で60日以内）'],
      ['cap',       '賠償上限（直近12ヶ月）を入れたか'],
      ['disclaimer','免責事項(第3版)を添付・一体運用を説明したか'],
      ['invoice',   'インボイス番号・口座を記載したか']
    ]
  },
  post: {
    title: '契約後',
    items: [
      ['signed',    '署名／記名押印を回収したか'],
      ['acceptance','検収書・業務完了報告書の様式を共有したか'],
      ['reminder',  '更新／終了の起算日をリマインダー登録したか（機能6連動）']
    ]
  }
};
