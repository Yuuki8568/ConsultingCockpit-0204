/**
 * 支援メニューの定義と、クライアント条件からの推奨スコアリング。
 * 「何を・どれくらい」を具体的に示すための正本。
 * 金額の目安は 2026-07-25 確定の料金設計（税抜）に揃える。
 */

export interface ServiceMenuItem {
  id: string;
  /** 画面・書類に出す正式名 */
  name: string;
  /** 一言でいうと */
  catchcopy: string;
  /** このメニューでやること（具体的に） */
  includes: string[];
  /** 目安工数（コンサル側の稼働） */
  hoursMin: number;
  hoursMax: number;
  /** 目安期間 */
  period: string;
  /** お渡しするもの */
  deliverables: string[];
  /** この料金に含まれないもの */
  excludes: string[];
  /** 参考価格レンジ（税抜） */
  priceLo: number;
  priceHi: number;
  /** 価格の補足 */
  priceNote: string;
  /** ④単価設計のプリセットに対応するキー（あれば） */
  pricingPreset?: string;
  /** 対応する実行管理の契約タイプ */
  contractType: "single" | "1m" | "3m" | "monthly";
}

export interface MenuScore {
  item: ServiceMenuItem;
  score: number;
  reasons: string[];
}

export const SERVICE_MENU_ITEMS: ServiceMenuItem[] = [
  {
    id: "spot",
    name: "スポット相談（2時間）",
    catchcopy: "まず話だけしてみたい、方向性だけ確認したいときに。",
    includes: [
      "事前ヒアリング（フォームまたは30分の電話）",
      "オンライン相談 2時間（画面共有で現状を見ながら）",
      "その場で分かる範囲の助言と、次にやるとよいことの整理",
      "相談内容の要約メモ（A4・1〜2枚）を後日送付",
    ],
    hoursMin: 2,
    hoursMax: 3,
    period: "単発（実施日のみ）",
    deliverables: ["相談要約メモ（A4・1〜2枚）"],
    excludes: [
      "ツールの設定・操作代行",
      "書類・プロンプト等の作成物",
      "相談後の継続的な質問対応",
    ],
    priceLo: 30000,
    priceHi: 30000,
    priceNote: "¥30,000（税抜）・前払い（入金確認後に日程確定）",
    pricingPreset: "spot",
    contractType: "single",
  },
  {
    id: "light",
    name: "AI業務診断（ライト）",
    catchcopy: "どこにAIが使えるかを1週間で洗い出し、優先順位をつける。",
    includes: [
      "ヒアリング（90分×1回、対象部門の担当者）",
      "業務フローの可視化（対象業務を1〜2件に絞る）",
      "AI適性の簡易診断（情報管理・定型度・頻度の3軸）",
      "改善施策の優先順位づけ（効果と工数の2軸）",
      "診断レポート（A4・5〜8枚）の作成と説明会（30分）",
    ],
    hoursMin: 6,
    hoursMax: 10,
    period: "1〜2週間",
    deliverables: [
      "業務フロー図（As-Is）",
      "AI適性診断シート",
      "診断レポート（優先順位つき）",
    ],
    excludes: [
      "ツールの設定・操作代行",
      "プロンプト集などの作成物",
      "診断対象を2件超に広げる場合（別途見積）",
    ],
    priceLo: 50000,
    priceHi: 80000,
    priceNote: "¥50,000〜（税抜）・前払い。対象業務2件以上は ¥80,000〜",
    contractType: "single",
  },
  {
    id: "design",
    name: "業務改善 設計（単発）",
    catchcopy: "やることが決まっているとき、設計図と手順書だけを作る。",
    includes: [
      "対象業務の詳細ヒアリング（120分×1〜2回）",
      "To-Be業務フローの設計（誰が・いつ・何をするか）",
      "必要なプロンプト・テンプレートの設計（本数は内容により5〜15本）",
      "運用ルール（情報の扱い・確認手順・エスカレーション先）の文書化",
      "設計書の納品と説明会（60分）",
    ],
    hoursMin: 15,
    hoursMax: 25,
    period: "3〜4週間",
    deliverables: [
      "To-Be業務フロー図",
      "プロンプト・テンプレート（5〜15本）",
      "運用ルール文書",
      "設計説明会の資料",
    ],
    excludes: [
      "実際の導入作業・設定代行",
      "社員向け研修の実施",
      "納品後の質問対応（別途スポット相談として依頼可）",
    ],
    priceLo: 200000,
    priceHi: 200000,
    priceNote: "¥200,000（税抜）・単発・前払い（入金確認後に着手）",
    contractType: "single",
  },
  {
    id: "intro1m",
    name: "設計＋伴走（1ヶ月）",
    catchcopy: "設計から現場への導入まで、1ヶ月で走り切る。",
    includes: [
      "初週：ヒアリングと現状分析（対象業務1〜2件）",
      "第2週：To-Beフローとプロンプトの設計・作成",
      "第3週：担当者へのレクチャー（90分×2回）と並走での初回実施",
      "第4週：運用の微調整・運用台帳の引き渡し",
      "期間中のチャット質問対応（営業日24時間以内の返信）",
      "週次の進捗報告（15分の電話または文面）",
    ],
    hoursMin: 20,
    hoursMax: 30,
    period: "1ヶ月",
    deliverables: [
      "現状分析メモ",
      "To-Be業務フロー図",
      "プロンプト・テンプレート一式",
      "運用台帳（誰が・いつ・何を確認するか）",
      "導入完了レポート（A4・3〜5枚）",
    ],
    excludes: [
      "対象業務を3件以上に広げる場合（別途見積）",
      "他部門への横展開",
      "社内研修（複数人向けの formal な研修）",
    ],
    priceLo: 150000,
    priceHi: 180000,
    priceNote: "月¥150,000〜（税抜）・前払い。対象2件まで。それ以上は ¥200,000〜",
    pricingPreset: "intro",
    contractType: "1m",
  },
  {
    id: "intensive3m",
    name: "集中伴走（3ヶ月）",
    catchcopy: "複数部門にまたがる導入や、AIリーダーの育成まで踏み込む。",
    includes: [
      "1ヶ月目：全社または2部門以上の現状分析と優先順位づけ",
      "2ヶ月目：優先業務の設計・導入・担当者レクチャー",
      "3ヶ月目：横展開・AIリーダー候補の育成・運用台帳の整備",
      "定例ミーティング（週1回・30分）",
      "期間中のチャット質問対応（営業日24時間以内の返信）",
      "月次レポート（実績・課題・来月の打ち手）",
      "経営層向けの中間報告（2ヶ月目終了時・30分）",
    ],
    hoursMin: 60,
    hoursMax: 100,
    period: "3ヶ月",
    deliverables: [
      "全社／部門別の診断レポート",
      "業務フロー図（As-Is／To-Be）",
      "プロンプト・テンプレート一式",
      "運用台帳と引き継ぎ資料",
      "月次レポート（3回）",
      "最終報告書（A4・10枚程度）",
    ],
    excludes: [
      "システム開発（ツール設定の範囲を超えるもの）",
      "常駐での作業",
      "3ヶ月を超える継続支援（別途「定着サポート」へ）",
    ],
    priceLo: 550000,
    priceHi: 600000,
    priceNote: "¥550,000〜600,000（税抜）・3ヶ月総額・前払い。多部署横断は ¥800,000〜",
    contractType: "3m",
  },
  {
    id: "monthly",
    name: "定着サポート（月額継続）",
    catchcopy: "導入後の「使われなくなる」を防ぐ、軽い伴走。",
    includes: [
      "月1回の定例ミーティング（60分・オンライン）",
      "運用状況の確認と軽いチューニング",
      "チャットでの質問対応（営業日24時間以内の返信）",
      "プロンプトの追加・修正（月5本まで）",
      "月次の簡易レポート（A4・1枚）",
    ],
    hoursMin: 4,
    hoursMax: 8,
    period: "月額継続（1ヶ月単位の自動更新）",
    deliverables: ["月次の簡易レポート", "更新後のプロンプト集"],
    excludes: [
      "新しい業務への導入（別途「設計」または「集中伴走」）",
      "トラブル時の即日対応（翌営業日まで）",
      "社内研修の実施",
    ],
    priceLo: 80000,
    priceHi: 100000,
    priceNote: "月¥80,000〜100,000（税抜）・前払い（当該月の業務開始前まで）。稼働は月8時間まで",
    pricingPreset: "monthly",
    contractType: "monthly",
  },
  {
    id: "training",
    name: "社内研修（半日／1日）",
    catchcopy: "社員が自分でAIを使えるようにするための研修。",
    includes: [
      "事前ヒアリング（60分・受講者のレベルと目的の確認）",
      "研修テキストの作成（貴社の業務例を使った実践形式）",
      "研修の実施（半日3時間、または1日6時間）",
      "演習用のプロンプト集（受講者が持ち帰れるもの）",
      "研修後1週間の質問対応（チャット）",
    ],
    hoursMin: 8,
    hoursMax: 16,
    period: "単発（実施日＋事前準備）",
    deliverables: ["研修テキスト", "演習用プロンプト集", "受講者アンケートの集計結果"],
    excludes: [
      "受講者個別のフォローアップ（別途「定着サポート」で可）",
      "研修動画の撮影・編集",
      "会場の手配（オンラインまたは貴社会議室を使用）",
    ],
    priceLo: 150000,
    priceHi: 250000,
    priceNote: "半日 ¥150,000／1日 ¥250,000（税抜）・前払い（入金確認後に実施日確定）",
    contractType: "single",
  },
];

