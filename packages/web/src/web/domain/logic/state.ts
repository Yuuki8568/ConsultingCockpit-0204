// 金庫内 state の生成・後方互換補完。v3 の makeEmptyState / normalizeState を移植。
// v3 JSON をそのまま normalizeVaultState に通せば v4 で開ける。
import { BUILT_IN_TEMPLATES } from "../data/doc-templates";
import type { CaseRecord, LeadRecord, VaultState } from "../types";
import { newId, nowISO } from "./util";

type Any = any;

export function makeEmptyVaultState(): VaultState {
  const s: VaultState = {
    cases: [],
    leads: [],
    leadCounter: 0,
    currentCaseId: null,
    currentLeadId: null,
    currentTab: "setup",
    currentLeadTab: "generate",
    currentMode: "cases",
    profile: {
      name: "山代 悠生",
      yago: "山代業務改善事務所",
      url: "https://yamashirogyomukaizen.com",
      address: "〒107-0061 東京都港区北青山1-3-3 三橋ビル 3階",
      email: "",
      invoice: "",
      bank: "",
    },
    docTemplates: {},
    referrals: [],
    goals: { monthlyEngageTarget: 0, consultToDiag: 50, diagToEngage: 50 },
    salesKpi: {
      targets: { weeklyApproach: 5, weeklyMeeting: 2, monthlyProposal: 2 },
      log: [],
    },
    retentionDays: 0,
  };
  return normalizeVaultState(s);
}

export function makeEmptyCase(companyName = ""): CaseRecord {
  const c = {
    id: newId("C"),
    contractTemplateVersion: undefined,
    createdAt: nowISO(),
    name: companyName,
    settings: {
      companyName,
      industry: "general",
      size: "small",
      role: "manager",
      duration: 45,
      keywords: "",
      knownInfo: "",
      meetingDate: "",
    },
    answers: {},
    icebreakAnswers: {},
    memo: {},
    sheet: null,
    flowAnalysis: null,
    pricing: null,
    execution: null,
    reports: [],
    support: null,
  } as unknown as CaseRecord;
  normalizeCase(c);
  return c;
}

export function makeEmptyLead(): LeadRecord {
  const l = {
    id: newId("L"),
    createdAt: new Date().toISOString().slice(0, 10),
    company: "",
    name: "",
    pattern: 1,
    industry: "",
    dept: "",
    role: "",
    email: "",
    contact: "",
    hypothesis: "",
    status: "pending",
    sentAt: null,
    repliedAt: null,
    sentPattern: null,
    sentSubject: null,
    convertedCaseId: null,
  } as unknown as LeadRecord;
  normalizeLead(l);
  return l;
}

function normalizeLead(l: Any): void {
  if (!l.salesStage) l.salesStage = "approach";
  if (!l.stageEnteredAt) l.stageEnteredAt = l.createdAt || new Date().toISOString();
  if (!l.prepSheet)
    l.prepSheet = {
      companyResearch: "",
      assumedIssues: "",
      keyPerson: "",
      budget: "",
      competitors: "",
      questions: "",
      goal: "",
      nextStepPlan: "",
    };
  if (!l.nextActions) l.nextActions = [];
  if (l.optinBasis === undefined) l.optinBasis = "";
  if (!l.sendLog) l.sendLog = [];
  if (!l.qualification) l.qualification = {};
  if (l.dealValue == null) l.dealValue = 0;
  if (l.winProbability === undefined) l.winProbability = null;
  if (!l.stakeholders) l.stakeholders = [];
  if (l.pattern == null) l.pattern = 1;
  if (!l.status) l.status = "pending";
  if (l.sentAt === undefined) l.sentAt = null;
  if (l.repliedAt === undefined) l.repliedAt = null;
  if (l.sentPattern === undefined) l.sentPattern = null;
  if (l.sentSubject === undefined) l.sentSubject = null;
  if (l.convertedCaseId === undefined) l.convertedCaseId = null;
  // FDE適合確認・営業段階（2026-09-20統合資料。空欄は未確認のまま保持する）
  if (!l.fit || typeof l.fit !== "object")
    l.fit = { items: {}, verdict: "", reason: "", contactApproved: false };
  if (!l.fit.items) l.fit.items = {};
  if (l.fit.verdict === undefined) l.fit.verdict = "";
  if (l.fit.reason === undefined) l.fit.reason = "";
  if (l.fit.contactApproved === undefined) l.fit.contactApproved = false;
  if (l.fdeStage === undefined) l.fdeStage = "";
  // 情報の区別（本人申告/こちらの解釈/未確認）と相談メモの手動貼り付け欄。空欄は未設定のまま
  if (l.infoBasis === undefined) l.infoBasis = "";
  if (l.consultMemo === undefined) l.consultMemo = "";
  // 出典・募集種別・窓口判定・送信状態・返信状態・連絡停止（2026-09-25営業管理強化。空欄は未設定のまま保持する）
  if (!l.sources) l.sources = [];
  if (l.leadKind === undefined) l.leadKind = "";
  if (l.contactFit === undefined) l.contactFit = "";
  if (l.sendState === undefined) l.sendState = "";
  if (l.replyState === undefined) l.replyState = "";
  if (!l.contactStop || typeof l.contactStop !== "object")
    l.contactStop = { stopped: false, reason: "", at: "" };
  if (l.contactStop.stopped === undefined) l.contactStop.stopped = false;
  if (l.contactStop.reason === undefined) l.contactStop.reason = "";
  if (l.contactStop.at === undefined) l.contactStop.at = "";
  // 接触経路・送信本文（ファイル取り込み用。空欄は未設定のまま保持する）
  if (l.channel === undefined) l.channel = "";
  if (l.sentBody === undefined) l.sentBody = "";
}

