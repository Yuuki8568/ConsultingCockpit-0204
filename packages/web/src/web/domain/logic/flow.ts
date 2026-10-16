// 元アプリ v3 の業務フロー解析ロジックを移植（アルゴリズムは同一・型付けのみ追加）
import {
  ACTOR_KEYWORDS,
  MANUAL_KEYWORDS,
  TIME_ESTIMATES,
  TRANSFORM_RULES,
  FLOW_MATERIAL_MAP,
  FLOW_MATERIAL_HINT,
} from "../data/flow-pricing";
import type {
  AsIsResult,
  AsIsStep,
  CaseRecord,
  FlowAnalysisResult,
  FlowInputs,
  GapResult,
  Measure,
  ToBeResult,
  ToBeStep,
} from "../types";

type Any = any;

/**
 * 入力テキストを工程の並びに変換する。
 *
 * 【v3 からの修正】buildFlowDefaults が作る下書きには
 * 「【時間が取られる業務】」のような見出しだけの行が入る。
 * v3 はこれを工程として数えていたため、見出し4本ぶんが
 * 「変換できない工程」として残り、削減率が実際より低く出ていた。
 * 見出しだけの行（全体が【】で囲まれ、中身が続かない行）は工程として数えない。
 */
export function parseSteps(text: string): string[] {
  return (text || '')
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean)
    // 見出しだけの行を落とす
    .filter((l: string) => !/^[【［[][^】］\]]{1,30}[】］\]]$/.test(l))
    .map((l: string) => l.replace(/^[・\-●*◆◇▪►▸→\d]+[.）、:：\s)]?\s*/, ''))
    // 行頭に付いた見出しラベルは残す（痛みの分類として意味があるため）
    .filter((l: string) => l.length >= 2);
}

export function extractActor(step: string): string {
  const paren = step.match(/[（(]([^（）()]+)[）)]/);
  if (paren && paren[1].length <= 12) return paren[1];
  for (const a of ACTOR_KEYWORDS) if (step.includes(a)) return a;
  return '';
}

export function isManualStep(step: string): boolean { return MANUAL_KEYWORDS.some(k => step.includes(k)); }
export function estimateTime(step: string, isAuto: boolean): number {
  if (isAuto) return TIME_ESTIMATES.auto_system;
  if (/電話/.test(step)) return TIME_ESTIMATES.manual_phone;
  if (/FAX|ファックス/.test(step)) return TIME_ESTIMATES.manual_fax;
  if (/転記|手入力/.test(step)) return TIME_ESTIMATES.manual_transcribe;
  if (/紙|手書き|記入/.test(step)) return TIME_ESTIMATES.manual_paper;
  if (/問い合わせ|対応/.test(step)) return TIME_ESTIMATES.manual_inquiry;
  if (isManualStep(step)) return TIME_ESTIMATES.manual_generic;
  return TIME_ESTIMATES.semi;
}