/* ---------- 推奨ロジック ---------- */

type Ctx = {
  industry: string;
  size: string;
  stage: string; // maturity / gartner
  aiLeader: string; // none | parttime | fulltime
  keywords: string; // 想定課題キーワード
  knownInfo: string; // 事前情報
  hypothesis?: string; // リード由来の課題仮説
};

/** 条件に合うメニューを点数順に返す */
export function scoreMenus(ctx: Ctx): MenuScore[] {
  const text = `${ctx.keywords} ${ctx.knownInfo} ${ctx.hypothesis ?? ""}`.toLowerCase();
  const has = (re: RegExp) => re.test(text);

  return SERVICE_MENU_ITEMS.map((item) => {
    let score = 0;
    const reasons: string[] = [];
    const add = (pt: number, reason: string) => {
      score += pt;
      reasons.push(reason);
    };

    // --- 成熟度との整合 ---
    if (ctx.stage === "Defend") {
      if (item.id === "light") add(30, "現状把握から入るのがこの段階の定石です");
      if (item.id === "spot") add(20, "まず方向性を確認する段階に合います");
      if (item.id === "intensive3m") add(-20, "この段階で3ヶ月伴走は重すぎます");
    }
    if (ctx.stage === "Extend") {
      if (item.id === "intro1m") add(30, "1部署の型を作る段階に合います");
      if (item.id === "design") add(20, "やることが見えているなら設計単発でも足ります");
      if (item.id === "monthly") add(15, "導入済みなら定着サポートが合います");
    }
    if (ctx.stage === "Transform") {
      if (item.id === "intensive3m") add(35, "複数部門・構造改革には3ヶ月単位が必要です");
      if (item.id === "intro1m") add(-10, "1ヶ月では収まりにくい段階です");
    }

    // --- AI推進の担い手 ---
    if (ctx.aiLeader === "none") {
      if (item.id === "intro1m" || item.id === "intensive3m")
        add(10, "旗振り役がいないため、伴走して型を作る必要があります");
      if (item.id === "training")
        add(10, "まず社内に使える人を作る意味で研修が有効です");
    }
    if (ctx.aiLeader === "fulltime") {
      if (item.id === "design") add(10, "専任がいるなら設計だけ渡して内製化も可能です");
      if (item.id === "monthly") add(5, "専任が回せるなら軽い伴走で足ります");
    }

    // --- 規模 ---
    if (ctx.size === "small") {
      if (item.id === "spot" || item.id === "light") add(10, "小規模ならまず小さく始めるのが合います");
      if (item.id === "intensive3m") add(-10, "小規模で3ヶ月伴走は投資が重い可能性があります");
    }
    if (ctx.size === "medium" || ctx.size === "large") {
      if (item.id === "intensive3m") add(5, "部門横断の余地がある規模です");
      if (item.id === "training") add(5, "複数人への研修が成り立つ規模です");
    }

    // --- 課題キーワード ---
    if (has(/研修|勉強会|教育|育成|リテラシー/)) {
      if (item.id === "training") add(30, "「研修・育成」が課題として挙がっています");
    }
    if (has(/属人|引き継|引継|マニュアル|標準化/)) {
      if (item.id === "design" || item.id === "intro1m")
        add(15, "属人化・標準化の課題には設計＋台帳が有効です");
    }
    if (has(/何から|分から|わから|手付かず|これから|未導入|検討中/)) {
      if (item.id === "light" || item.id === "spot")
        add(15, "「何から始めるか」段階なら診断・相談が入口です");
    }
    if (has(/全社|横展開|複数部門|組織|変革|DX/)) {
      if (item.id === "intensive3m") add(15, "全社・複数部門のテーマは3ヶ月伴走の対象です");
    }
    if (has(/継続|定着|形骸|使われて|運用/)) {
      if (item.id === "monthly") add(20, "導入後の定着が課題なら月額サポートが合います");
    }

    // --- 業種の微調整 ---
    if (ctx.industry === "manufacturing" || ctx.industry === "logistics") {
      if (item.id === "design" || item.id === "intro1m")
        add(5, "現場業務の型化がテーマになりやすい業種です");
    }
    if (ctx.industry === "legal" || ctx.industry === "medical") {
      if (item.id === "light")
        add(5, "情報の扱いが慎重な業種のため、まず診断で範囲を区切るのが安全です");
    }

    return { item, score, reasons };
  })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** 推奨メニューの要約文（提案書・見積の「支援内容」に差し込む） */
export function buildMenuProposalText(
  ctx: Ctx & { companyName?: string },
  picked?: ServiceMenuItem,
): string {
  const top = picked ?? scoreMenus(ctx)[0]?.item;
  if (!top) return "";
  const company = ctx.companyName || "貴社";
  const lines: string[] = [];
  lines.push(`■ ご提案する支援メニュー：${top.name}`);
  lines.push("");
  lines.push(`${company}の現状（${ctx.stage ? `段階：${ctx.stage}／` : ""}規模：${ctx.size === "small" ? "小規模" : ctx.size === "medium" ? "中規模" : ctx.size === "large" ? "大規模" : "未設定"}）から見て、以下の内容が合うと考えます。`);
  lines.push("");
  lines.push("【やること（料金に含まれるもの）】");
  top.includes.forEach((t) => lines.push(`・${t}`));
  lines.push("");
  lines.push(`【かかる期間・工数】${top.period}／コンサル側の稼働は約${top.hoursMin}〜${top.hoursMax}時間`);
  lines.push("");
  lines.push("【お渡しするもの】");
  top.deliverables.forEach((d) => lines.push(`・${d}`));
  lines.push("");
  lines.push("【この料金に含まれないもの】");
  top.excludes.forEach((e) => lines.push(`・${e}`));
  lines.push("");
  lines.push(`【料金の目安】${top.priceNote}`);
  lines.push("※ 正式な金額は、ヒアリング後にお見積書でご提示します。");
  return lines.join("\n");
}

/** 見積書の「支援内容」欄に入れる短文版 */
export function buildServiceSummaryText(item: ServiceMenuItem): string {
  const lines: string[] = [];
  lines.push(`■ ${item.name}`);
  lines.push(`（期間：${item.period}／工数の目安：${item.hoursMin}〜${item.hoursMax}時間）`);
  lines.push("");
  lines.push("［含まれるもの］");
  item.includes.forEach((t) => lines.push(`・${t}`));
  lines.push("");
  lines.push("［お渡しするもの］");
  item.deliverables.forEach((d) => lines.push(`・${d}`));
  lines.push("");
  lines.push("［含まれないもの］");
  item.excludes.forEach((e) => lines.push(`・${e}`));
  return lines.join("\n");
}

/** ④単価設計の inputs に反映するための変換 */
export function menuToPricingPatch(item: ServiceMenuItem): {
  hours: number;
  duration: string;
  deliverables: string[];
  projectTitleSuffix: string;
} {
  const hours = Math.round((item.hoursMin + item.hoursMax) / 2);
  const duration =
    item.contractType === "monthly"
      ? "vlong"
      : item.hoursMax <= 10
        ? "short"
        : item.contractType === "3m"
          ? "long"
          : "mid";
  const deliverableMap: Record<string, string> = {
    現状分析: "analysis",
    診断: "analysis",
    レポート: "analysis",
    フロー: "analysis",
    プロンプト: "prompts",
    テンプレート: "prompts",
    研修: "training",
    伴走: "ongoing",
    台帳: "implementation",
    設計: "strategy",
  };
  const keys = new Set<string>();
  item.deliverables.forEach((d) => {
    Object.entries(deliverableMap).forEach(([k, v]) => {
      if (d.includes(k)) keys.add(v);
    });
  });
  if (keys.size === 0) keys.add("analysis");
  return {
    hours,
    duration,
    deliverables: Array.from(keys),
    projectTitleSuffix: item.name,
  };
}