/**
 * ヒアリングシートを直す。
 * 旧版から持ってきたシートは項目が欠けていることがあるので、
 * 足りないものは埋め、質問が1問もないものは「シートなし」として扱う。
 * （欠けたまま画面に渡すと表示側で落ちる）
 */
function normalizeSheet(c: Any): void {
  if (c.sheet == null) {
    c.sheet = null;
    return;
  }
  const sh = c.sheet;
  if (typeof sh !== "object") {
    c.sheet = null;
    return;
  }
  if (!sh.questions || typeof sh.questions !== "object") {
    c.sheet = null;
    return;
  }
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [cat, list] of Object.entries(sh.questions)) {
    const arr = Array.isArray(list) ? (list as Any[]) : [];
    sh.questions[cat] = arr.map((q, i) => ({
      ...q,
      id: String(q?.id ?? `${cat}_${i + 1}`),
      // 旧版は本文のキーが text だったものもあるため両方を見る
      q: String(q?.q ?? q?.text ?? ""),
      weight: q?.weight && typeof q.weight === "object" ? q.weight : {},
    }));
    counts[cat] = sh.questions[cat].length;
    total += counts[cat];
  }
  if (total === 0) {
    c.sheet = null;
    return;
  }
  sh.counts = sh.counts && typeof sh.counts === "object" ? { ...counts, ...sh.counts } : counts;
  // 個数が合わないときは数え直した値を採る
  for (const k of Object.keys(counts)) {
    if (typeof sh.counts[k] !== "number") sh.counts[k] = counts[k];
  }
  if (typeof sh.totalQuestions !== "number" || sh.totalQuestions <= 0) sh.totalQuestions = total;
  if (typeof sh.duration !== "number" || sh.duration <= 0) {
    sh.duration = Number(c.settings?.duration) || 45;
  }
  if (typeof sh.keywords !== "string") sh.keywords = String(c.settings?.keywords ?? "");
  if (typeof sh.generatedAt !== "string" || !sh.generatedAt) {
    sh.generatedAt = String(c.createdAt ?? new Date().toISOString());
  }
}

/**
 * 業務フロー分析を直す。
 * 旧版の途中状態や、形が変わった結果が入っていることがあるため、
 * 画面が必要とする形になっていないものは「まだ分析していない」として扱う。
 * 入力（inputs）は残すので、③のタブで作り直せる。
 */
function normalizeFlowAnalysis(c: Any): void {
  const fa = c.flowAnalysis;
  if (fa == null || typeof fa !== "object") {
    c.flowAnalysis = null;
    return;
  }
  const r = fa.result;
  const ok =
    r &&
    typeof r === "object" &&
    r.asis &&
    Array.isArray(r.asis.steps) &&
    r.tobe &&
    Array.isArray(r.tobe.steps) &&
    r.gap &&
    typeof r.gap === "object" &&
    typeof r.gap.asisCount === "number";
  if (!ok) delete fa.result;
  if (!fa.inputs && !fa.result) {
    c.flowAnalysis = null;
    return;
  }
  if (Array.isArray(fa.result?.problems) === false && fa.result) fa.result.problems = [];
  if (Array.isArray(fa.result?.measures) === false && fa.result) fa.result.measures = [];
}