export function escapeMermaidLabel(text: string): string {
  return (text || '').replace(/[[\](){}"`]/g, '').replace(/\|/g, '／').slice(0, 30);
}

export function buildAsIs(data: FlowInputs): AsIsResult {
  const steps = parseSteps(data.flowText);
  const painLines = parseSteps(data.painPoints);
  const painKeywords: string[] = [];
  painLines.forEach((p: string) => { const ks = p.match(/[ぁ-んァ-ヶー一-龯]{2,8}/g); if (ks) painKeywords.push(...ks); });
  const asisSteps = steps.map((raw, i) => {
    const actor = extractActor(raw);
    const manual = isManualStep(raw);
    const time = estimateTime(raw, false);
    const isBottleneck = manual || painKeywords.some(k => k.length >= 2 && raw.includes(k));
    const cleanLabel = raw.replace(/[（(][^（）()]+[）)]/g, '').trim();
    const label = actor ? `${cleanLabel}：${actor}` : cleanLabel;
    return { id:'A'+i, raw, label:escapeMermaidLabel(label), actor, manual, time, isBottleneck };
  });
  return { steps: asisSteps, painLines };
}

export function prioritizeRules(rules: Any[], c: CaseRecord | null): Any[] {
  const d4 = (c && c.answers && c.answers.D4) ? c.answers.D4 : '';
  let weights: Record<string, number> = { '[RPA]':1, '[AI]':1, '[システム]':1 };
  if (/速さ|スピード|早/.test(d4)) weights = { '[RPA]':3, '[AI]':2, '[システム]':1 };
  else if (/精度|品質|正確|ミス/.test(d4)) weights = { '[AI]':3, '[RPA]':2, '[システム]':1 };
  else if (/コスト|安く|費用/.test(d4)) weights = { '[システム]':3, '[RPA]':2, '[AI]':1 };
  // 重い順にソート（元の順序は維持）
  return rules.slice().sort((a,b) => (weights[b.tag]||1) - (weights[a.tag]||1));
}

export function buildToBe(asisSteps: AsIsStep[], data: FlowInputs, caseCtx: CaseRecord | null): ToBeResult {
  const allowed = new Set<string>(data.options);
  const measures = new Set<string>();
  const tobeSteps: ToBeStep[] = [];
  const rules = caseCtx ? prioritizeRules(TRANSFORM_RULES, caseCtx) : TRANSFORM_RULES;
  asisSteps.forEach((s: AsIsStep, idx: number) => {
    let transformed: Any = null;
    for (const rule of rules) {
      if (rule.match.test(s.raw) && allowed.has(rule.need)) { transformed = rule; break; }
    }
    if (transformed) {
      const baseLabel = transformed.to + transformed.tag;
      tobeSteps.push({
        id:'B'+idx, label:escapeMermaidLabel(baseLabel), type:transformed.tag,
        time: transformed.tag === '[AI]' ? TIME_ESTIMATES.auto_ai
            : transformed.tag === '[RPA]' ? TIME_ESTIMATES.auto_rpa : TIME_ESTIMATES.auto_system,
        auto: true, sourceIdx: idx
      });
      measures.add(`${transformed.to}による「${s.raw.slice(0, 22)}」の自動化`);
    } else {
      tobeSteps.push({
        id:'B'+idx, label:escapeMermaidLabel(s.label + '（判断業務）'),
        type:'[人]', time:TIME_ESTIMATES.semi, auto:false, sourceIdx:idx
      });
    }
  });
  // 連続自動ステップの統合
  const merged: ToBeStep[] = [];
  let buffer: ToBeStep[] = [];
  const flushBuffer = () => {
    if (buffer.length >= 3) {
      const totalTime = buffer.reduce((s, x) => s + x.time, 0);
      merged.push({ id:'B'+merged.length+'_m', label:escapeMermaidLabel(`一括自動処理${buffer[0].type}`),
        type:buffer[0].type, time:totalTime, auto:true, merged:true });
      measures.add('連続する自動処理を1ワークフローに統合');
    } else { buffer.forEach(x => merged.push(x)); }
    buffer = [];
  };
  tobeSteps.forEach((s) => {
    if (s.auto && (buffer.length === 0 || buffer[0].type === s.type)) buffer.push(s);
    else { flushBuffer(); if (s.auto) buffer.push(s); else merged.push(s); }
  });
  flushBuffer();
  merged.forEach((s, i) => { s.id = 'B' + i; });
  return { steps: merged, measures: Array.from(measures) };
}

export function buildMermaidAsIs(asis: AsIsResult): string {
  const lines = ['flowchart TD'];
  asis.steps.forEach((s, i) => {
    lines.push(`    ${s.id}["${s.label}"]`);
    if (i > 0) lines.push(`    ${asis.steps[i-1].id} --> ${s.id}`);
  });
  asis.steps.forEach(s => {
    lines.push(s.isBottleneck
      ? `    style ${s.id} fill:#D97757,color:#fff,stroke:#a8553e`
      : `    style ${s.id} fill:#7B8FA8,color:#fff,stroke:#5e7188`);
  });
  return lines.join('\n');
}

export function buildMermaidToBe(tobe: ToBeResult): string {
  const lines = ['flowchart TD'];
  tobe.steps.forEach((s, i) => {
    lines.push(`    ${s.id}["${s.label}"]`);
    if (i > 0) lines.push(`    ${tobe.steps[i-1].id} --> ${s.id}`);
  });
  tobe.steps.forEach(s => {
    lines.push(s.auto
      ? `    style ${s.id} fill:#4A9D8E,color:#fff,stroke:#357a6e`
      : `    style ${s.id} fill:#C9A961,color:#fff,stroke:#9c8044`);
  });
  return lines.join('\n');
}

export function calculateGap(asis: AsIsResult, tobe: ToBeResult, data: FlowInputs): GapResult {
  const asisCount = asis.steps.length;
  const tobeCount = tobe.steps.length;
  const asisTime = asis.steps.reduce((s, x) => s + x.time, 0);
  const tobeTime = tobe.steps.reduce((s, x) => s + x.time, 0);
  const asisManualCount = asis.steps.filter(s => s.manual).length;
  const tobeManualCount = tobe.steps.filter(s => !s.auto).length;
  const asisManualRate = asisCount ? Math.round((asisManualCount / asisCount) * 100) : 0;
  const tobeManualRate = tobeCount ? Math.round((tobeManualCount / tobeCount) * 100) : 0;
  const asisDept = data.deptCount;
  const tobeDept = Math.max(1, Math.ceil((asisDept * (tobeManualRate / Math.max(asisManualRate, 1))) || asisDept * 0.5));
  const pct = (a: number, b: number) => a > 0 ? Math.round(((a - b) / a) * 100) : 0;
  return {
    asisCount, tobeCount, stepReduction: pct(asisCount, tobeCount),
    asisDept, tobeDept, deptReduction: pct(asisDept, tobeDept),
    asisTime, tobeTime, timeReduction: pct(asisTime, tobeTime),
    asisManualRate, tobeManualRate, manualDelta: asisManualRate - tobeManualRate,
    asisMistakeLevel: asisManualRate > 50 ? '高' : asisManualRate > 25 ? '中' : '低',
    tobeMistakeLevel: tobeManualRate > 30 ? '中' : '低'
  };
}

export function generateFlowMeasures(asis: AsIsResult, _tobe: ToBeResult, data: FlowInputs, caseCtx: CaseRecord | null): Measure[] {
  const measures: Measure[] = [];
  let no = 1;
  // ===== ヒアリング回答A3（経営注力）から、優先テーマを抽出 =====
  const a3 = (caseCtx && caseCtx.answers && caseCtx.answers.A3) ? caseCtx.answers.A3 : '';
  const boostThemes: string[] = [];
  if (/売上|拡大|成長|新規顧客/.test(a3)) boostThemes.push('売上');
  if (/コスト|削減|効率|無駄/.test(a3)) boostThemes.push('コスト');
  if (/人材|採用|定着|離職|働き方/.test(a3)) boostThemes.push('人材');
  // D1（成功イメージ）からも追加
  const d1 = (caseCtx && caseCtx.answers && caseCtx.answers.D1) ? caseCtx.answers.D1 : '';
  if (/売上|拡大/.test(d1) && !boostThemes.includes('売上')) boostThemes.push('売上');
  if (/コスト/.test(d1) && !boostThemes.includes('コスト')) boostThemes.push('コスト');
  asis.steps.forEach((s) => {
    for (const rule of TRANSFORM_RULES) {
      if (rule.match.test(s.raw) && data.options.includes(rule.need)) {
        const tool = rule.tag === '[AI]' ? 'ChatGPT / Claude / Gemini'
                   : rule.tag === '[RPA]' ? 'UiPath / Power Automate'
                   : 'kintone / Salesforce / Notion';
        const cost = rule.tag === '[AI]' ? '月3千〜2万円'
                   : rule.tag === '[RPA]' ? '初期30万＋月数万' : '月1〜10万円';
        const effort = rule.tag === '[AI]' ? '低' : '中';
        const effect = s.isBottleneck ? '高' : '中';
        measures.push({
          no: no++, name: `${rule.to}による「${s.raw.slice(0,18)}」改善`,
          effect, effort, tool, cost,
          priority: (effect === '高' && effort === '低') ? 'P1' : (effect === '高') ? 'P2' : (effort === '低') ? 'P2' : 'P3'
        });
        break;
      }
    }
  });
  if (data.direction.includes('属人化解消'))
    measures.push({ no:no++, name:'マニュアル動画化＋ナレッジDB化', effect:'中', effort:'低', tool:'Notion / Loom', cost:'月数千円', priority:'P1' });
  if (data.direction.includes('顧客満足度向上'))
    measures.push({ no:no++, name:'顧客ステータス可視化ポータル', effect:'中', effort:'中', tool:'kintone / Bubble', cost:'月数万円', priority:'P2' });
  if (data.direction.includes('コスト削減'))
    measures.push({ no:no++, name:'紙・郵送・FAX費用の完全廃止', effect:'中', effort:'低', tool:'クラウドサイン / freee', cost:'月数千円', priority:'P1' });
  const uniq: Measure[] = [];
  const seen = new Set<string>();
  measures.forEach((m) => { if (!seen.has(m.name)) { seen.add(m.name); uniq.push(m); } });
  const order: Record<string, number> = { 'P1':1, 'P2':2, 'P3':3 };
  // 経営注力テーマ(boostThemes)に合致する施策にブーストフラグ付与
  uniq.forEach((m) => {
    const txt = m.name;
    m._boost = boostThemes.some(t => {
      if (t === '売上') return /顧客|チャットボット|応対|満足/.test(txt);
      if (t === 'コスト') return /紙|郵送|FAX|廃止|統合|集計/.test(txt);
      if (t === '人材') return /マニュアル|属人|ナレッジ|動画|定型/.test(txt);
      return false;
    });
  });
  // 優先度 → ブースト → 元順 でソート
  uniq.sort((a, b) => {
    const po = order[a.priority] - order[b.priority];
    if (po !== 0) return po;
    return (b._boost?1:0) - (a._boost?1:0);
  });
  uniq.forEach((m, i) => { m.no = i + 1; if (m._boost) m.name = '⭐ ' + m.name; delete m._boost; });
  return uniq;
}

export function generateAsIsProblems(asis: AsIsResult): string[] {
  const problems: string[] = [];
  asis.painLines.slice(0, 5).forEach((p) => problems.push(p));
  const manualCount = asis.steps.filter(s => s.manual).length;
  if (manualCount >= 2) problems.push(`手作業ステップが${manualCount}件あり、ヒューマンエラーの温床になっている`);
  const bnCount = asis.steps.filter(s => s.isBottleneck).length;
  if (bnCount >= 1) problems.push(`ボトルネックと推定される工程が${bnCount}件存在（オレンジ表示）`);
  if (asis.steps.length >= 6) problems.push(`総工程数${asis.steps.length}件で部門間引き継ぎの工数が大きい`);
  if (problems.length === 0) problems.push('特筆すべき問題点は検出されませんでした（ヒアリング内容を追加で確認推奨）');
  return problems.slice(0, 8);
}

export function buildFlowDefaults(c: CaseRecord): FlowInputs {
  const s: Any = c.settings || {};
  const answers: Any = c.answers || {};
  const memo: Any = c.memo || {};

  // ===== flowText: B系（現状業務）+ A5（変化で生まれた隙間）を構造化 =====
  const flowParts: string[] = [];
  if (answers.B1) flowParts.push(`【時間が取られる業務】\n${answers.B1}`);
  if (answers.B7) flowParts.push(`【判断不要な定型作業】\n${answers.B7}`);
  if (answers.B10) flowParts.push(`【繁閑差・年中行事化した負荷】\n${answers.B10}`);
  if (answers.A5) flowParts.push(`【組織変化で業務に隙間】\n${answers.A5}`);
  const flowText = flowParts.join('\n\n');

  // ===== painPoints: 痛みカテゴリを構造化 =====
  const painParts: string[] = [];
  if (answers.B2) painParts.push(`【属人化】${answers.B2}`);
  if (answers.B3) painParts.push(`【部門連携の壁】${answers.B3}`);
  if (answers.B8) painParts.push(`【ミス・手戻り】${answers.B8}`);
  if (answers.B9) painParts.push(`【情報散乱】${answers.B9}`);
  if (answers.B6) painParts.push(`【現場の声】${answers.B6}`);
  if (answers.B4) painParts.push(`【残業負荷】${answers.B4}`);
  if (answers.A2) painParts.push(`【人手不足の部署】${answers.A2}`);
  // アイスブレイク回答で反映フラグONかつ5文字超のもの
  const ibAns: Any = c.icebreakAnswers || {};
  const ibUsed: number[] = [];
  Object.keys(ibAns).forEach((k) => {
    const ib = ibAns[k];
    if (ib && ib.useInFlow && ib.text && String(ib.text).trim().length > 5) {
      painParts.push(`【アイスブレイクから（雑談で得た気づき）】${ib.text}`);
      ibUsed.push(parseInt(k)+1);
    }
  });
  const painPoints = painParts.join('\n');

  // ===== direction（改善方向性）: 回答キーワードから自動推定（アイスブレイク反映分も含む） =====
  const ibTextForDir = Object.values(ibAns).filter((x: Any) => x && x.useInFlow).map((x: Any) => x.text||'').join(' ');
  const allTxt = Object.values(answers).join(' ') + ' ' + (s.keywords||'') + ' ' + ibTextForDir;
  const direction: string[] = [];
  if (/時間|工数|残業|ため息|クタクタ|繁忙|スピード|遅い|遅延/.test(allTxt)) direction.push('時間短縮');
  if (/属人化|ベテラン|辞め|退職|引継|個人|頭の中/.test(allTxt)) direction.push('属人化解消');
  if (/ミス|手戻り|間違|不良|品質|チェック|お詫び/.test(allTxt)) direction.push('ミス削減');
  if (/コスト|費用|予算|安く|経費|削減/.test(allTxt)) direction.push('コスト削減');
  if (/顧客|お客|満足|クレーム|対応/.test(allTxt)) direction.push('顧客満足度向上');
  if (/負担|疲弊|モヤモヤ|げんなり|イライラ|やる気/.test(allTxt)) direction.push('従業員負担軽減');
  if (/AI|DX|デジタル|自動化|システム化|データ活用/.test(allTxt)) direction.push('DX化推進');
  // 何も検出されなかったらデフォルト
  if (direction.length === 0) direction.push('時間短縮', 'ミス削減', 'DX化推進');

  // ===== options（AI/RPA/クラウド/開発）: C系から判定 =====
  const options: string[] = [];
  // C2: AI活用状況。「使ってる」「試してみた」があればAI継続OK
  if (!answers.C2 || /使|試|導入|展開|活用/.test(answers.C2 || '')) options.push('AI');
  else if (!/禁止|NG|不可/.test(answers.C2)) options.push('AI');
  // RPAはほぼ常時OK（既存システムが多いほど価値）
  if (!/RPA禁止|RPA不可/.test(allTxt)) options.push('RPA');
  // C7: クラウド方針
  if (!answers.C7 || !/NG|不可|禁止|オンプレ志向|規制で制約/.test(answers.C7 || '')) options.push('クラウド');
  // C5: IT部門あり → 開発OK
  if (answers.C5 && /専任|あり|部署/.test(answers.C5) && !/不在|外部委託のみ/.test(answers.C5)) options.push('開発');
  if (options.length === 0) options.push('AI', 'RPA', 'クラウド');

  // ===== deptCount: A2から部署数推定 =====
  let deptCount = 3;
  if (answers.A2) {
    const m = answers.A2.match(/[営業製造管理開発総務人事経理財務店舗倉庫マーケ広報企画調達]+/g);
    if (m) deptCount = Math.min(10, Math.max(1, m.length));
  }

  // ===== constraints: D5（ハードル）+ E3（予算）から =====
  const constraintsParts: string[] = [];
  if (answers.D5) constraintsParts.push(answers.D5.slice(0, 80));
  if (answers.E3) constraintsParts.push(`予算感: ${answers.E3.slice(0, 60)}`);
  if (memo.budget) constraintsParts.push(`予算メモ: ${memo.budget.slice(0, 60)}`);
  const constraints = constraintsParts.join(' / ');

  // ===== existingSystem: C1から =====
  const existingSystem = answers.C1 ? answers.C1.slice(0, 200) : '';

  // ===== taskName: 課題キーワード優先、なければA1（重点取組）から =====
  let taskName = '';
  if (s.keywords) {
    taskName = s.keywords.split(/[,、]/)[0].trim() + '改善';
  } else if (answers.A1) {
    // A1の最初の名詞らしき語を抽出
    const m = answers.A1.match(/[ぁ-んァ-ヶー一-龯]{2,10}/);
    if (m) taskName = m[0] + '改善';
  }

  return {
    taskName,
    industry: ({ general:'その他', manufacturing:'製造業', retail:'小売業', service:'サービス業',
                it:'IT', medical:'医療', legal:'士業', finance:'その他',
                construction:'その他', logistics:'その他', education:'教育' } as Any)[s.industry] || 'その他',
    deptCount,
    direction,
    flowText,
    painPoints,
    options,
    constraints,
    existingSystem,
    /** 透明性パネル用：どの回答からどう推定されたかの記録 */
    _hearingDerivation: {
      flowSources: ['B1','B7','B10','A5'].filter(k => answers[k]),
      painSources: ['B2','B3','B8','B9','B6','B4','A2'].filter(k => answers[k]),
      icebreakUsed: ibUsed,  // 反映ONかつ5文字超のアイスブレイク番号配列（[1,2]等）
      directionSource: direction,
      optionsSource: { C2: !!answers.C2, C5: !!answers.C5, C7: !!answers.C7 },
      deptSource: !!answers.A2,
      taskSource: s.keywords ? 'keywords' : (answers.A1 ? 'A1' : 'none'),
      constraintSource: [answers.D5?'D5':null, answers.E3?'E3':null, memo.budget?'memo.budget':null].filter(Boolean),
      systemSource: !!answers.C1
    }
  };
}

export function calcFlowCoverage(c: CaseRecord | null): Any {
  const a: Any = (c && c.answers) || {};
  // シートに選出されている質問idのSetを作成
  const inSheet = new Set<string>();
  if (c && c.sheet && c.sheet.questions) {
    Object.values(c.sheet.questions).forEach((arr: Any) => arr.forEach((q: Any) => inSheet.add(q.id)));
  }
  const result: Any = {};
  let totalFilled = 0, totalNeeded = 0;
  const missing: string[] = [];
  Object.keys(FLOW_MATERIAL_MAP).forEach((catKey) => {
    const def = (FLOW_MATERIAL_MAP as Any)[catKey];
    // シートに含まれる対象のみカウント。シート未生成時は全対象を使う（フォールバック）
    const relevantKeys: string[] = inSheet.size > 0 ? def.keys.filter((k: string) => inSheet.has(k)) : def.keys;
    const filled = relevantKeys.filter((k) => a[k] && String(a[k]).trim().length > 5).length;
    const notFilled = relevantKeys.filter((k) => !a[k] || String(a[k]).trim().length <= 5);
    result[catKey] = {
      label: def.label,
      filled,
      total: relevantKeys.length,
      pct: relevantKeys.length > 0 ? Math.round(filled/relevantKeys.length*100) : 100,
      missingKeys: notFilled
    };
    totalFilled += filled;
    totalNeeded += relevantKeys.length;
    notFilled.forEach((k) => missing.push((FLOW_MATERIAL_HINT as Any)[k] || k));
  });
  result.overall = {
    filled: totalFilled,
    total: totalNeeded,
    pct: totalNeeded > 0 ? Math.round(totalFilled/totalNeeded*100) : 100,
    missing,
    sheetGenerated: inSheet.size > 0
  };
  return result;
}

/** ③業務フロー分析 の実行本体（v3 runFlowAnalysis の計算部分のみ） */
export function runFlowAnalysis(
  inputs: FlowInputs,
  caseCtx: CaseRecord | null,
): FlowAnalysisResult {
  const asis = buildAsIs(inputs);
  const tobe = buildToBe(asis.steps, inputs, caseCtx);
  const gap = calculateGap(asis, tobe, inputs);
  const measures = generateFlowMeasures(asis, tobe, inputs, caseCtx);
  const problems = generateAsIsProblems(asis);
  return {
    asis,
    tobe,
    gap,
    measures,
    problems,
    mermaidAsIs: buildMermaidAsIs(asis),
    mermaidToBe: buildMermaidToBe(tobe),
  };
}
