// 元アプリ v3 から移植：業務フロー辞書・単価定数
export const MANUAL_KEYWORDS = ['手書き','手入力','手作業','紙','電話','FAX','ファックス','ファクス','転記','コピペ','コピー','プリント','印刷','記入','押印','ハンコ','印鑑','郵送','持参','口頭','メモ','エクセル管理'];
export const ACTOR_KEYWORDS = ['営業','経理','総務','人事','製造','倉庫','管理','マネージャー','部長','課長','担当','お客様','顧客','クライアント','取引先','受付','店舗','事務','エンジニア','医師','看護師','弁護士','税理士','社労士','講師','生徒','保護者','現場'];
export const TRANSFORM_RULES = [
  { match: /電話.*?(受注|注文|申込)/, to: 'Webフォーム受注', tag: '[システム]', need: 'クラウド' },
  { match: /紙.*?(伝票|帳票)|手書き.*?(記入|入力)|伝票記入/, to: 'クラウド入力フォーム', tag: '[システム]', need: 'クラウド' },
  { match: /FAX|ファックス|ファクス/, to: '自動データ連携', tag: '[システム]', need: 'クラウド' },
  { match: /手入力.*?(転記|入力)|転記/, to: 'システム間自動連携', tag: '[RPA]', need: 'RPA' },
  { match: /電話.*?(確認|問合|問い合わせ)|電話で確認/, to: 'リアルタイム照会', tag: '[システム]', need: 'クラウド' },
  { match: /問い合わせ.*?(対応|応対)|顧客対応/, to: 'AIチャットボット一次応対', tag: '[AI]', need: 'AI' },
  { match: /メール.*?(送信|作成)|個別連絡/, to: '自動通知', tag: '[RPA]', need: 'RPA' },
  { match: /印刷|プリント/, to: 'デジタル表示', tag: '[システム]', need: 'クラウド' },
  { match: /押印|ハンコ|印鑑/, to: '電子承認ワークフロー', tag: '[システム]', need: 'クラウド' },
  { match: /持参|郵送/, to: 'クラウド共有', tag: '[システム]', need: 'クラウド' },
  { match: /集計|エクセル管理|手集計/, to: 'BIダッシュボード自動集計', tag: '[システム]', need: 'クラウド' },
  { match: /分類|仕分け/, to: 'AI自動分類', tag: '[AI]', need: 'AI' },
  { match: /要約|まとめ/, to: '生成AI要約', tag: '[AI]', need: 'AI' },
  { match: /確認|チェック/, to: '自動チェック', tag: '[RPA]', need: 'RPA' }
];
export const TIME_ESTIMATES = { manual_phone:12, manual_paper:10, manual_fax:6, manual_transcribe:18, manual_inquiry:25, manual_generic:12, auto_system:1, auto_rpa:2, auto_ai:3, semi:4 };

// =====================================================================
// 単価設計：定数と連携マッピング
// =====================================================================
export const INDUSTRY_TO_PRICING = { general:'other', manufacturing:'manufacturing', retail:'retail', service:'service', it:'it', medical:'medical', legal:'professional', finance:'other', construction:'other', logistics:'other', education:'education' };
export const SIZE_TO_PRICING = { small:'small', medium:'medium', large:'large', enterprise:'large' };
export const PRICING_INDUSTRY_LABELS = { manufacturing:'製造業', service:'サービス業', retail:'小売業', it:'IT', professional:'士業', medical:'医療', education:'教育', other:'その他' };
export const DIFFICULTY_LABELS = { 1:'1 / ルーチン作業', 2:'2 / やや定型', 3:'3 / 標準', 4:'4 / 専門領域', 5:'5 / 高度専門' };
export const CLIENT_SIZE_COEF = { personal:0.8, small:1.0, medium:1.2, large:1.5 };
export const CLIENT_SIZE_LABEL = { personal:'個人事業', small:'小規模(〜30名)', medium:'中規模(30〜300名)', large:'大企業(300名超)' };
export const URGENCY_COEF = { normal:1.0, hurry:1.15, super:1.30 };
export const URGENCY_LABEL = { normal:'通常', hurry:'急ぎ', super:'超特急' };
export const SCOPE_RISK_ADD = { low:0, medium:0.10, high:0.20 };
export const SCOPE_RISK_LABEL = { low:'低', medium:'中', high:'高' };
export const PAYMENT_ADD = { immediate:0, monthly:0.03, long:0.08 };
export const PAYMENT_LABEL = { immediate:'前払い（入金確認後に着手）', monthly:'月末締め翌月払い', long:'60日以上' };
export const DECISION_ADD = { one:0, few:0.05, many:0.10 };
export const DECISION_LABEL = { one:'1名', few:'2〜3名', many:'4名以上' };
export const EXPERIENCE_COEF = { yes:1.0, no:1.15 };
export const EXPERIENCE_LABEL = { yes:'あり', no:'なし（学習コスト上乗せ）' };
export const DELIVERABLE_LABELS = { strategy:'戦略提案書', analysis:'業務分析レポート', prompts:'プロンプト集', training:'研修実施', video:'動画コンテンツ', implementation:'システム実装支援', ongoing:'伴走サポート（月次）', other:'その他' };
export const DURATION_LABEL = { short:'〜1ヶ月', mid:'1〜3ヶ月', long:'3〜6ヶ月', vlong:'6ヶ月超' };

export const FLOW_MATERIAL_MAP = {
  flow: { label: '現状業務の素材', keys: ['B1','B7','B10','A5'] },
  pain: { label: '困りごとの素材', keys: ['B2','B3','B6','B8','B9','B4','A2'] },
  tune: { label: '解析チューニング素材', keys: ['A3','D1','D4','C1','C2','C5','C7','D5'] }
};
export const FLOW_MATERIAL_HINT = {
  B1:'B1(時間が取られる業務)', B7:'B7(定型作業)', B10:'B10(繁閑差)', A5:'A5(組織変化)',
  B2:'B2(属人化)', B3:'B3(部門連携)', B6:'B6(現場の声)', B8:'B8(ミス)', B9:'B9(情報散乱)', B4:'B4(残業)', A2:'A2(部署体制)',
  A3:'A3(経営注力)', D1:'D1(成功イメージ)', D4:'D4(速さ/精度/コスト)', C1:'C1(既存システム)', C2:'C2(AI活用状況)', C5:'C5(IT体制)', C7:'C7(クラウド方針)', D5:'D5(ハードル)'
};