/**
 * 単価設計を直す。金額が取り出せない結果は「まだ出していない」として扱う。
 * 入力は残すので、④のタブで作り直せる。
 */
function normalizePricing(c: Any): void {
  const pr = c.pricing;
  if (pr == null || typeof pr !== "object") {
    c.pricing = null;
    return;
  }
  const r = pr.result;
  const ok = r && typeof r === "object" && typeof r.recommended === "number" && r.recommended > 0;
  if (!ok) {
    delete pr.result;
  } else {
    // 旧版の結果は項目が欠けていることがある。数字の欠けは0で埋めて画面が崩れないようにする。
    const nums = [
      "base", "difficultyCoef", "urgencyCoef", "scopeAdd", "paymentAdd", "decisionAdd",
      "riskCoef", "sizeCoef", "expCoef", "deliverableCount", "deliverableAdd",
      "adjusted", "safe", "challenge",
    ];
    for (const k of nums) if (typeof r[k] !== "number" || !Number.isFinite(r[k])) r[k] = 0;
    if (!r.adjusted) r.adjusted = r.recommended;
    if (!r.safe) r.safe = Math.round(r.recommended * 0.85);
    if (!r.challenge) r.challenge = Math.round(r.recommended * 1.2);
  }
  if (!pr.inputs && !pr.result) c.pricing = null;
}

/**
 * 月次報告を直す。
 * 旧版の報告は id や数字が欠けていることがあるため、
 * 並べ替え・削除の目印になる id を必ず持たせ、数字は0で埋める。
 */
function normalizeReports(c: Any): void {
  if (!Array.isArray(c.reports)) {
    c.reports = [];
    return;
  }
  c.reports = c.reports
    .filter((r: Any) => r && typeof r === "object")
    .map((r: Any, i: number) => ({
      ...r,
      id: String(r.id ?? `rep_${i + 1}_${String(c.id ?? "case")}`),
      month: String(r.month ?? "").slice(0, 7),
      highlights: String(r.highlights ?? r.summary ?? ""),
      reductionMin: Number(r.reductionMin) || 0,
      hourlyRate: Number(r.hourlyRate) || 0,
      casesPerMonth: Number(r.casesPerMonth) || 0,
      consultFee: Number(r.consultFee) || 0,
      issues: String(r.issues ?? ""),
      next: String(r.next ?? ""),
      m1: String(r.m1 ?? ""),
      m2: String(r.m2 ?? ""),
      m3: String(r.m3 ?? ""),
      m4: String(r.m4 ?? ""),
      unimplemented: String(r.unimplemented ?? ""),
      timeFour: {
        selfMin: Number(r.timeFour?.selfMin) || 0,
        aiMin: Number(r.timeFour?.aiMin) || 0,
        waitMin: Number(r.timeFour?.waitMin) || 0,
        clientMin: Number(r.timeFour?.clientMin) || 0,
      },
      settlement: {
        providedAt: String(r.settlement?.providedAt ?? ""),
        receivedAt: String(r.settlement?.receivedAt ?? ""),
        confirmDue: String(r.settlement?.confirmDue ?? ""),
        billedAt: String(r.settlement?.billedAt ?? ""),
        dueDate: String(r.settlement?.dueDate ?? ""),
        paidAt: String(r.settlement?.paidAt ?? ""),
        objection: String(r.settlement?.objection ?? ""),
        refundNote: String(r.settlement?.refundNote ?? ""),
      },
      // 月次の振り返り。空欄は未記入のまま保持する
      reflection: {
        hesitated: String(r.reflection?.hesitated ?? ""),
        preDiscovery: String(r.reflection?.preDiscovery ?? ""),
        nextChecks: String(r.reflection?.nextChecks ?? ""),
        unnecessaryRecords: String(r.reflection?.unnecessaryRecords ?? ""),
        burden: String(r.reflection?.burden ?? ""),
        reuse: String(r.reflection?.reuse ?? ""),
      },
    }));
}

/**
 * 作成済み書類を直す。
 * 旧版から来たものは id や書類番号が欠けていることがあるため、
 * 一覧で並べ替え・削除ができる形に揃える。中身（本文）は触らない。
 */
function normalizeGeneratedDocs(c: Any): void {
  if (!Array.isArray(c.generatedDocs)) {
    c.generatedDocs = [];
    return;
  }
  c.generatedDocs = c.generatedDocs
    .filter((g: Any) => g && typeof g === "object")
    .map((g: Any, i: number) => ({
      ...g,
      id: String(g.id ?? `D_${String(c.id ?? "case")}_${i + 1}`),
      docType: String(g.docType ?? g.type ?? ""),
      docNo: String(g.docNo ?? ""),
      issuedAt: String(g.issuedAt ?? g.createdAt ?? "").slice(0, 10),
      content: String(g.content ?? g.body ?? g.text ?? ""),
      status: String(g.status ?? "draft"),
    }));
}

export function normalizeCase(c: Any): void {
  if (!c.settings) c.settings = {};
  const s = c.settings;
  if (!s.companyName) s.companyName = c.name || "";
  if (!s.industry) s.industry = "general";
  if (!s.size) s.size = "small";
  if (!s.role) s.role = "manager";
  if (!s.duration) s.duration = 45;
  if (s.keywords == null) s.keywords = "";
  if (s.knownInfo == null) s.knownInfo = "";
  if (s.meetingDate == null) s.meetingDate = "";
  if (!c.answers) c.answers = {};
  if (!c.memo) c.memo = {};
  if (c.reports == null) c.reports = [];
  if (!Array.isArray(c.recordings)) c.recordings = [];
  normalizeSheet(c);
  normalizeFlowAnalysis(c);
  normalizePricing(c);

  if (!c.legalDocs)
    c.legalDocs = {
      NDA: { status: "todo", signedAt: "", docNo: "" },
      estimate: { status: "todo", signedAt: "", docNo: "" },
      purchaseOrder: { status: "todo", signedAt: "", docNo: "" },
      mainContract: { status: "todo", signedAt: "", docNo: "" },
      aiAddendum: { status: "todo", signedAt: "", docNo: "" },
      dpa: { status: "todo", signedAt: "", docNo: "" },
      deliveryReceipt: { status: "todo", signedAt: "", docNo: "" },
      completionReport: { status: "todo", signedAt: "", docNo: "" },
      disclaimer: { status: "todo", signedAt: "", docNo: "" },
    };
  if (!c.aiClauses)
    c.aiClauses = { hallucination: true, copyright: true, dataProtection: true };
  if (!c.generatedDocs) c.generatedDocs = [];
  if (!c.estimate) c.estimate = { totalIncTax: 0, validUntil: "", issuedAt: "" };
  if (!c.invoice)
    c.invoice = {
      paymentTerm: "前払い（入金確認後に着手）",
      billingDate: "",
      dueDate: "",
      paidFlag: false,
      paidAt: "",
    };
  if (!c.plan) c.plan = "";
  if (!c.icebreakAnswers) c.icebreakAnswers = {};
  if (!c.kanNoMe) c.kanNoMe = { s1: "", s2: "", s3: "", s4: "", s5: "", aiOk: "" };
  if (!c.gartner) c.gartner = { stage: "", aiLeaderExists: "" };
  if (!c.maturity)
    c.maturity = { scores: {}, autoInferred: false, history: [], currentStage: "" };
  if (!c.legalChecklist) c.legalChecklist = { pre: {}, during: {}, post: {}, notes: {} };
  // 旧版から来たものは段階が欠けていることがあるので、必ず4つ揃える
  for (const ph of ["pre", "during", "post", "notes"]) {
    const v = c.legalChecklist[ph];
    if (!v || typeof v !== "object") c.legalChecklist[ph] = {};
  }
  normalizeReports(c);
  normalizeGeneratedDocs(c);
  if (!c.proposalDraft) c.proposalDraft = { sections: {}, lastEdited: "" };
  if (!c.nextActions) c.nextActions = [];
  if (!c.lostReasons) c.lostReasons = [];
  if (!s.timing)
    s.timing = { busy: false, reorg: false, topDown: false, frontlineAware: "" };
  if (!s.kakuyaku)
    s.kakuyaku = { companyAddress: "", representative: "", harassmentContact: "" };
  const k = s.kakuyaku;
  if (k.representativeTitle === undefined) k.representativeTitle = "代表取締役";
  if (k.contact === undefined) k.contact = "";
  if (k.contactDept === undefined) k.contactDept = "";
  if (k.contactTitle === undefined) k.contactTitle = "";
  if (k.contactEmail === undefined) k.contactEmail = "";
  if (k.contactPhone === undefined) k.contactPhone = "";
  if (k.website === undefined) k.website = "";
  if (k.industryLabel === undefined) k.industryLabel = "";
  if (k.sizeLabel === undefined) k.sizeLabel = "";

  if (c.execution) {
    const ex = c.execution;
    if (!ex.contractType) ex.contractType = "";
    if (!ex.tasks) ex.tasks = [];
    if (!ex.graduationChecks)
      ex.graduationChecks = {
        promptDelivered: false,
        autorunCompleted: false,
        opsLedgerRunning: false,
      };
    if (!ex.kpi)
      ex.kpi = { reductionBefore: 0, reductionAfter: 0, autorunRate: 0, reworkCount: 0 };
    if (!ex.deliverables)
      ex.deliverables = [
        { name: "プロンプト集", status: "todo", deliveredAt: "" },
        { name: "手順書", status: "todo", deliveredAt: "" },
        { name: "チェックリスト", status: "todo", deliveredAt: "" },
        { name: "運用台帳", status: "todo", deliveredAt: "" },
      ];
    if (!ex.pillowChecks)
      ex.pillowChecks = { p1: false, p2: false, p3: false, p4: false, p5: false };
    if (!ex.threeJoys) ex.threeJoys = { make: false, sell: false, buy: false };
    if (!ex.kiku) ex.kiku = { kiku1NumGoal: "", kiku2Suitability: "", kiku3OpsLog: "" };
    // FDE: 構築4段階・実行状態・承認台帳・変更/事故
    if (!ex.buildStages)
      ex.buildStages = {
        s1: { status: "todo", agreedAt: "", note: "" },
        s2: { status: "todo", agreedAt: "", note: "" },
        s3: { status: "todo", agreedAt: "", note: "" },
        s4: { status: "todo", agreedAt: "", note: "" },
      };
    for (const k of ["s1", "s2", "s3", "s4"]) {
      if (!ex.buildStages[k])
        ex.buildStages[k] = { status: "todo", agreedAt: "", note: "" };
    }
    if (!Array.isArray(ex.runItems)) ex.runItems = [];
    // 試験記録の確認者・未実施理由（空欄は未確認のまま。実施済みに読み替えない）
    ex.runItems = ex.runItems
      .filter((x: Any) => x && typeof x === "object")
      .map((x: Any) => ({
        ...x,
        verifier: String(x.verifier ?? ""),
        untestedReason: String(x.untestedReason ?? ""),
      }));
    if (!Array.isArray(ex.approvals)) ex.approvals = [];
    if (!Array.isArray(ex.incidents)) ex.incidents = [];
  }
  // FDE商品区分・個別仕様・価格状態（未入力は空のまま。0を勝手に確定値にしない）
  if (!c.fde || typeof c.fde !== "object") {
    c.fde = {
      productKind: "",
      scopeStart: "",
      scopeEnd: "",
      dataSources: "",
      targetCount: "",
      countLimit: "",
      exceptionLimit: "",
      testScope: "",
      dueNote: "",
      clientOwner: "",
      clientProxy: "",
      proposalAmount: 0,
      contractAmount: 0,
      priceStatus: "",
    };
  }
  if (c.fde.productKind === undefined) c.fde.productKind = "";
  if (c.fde.proposalAmount == null) c.fde.proposalAmount = 0;
  if (c.fde.contractAmount == null) c.fde.contractAmount = 0;
  if (c.fde.priceStatus === undefined) c.fde.priceStatus = "";
  // FDE受注条件チェック（②）。空欄は未確認のまま
  if (!c.fdeFit || typeof c.fdeFit !== "object") c.fdeFit = {};
  if (c.fdeFitReason === undefined) c.fdeFitReason = "";
  if (c.fdeFitCost === undefined) c.fdeFitCost = "";
  if (c.fdeFitManual === undefined) c.fdeFitManual = "";
  // 案件の状態。空欄は未設定のまま（進行中と読み替えて保存はしない）
  if (c.status === undefined) c.status = "";
  // 三方良しレビュー（⑩）。全項目任意・空欄は未設定のまま
  if (!c.sanpo || typeof c.sanpo !== "object") c.sanpo = {};
  for (const k of [
    "target", "customerValue", "officeCondition", "stakeholderImpact",
    "basis", "concerns", "toConfirm",
    "statusCustomer", "statusOffice", "statusStakeholder",
    "compareKeep", "compareReuse", "compareNew",
    "nextCandidate", "nextReason", "nextCheckDate",
    "reviewDate", "reviewResult",
  ]) {
    if (c.sanpo[k] === undefined) c.sanpo[k] = "";
  }
  if (c.support) {
    const sp = c.support;
    if (!sp.scope) sp.scope = { included: [], excluded: [] };
    if (!sp.meetings) sp.meetings = [];
    if (!sp.graduationActions)
      sp.graduationActions = { summary1page: "", nextProposal: "", referralRequest: "" };
    if (!sp.roadmap)
      sp.roadmap = {
        m1: { milestone: "", achieved: false, date: "" },
        m3: { milestone: "", achieved: false, date: "" },
        m6: { milestone: "", achieved: false, date: "" },
        m12: { milestone: "", achieved: false, date: "" },
      };
    if (!sp.contract)
      sp.contract = {
        startDate: "",
        endDate: "",
        monthlyFee: 0,
        autoRenew: "1m",
        noticeDays: 30,
        billingDay: "",
      };
    if (!sp.contract.autoRenew) sp.contract.autoRenew = "1m";
    if (sp.contract.billingDay === undefined) sp.contract.billingDay = "";
    if (sp.contract.noticeDays == null) sp.contract.noticeDays = 30;
    // FDE: 次月選択・依存先変更・安全期限・移管/終了票
    if (!sp.nextMonthChoice)
      sp.nextMonthChoice = { choice: "", agreedAt: "", note: "" };
    if (!Array.isArray(sp.dependencyChanges)) sp.dependencyChanges = [];
    if (sp.safetyDeadline === undefined) sp.safetyDeadline = "";
    if (!sp.handover)
      sp.handover = {
        docVersion: "",
        clientCopy: "",
        rights: "",
        manualTraining: "",
        outstanding: "",
        deletion: "",
      };
  }
  // ③の運用設計（人/AI分担・データ経路・承認点・停止/手動切替）
  if (c.flowAnalysis && typeof c.flowAnalysis === "object") {
    if (!c.flowAnalysis.opsDesign)
      c.flowAnalysis.opsDesign = {
        humanAiSplit: "",
        dataPath: "",
        approvalPoints: "",
        stopManual: "",
      };
  }
  // ④の継続価値比較（A/F）
  if (c.pricing && typeof c.pricing === "object") {
    if (!c.pricing.af)
      c.pricing.af = {
        alternative: 0,
        alternativeNote: "",
        fee: 0,
        clientBurden: 0,
        extraCost: 0,
      };
  }
}

/**
 * 知見台帳を直す。空欄は未設定のまま保持し、
 * 承認済み・審査済みへの自動変換はしない。
 */
function normalizeKnowledge(state: Any): void {
  if (!Array.isArray(state.knowledge)) {
    state.knowledge = [];
    return;
  }
  state.knowledge = state.knowledge
    .filter((k: Any) => k && typeof k === "object")
    .map((k: Any, i: number) => ({
      ...k,
      id: String(k.id ?? `kn_${i + 1}`),
      title: String(k.title ?? ""),
      kind: String(k.kind ?? "質問"),
      problem: String(k.problem ?? ""),
      generalized: String(k.generalized ?? ""),
      conditions: String(k.conditions ?? ""),
      exclusions: String(k.exclusions ?? ""),
      basis: String(k.basis ?? ""),
      confirmedScope: String(k.confirmedScope ?? ""),
      unconfirmedScope: String(k.unconfirmedScope ?? ""),
      rightsReview: String(k.rightsReview ?? ""),
      rightsNote: String(k.rightsNote ?? ""),
      version: String(k.version ?? ""),
      approvedBy: String(k.approvedBy ?? ""),
      approvedAt: String(k.approvedAt ?? ""),
      reviewDue: String(k.reviewDue ?? ""),
      state: String(k.state ?? "候補"),
      publish: String(k.publish ?? "非公開"),
      appliedRefs: Array.isArray(k.appliedRefs)
        ? k.appliedRefs
            .filter((r: Any) => r && typeof r === "object")
            .map((r: Any) => ({
              caseId: String(r.caseId ?? ""),
              version: String(r.version ?? ""),
              reason: String(r.reason ?? ""),
              at: String(r.at ?? ""),
            }))
        : [],
      createdAt: String(k.createdAt ?? new Date().toISOString()),
      updatedAt: String(k.updatedAt ?? new Date().toISOString()),
    }));
}

/**
 * サービス台帳を直す。空欄は未設定のまま保持し、
 * 提供能力を自動で「確認済み」に変換しない。
 */
function normalizeServices(state: Any): void {
  if (!Array.isArray(state.services)) {
    state.services = [];
    return;
  }
  state.services = state.services
    .filter((s: Any) => s && typeof s === "object")
    .map((s: Any, i: number) => ({
      ...s,
      id: String(s.id ?? `sv_${i + 1}`),
      createdAt: String(s.createdAt ?? new Date().toISOString()),
      name: String(s.name ?? ""),
      code: String(s.code ?? ""),
      targetWork: String(s.targetWork ?? ""),
      deliverables: String(s.deliverables ?? ""),
      technologies: String(s.technologies ?? ""),
      unavailConditions: String(s.unavailConditions ?? ""),
      requiredMaterials: String(s.requiredMaterials ?? ""),
      standardProcess: String(s.standardProcess ?? ""),
      effortConditions: String(s.effortConditions ?? ""),
      revisionScope: String(s.revisionScope ?? ""),
      maintenanceScope: String(s.maintenanceScope ?? ""),
      sampleUrl: String(s.sampleUrl ?? ""),
      capability: String(s.capability ?? ""),
      pricingInputs: String(s.pricingInputs ?? ""),
    }));
}

/** v3/v4 どちらの JSON でも読める形に整える。破壊的変更はしない（既存値は保護）。 */
export function normalizeVaultState(input: Any): VaultState {
  const state: Any = input && typeof input === "object" ? input : {};
  if (!Array.isArray(state.cases)) state.cases = [];
  if (!Array.isArray(state.leads)) state.leads = [];
  if (state.leadCounter == null) state.leadCounter = 0;
  if (!state.currentMode) state.currentMode = "cases";
  if (!state.currentTab) state.currentTab = "setup";
  if (!state.currentLeadTab) state.currentLeadTab = "generate";
  if (state.currentCaseId === undefined) state.currentCaseId = null;
  if (state.currentLeadId === undefined) state.currentLeadId = null;

  state.leads.forEach(normalizeLead);

  if (!state.salesKpi)
    state.salesKpi = {
      targets: { weeklyApproach: 5, weeklyMeeting: 2, monthlyProposal: 2 },
      log: [],
    };
  if (!state.salesKpi.targets)
    state.salesKpi.targets = { weeklyApproach: 5, weeklyMeeting: 2, monthlyProposal: 2 };
  if (!Array.isArray(state.salesKpi.log)) state.salesKpi.log = [];
  if (!Array.isArray(state.salesKpi.effort)) state.salesKpi.effort = [];

  if (!state.profile)
    state.profile = {
      name: "山代 悠生",
      yago: "山代業務改善事務所",
      url: "https://yamashirogyomukaizen.com",
      address: "〒107-0061 東京都港区北青山1-3-3 三橋ビル 3階",
      email: "",
      invoice: "",
      bank: "",
    };
  // 表記統一: 屋号は「山代業務改善事務所」で統一（旧「KokoroInkArt」「Yuuki Yamashiro」表記は寄せる）
  if (state.profile.yago === "KokoroInkArt" || state.profile.yago === "Yuuki Yamashiro")
    state.profile.yago = "山代業務改善事務所";
  if (state.profile.name === "山城 悠生") state.profile.name = "山代 悠生";
  // 住所: 未設定の金庫には新事務所の所在地を初期値として入れる（設定済みの値は保護）
  if (state.profile.address === "" || state.profile.address == null)
    state.profile.address = "〒107-0061 東京都港区北青山1-3-3 三橋ビル 3階";
  // ポートフォリオURL: 旧ドメイン（yuuki-yamashiro-portfolio.com）が残っている金庫は新ドメインに寄せる
  if (
    typeof state.profile.url === "string" &&
    state.profile.url.includes("yuuki-yamashiro-portfolio.com")
  )
    state.profile.url = "https://yamashirogyomukaizen.com";

  // 書類雛形：空のものだけ組込雛形で初期値化（編集済みは保護）
  if (!state.docTemplates) state.docTemplates = {};
  Object.keys(BUILT_IN_TEMPLATES).forEach((key) => {
    const cur = state.docTemplates[key];
    if (!cur || String(cur).trim() === "") {
      state.docTemplates[key] = (BUILT_IN_TEMPLATES as Any)[key];
    }
  });

  if (!Array.isArray(state.referrals)) state.referrals = [];
  if (!state.goals)
    state.goals = { monthlyEngageTarget: 0, consultToDiag: 50, diagToEngage: 50 };
  if (state.retentionDays == null) state.retentionDays = 0;

  // 自社管理（オフィスモード）: 共通時間・AI費用・容量の月次記録
  if (!state.office || typeof state.office !== "object") state.office = { months: {} };
  if (!state.office.months || typeof state.office.months !== "object")
    state.office.months = {};

  // 知見台帳（横断）
  normalizeKnowledge(state);

  // 提供可能サービスの台帳（リード⑤。本人が編集する正本）
  normalizeServices(state);

  state.cases.forEach(normalizeCase);
  return state as VaultState;
}

/** 組込雛形を強制的に再読込（ユーザー編集を上書きする。明示操作でのみ呼ぶ） */
export function reloadBuiltInTemplates(state: VaultState): void {
  Object.keys(BUILT_IN_TEMPLATES).forEach((key) => {
    state.docTemplates[key] = (BUILT_IN_TEMPLATES as Any)[key];
  });
}

/** 取り込むファイルの上限（約20MB）。これを超えるものは受け付けない。 */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * 取り込んだ JSON から、仕掛けに使われる特別なキーを取り除く。
 *
 * JSON の中に "__proto__" などのキーが混ざっていると、
 * 読み込んだ側の土台となる決まり（オブジェクトの原型）を書き換えられる恐れがある。
 * 中身は変えず、これらのキーだけ落とす。
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function stripDangerousKeys(value: Any, depth = 0): Any {
  if (depth > 64) return undefined;
  if (Array.isArray(value)) return value.map((v) => stripDangerousKeys(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Any = Object.create(null);
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = stripDangerousKeys((value as Any)[k], depth + 1);
    }
    // 通常のオブジェクトに戻す
    return Object.assign({}, out);
  }
  return value;
}

/** JSON を安全に読み取る（大きさの上限つき・特別なキーは落とす） */
function parseImportJson(raw: string): { ok: true; st: Any } | { ok: false; error: string } {
  if (raw.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "ファイルが大きすぎます（上限 約20MB）" };
  }
  let parsed: Any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "JSON として読み取れませんでした" };
  }
  parsed = stripDangerousKeys(parsed);
  const st = parsed && parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
  if (!st || typeof st !== "object") {
    return { ok: false, error: "中身がオブジェクトではありません" };
  }
  return { ok: true, st };
}

export interface ImportPreview {
  ok: boolean;
  error?: string;
  cases: number;
  leads: number;
  templates: number;
  referrals: number;
  generatedDocs: number;
  reports: number;
}

/** Reject ambiguous identities before normalization or any storage mutation. */
export function assertUniqueImportIds(st: { cases?: unknown; leads?: unknown }): void {
  for (const name of ["cases", "leads"] as const) {
    const rows = st[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`${name} は配列で指定してください`);
    const ids = new Set<string>();
    for (const row of rows) {
      const id = row && typeof row === "object" ? row.id : undefined;
      if (typeof id !== "string" || !id.trim() || id.includes("__conflict") || id.length > 59)
        throw new Error(`${name}: 不正または空のIDがあります`);
      if (ids.has(id)) throw new Error(`${name}: 重複IDがあります。取込は中止しました`);
      ids.add(id);
    }
  }
}

/** v3 バックアップ JSON の検証＋件数プレビュー */
export function previewImport(raw: string): ImportPreview {
  const empty: ImportPreview = {
    ok: false,
    cases: 0,
    leads: 0,
    templates: 0,
    referrals: 0,
    generatedDocs: 0,
    reports: 0,
  };
  // v3 のエクスポートは { state: {...} } / 生 state のどちらもあり得る
  const res = parseImportJson(raw);
  if (!res.ok) return { ...empty, error: res.error };
  const st = res.st;
  try { assertUniqueImportIds(st); } catch (e) { return { ...empty, error: String(e) }; }
  if (!Array.isArray(st.cases) && !Array.isArray(st.leads))
    return { ...empty, error: "cases も leads も見つかりません（別形式のファイルの可能性）" };
  const cases: Any[] = Array.isArray(st.cases) ? st.cases : [];
  const leads: Any[] = Array.isArray(st.leads) ? st.leads : [];
  return {
    ok: true,
    cases: cases.length,
    leads: leads.length,
    templates: st.docTemplates ? Object.keys(st.docTemplates).length : 0,
    referrals: Array.isArray(st.referrals) ? st.referrals.length : 0,
    generatedDocs: cases.reduce(
      (a, c) => a + (Array.isArray(c.generatedDocs) ? c.generatedDocs.length : 0),
      0,
    ),
    reports: cases.reduce((a, c) => a + (Array.isArray(c.reports) ? c.reports.length : 0), 0),
  };
}

/** 検証済み JSON を読み込んで正規化した state を返す */
export function importVaultState(raw: string): VaultState {
  const res = parseImportJson(raw);
  if (!res.ok) throw new Error(res.error);
  assertUniqueImportIds(res.st);
  return normalizeVaultState(res.st);
}
