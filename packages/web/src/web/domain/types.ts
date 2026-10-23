// Consulting Cockpit v4 — 金庫内データモデル
// このファイルの型は「暗号化して保存される平文」の形。サーバーには届かない。

export type Mode = "cases" | "leads" | "office";
export type CaseTab =
  | "setup"
  | "sheet"
  | "flow"
  | "pricing"
  | "memo"
  | "execution"
  | "report"
  | "support"
  | "legal"
  | "sanpo";
export type LeadTab = "generate" | "list" | "dashboard" | "process" | "services";

export type LeadStatus = "pending" | "sent" | "replied" | "meeting" | "converted" | "lost";
export type SalesStage =
  | "approach"
  | "firstMeeting"
  | "proposal"
  | "quote"
  | "closing"
  | "won";
export type FunnelStatus =
  | "consult_booked"
  | "consult_done"
  | "diagnosed"
  | "engaged"
  | "lost";
export type DocStatus = "todo" | "sent" | "signed" | "na";
export type MaturityStage = "" | "Defend" | "Extend" | "Transform";

/** FDE商品区分（2026-09-20統合資料の商品体系。内部提案値で公開料金ではない） */
export type FdeProductKind =
  | ""
  | "diagnosis"
  | "build"
  | "monthly"
  | "change"
  | "inspection";

/** ①案件設定に持たせるFDE個別仕様・価格状態・責任分担 */
export interface FdeProfile {
  productKind: FdeProductKind;
  /** 個別仕様: 業務の起点・終点 */
  scopeStart: string;
  scopeEnd: string;
  dataSources: string;
  /** 対象件数・上限・例外数・試験範囲（診断後に数値で確定するまで未確定のままにする） */
  targetCount: string;
  countLimit: string;
  exceptionLimit: string;
  testScope: string;
  dueNote: string;
  /** 顧客側の責任者と代行者 */
  clientOwner: string;
  clientProxy: string;
  /** 価格状態: 提案額と契約額を分ける。0=未入力 */
  proposalAmount: number;
  contractAmount: number;
  priceStatus: "" | "hypothesis" | "proposed" | "agreed";
  /** 情報利用条件（この案件で使ってよい情報の範囲） */
  dataUseTerms?: string;
  /** 利用する基準の版（知見・雛形の版を固定する） */
  basisVersions?: string;
  /** 共通メタ: 版・確認者・変更理由・適用期間・根拠 */
  version?: string;
  confirmedBy?: string;
  changeReason?: string;
  validFrom?: string;
  validTo?: string;
  basis?: string;
}

/** 一つの仕事の実行状態（資料4.3の候補11状態） */
export type RunState =
  | "draft"
  | "inputMissing"
  | "ready"
  | "running"
  | "checking"
  | "awaitingApproval"
  | "awaitingDelivery"
  | "done"
  | "failed"
  | "safeStopped"
  | "closed";

export interface RunItem {
  id: string;
  title: string;
  state: RunState;
  updatedAt: string;
  note: string;
  /** 担当（実行者。AI・人のどちらが動かすか） */
  owner?: string;
  /** 入力識別子（どの入力データか） */
  inputRef?: string;
  /** 設定版（試験の対象基準版） */
  configVersion?: string;
  /** 期待結果 */
  expected?: string;
  /** 実結果（未確認は空欄のまま） */
  actual?: string;
  /** 証拠（保存先・記録の参照。秘密情報そのものは入れない） */
  evidence?: string;
  /** 確認者（実行者と分ける。空欄は未確認） */
  verifier?: string;
  /** 未実施理由（未実施を合格にしない。実施済みなら空欄） */
  untestedReason?: string;
}

/** 承認台帳。重要操作は承認者・内容・宛先・金額・版・有効条件を固定する */
export interface ApprovalEntry {
  id: string;
  operation: string;
  approver: string;
  /** 対象内容・宛先・金額・対象版 */
  target: string;
  validCondition: string;
  approvedAt: string;
  /** 承認後に内容が変わったか（変われば再承認） */
  changedAfter: boolean;
  /** 実行結果（未実行は空欄のまま。空欄を承認済みと読み替えない） */
  result: string;
  createdAt: string;
}

/** 変更・事故の記録 */
export interface IncidentEntry {
  id: string;
  foundAt: string;
  impact: string;
  causeHypothesis: string;
  stopped: boolean;
  action: string;
  retest: string;
  costNote: string;
  status: "open" | "fixed" | "closed";
  /** 責任の所在の検討（断定しない） */
  responsibility?: string;
  /** 証拠（保存先・記録の参照。秘密情報そのものは入れない） */
  evidence?: string;
}

/** 限定構築の4段階（S1仕様/S2試作/S3検証/S4引渡し） */
export interface BuildStage {
  status: "todo" | "doing" | "done";
  agreedAt: string;
  note: string;
}

/** 月次報告の給付・精算分離。提供・受領・確認期限・請求・支払期日・入金を分ける */
export interface Settlement {
  providedAt: string;
  receivedAt: string;
  confirmDue: string;
  billedAt: string;
  dueDate: string;
  paidAt: string;
  objection: string;
  refundNote: string;
}

/** 月次の時間4区分（分）。本人実働だけが月100時間の対象 */
export interface TimeFour {
  selfMin: number;
  aiMin: number;
  waitMin: number;
  clientMin: number;
}

export interface Profile {
  name: string;
  yago: string;
  url: string;
  address: string;
  email: string;
  invoice: string;
  bank: string;
}

export interface Kakuyaku {
  companyAddress: string;
  representative: string;
  representativeTitle: string;
  harassmentContact: string;
  contact: string;
  contactDept: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  industryLabel: string;
  sizeLabel: string;
}

export interface Timing {
  busy: boolean;
  reorg: boolean;
  topDown: boolean;
  frontlineAware: string;
}

export interface CaseSettings {
  companyName: string;
  industry: string;
  size: string;
  /** 面談相手の層: executive | manager | frontline | mixed */
  role: string;
  /** 面談時間（分） */
  duration: number;
  keywords: string;
  knownInfo: string;
  meetingDate: string;
  timing: Timing;
  kakuyaku: Kakuyaku;
  [k: string]: unknown;
}

export interface SheetQuestion {
  id: string;
  q: string;
  weight: Record<string, number>;
  intent?: string;
  edited?: boolean;
  [k: string]: unknown;
}

export interface Sheet {
  totalQuestions: number;
  duration: number;
  questions: Record<string, SheetQuestion[]>;
  counts: Record<string, number>;
  keywords: string;
  generatedAt: string;
}

export interface IcebreakAnswer {
  text: string;
  useInFlow: boolean;
}

export interface FlowInputs {
  taskName: string;
  industry: string;
  deptCount: number;
  direction: string[];
  flowText: string;
  painPoints: string;
  options: string[];
  constraints: string;
  existingSystem: string;
  _hearingDerivation?: Record<string, unknown>;
}

export interface AsIsStep {
  id: string;
  raw: string;
  label: string;
  actor: string;
  manual: boolean;
  time: number;
  isBottleneck: boolean;
}

export interface ToBeStep {
  id: string;
  label: string;
  type: string;
  time: number;
  auto: boolean;
  sourceIdx?: number;
  merged?: boolean;
}

export interface AsIsResult {
  steps: AsIsStep[];
  painLines: string[];
}
export interface ToBeResult {
  steps: ToBeStep[];
  measures: string[];
}

export interface GapResult {
  asisCount: number;
  tobeCount: number;
  stepReduction: number;
  asisDept: number;
  tobeDept: number;
  deptReduction: number;
  asisTime: number;
  tobeTime: number;
  timeReduction: number;
  asisManualRate: number;
  tobeManualRate: number;
  manualDelta: number;
  asisMistakeLevel: string;
  tobeMistakeLevel: string;
}

export interface Measure {
  no: number;
  name: string;
  effect: string;
  effort: string;
  tool: string;
  cost: string;
  priority: "P1" | "P2" | "P3";
  _boost?: boolean;
}

/** 業務フロー解析の結果（v3 JSON では case.flowAnalysis.result に入る） */
export interface FlowAnalysisResult {
  asis: AsIsResult;
  tobe: ToBeResult;
  gap: GapResult;
  measures: Measure[];
  problems: string[];
  mermaidAsIs: string;
  mermaidToBe: string;
}

/** 運用設計: 人/AIの分担、データ経路、承認点、停止・手動切替 */
export interface OpsDesign {
  humanAiSplit: string;
  dataPath: string;
  approvalPoints: string;
  stopManual: string;
}

export interface FlowAnalysis {
  inputs?: FlowInputs;
  result?: FlowAnalysisResult;
  analyzedAt?: string;
  opsDesign?: OpsDesign;
}

export interface PricingInputs {
  projectTitle: string;
  hours: number;
  baseline: number;
  difficulty: number;
  urgency: string;
  clientSize: string;
  experience: string;
  scopeRisk: string;
  payment: string;
  decisionMakers: string;
  deliverables: string[];
  duration: string;
  industry: string;
  domains: number;
  competitor: number;
  hoursFromFlow?: boolean;
  [k: string]: unknown;
}

export interface PricingResult {
  base: number;
  difficultyCoef: number;
  urgencyCoef: number;
  scopeAdd: number;
  paymentAdd: number;
  decisionAdd: number;
  riskCoef: number;
  sizeCoef: number;
  expCoef: number;
  deliverableCount: number;
  deliverableAdd: number;
  adjusted: number;
  safe: number;
  recommended: number;
  challenge: number;
}

export interface PricingAlert {
  title: string;
  body: string;
}

/** 継続価値の比較。A=最良代替の全管理費用、F=料金+顧客残存負担+追加費 */
export interface AfComparison {
  /** Aの金額（0=未判定） */
  alternative: number;
  /** Aの根拠（どの代替案か、範囲・品質・停止条件） */
  alternativeNote: string;
  /** Fの内訳: 当事務所料金・顧客に残る管理負担・追加継続費 */
  fee: number;
  clientBurden: number;
  extraCost: number;
}

/** ④単価設計で選んだ支援メニュー（サービス内容の正本） */
export interface ServiceMenuPick {
  menuId: string;
  pickedAt: string;
}

export interface Task {
  id: string;
  name: string;
  owner: string;
  due: string;
  status: "todo" | "inprogress" | "done" | string;
  doneAt?: string;
  note: string;
}

export interface Execution {
  contractType: string;
  contractStart?: string;
  contractEnd?: string;
  tasks: Task[];
  kpi: {
    reductionBefore: number;
    reductionAfter: number;
    autorunRate: number;
    reworkCount: number;
  };
  deliverables: { name: string; status: string; deliveredAt: string; version?: string }[];
  graduationChecks: {
    promptDelivered: boolean;
    autorunCompleted: boolean;
    opsLedgerRunning: boolean;
  };
  pillowChecks: Record<string, boolean>;
  threeJoys: { make: boolean; sell: boolean; buy: boolean };
  kiku: { kiku1NumGoal: string; kiku2Suitability: string; kiku3OpsLog: string };
  /** 限定構築の4段階（normalizeで必ず初期化される） */
  buildStages: Record<"s1" | "s2" | "s3" | "s4", BuildStage>;
  /** 一つの仕事の実行状態（11状態。normalizeで必ず初期化される） */
  runItems: RunItem[];
  /** 承認台帳（normalizeで必ず初期化される） */
  approvals: ApprovalEntry[];
  /** 変更・事故の記録（normalizeで必ず初期化される） */
  incidents: IncidentEntry[];
  [k: string]: unknown;
}

export interface MonthlyReport {
  id: string;
  month: string;
  highlights: string;
  /** 1件あたり削減分数 */
  reductionMin: number;
  hourlyRate: number;
  casesPerMonth: number;
  consultFee: number;
  issues: string;
  next: string;
  /** 月次成果物M1〜M4 */
  m1?: string;
  m2?: string;
  m3?: string;
  m4?: string;
  /** 未実施・限定実施・未確認の明示（空欄を正常に読み替えない） */
  unimplemented?: string;
  /** 時間4区分（normalizeで必ず初期化される） */
  timeFour: TimeFour;
  /** 給付・精算の分離（normalizeで必ず初期化される） */
  settlement: Settlement;
  /** 月次の振り返り（すべての例外を知見化しない。件数ノルマは設けない。normalizeで必ず初期化される） */
  reflection: {
    /** 確認に迷った箇所 */
    hesitated: string;
    /** 事前に発見できたか */
    preDiscovery: string;
    /** 次回追加する確認 */
    nextChecks: string;
    /** 不要だった記録 */
    unnecessaryRecords: string;
    /** 記録の負担増 */
    burden: string;
    /** 再利用可否 */
    reuse: string;
  };
  [k: string]: unknown;
}

export interface SupportMeeting {
  id: string;
  date: string;
  topic: string;
  decided: string;
  next: string;
}

/** 次月の選択。継続・縮小・低頻度化・内製・他社移管・終了を明示的に合意する */
export interface NextMonthChoice {
  choice: "" | "continue" | "shrink" | "lowfreq" | "inhouse" | "transfer" | "end";
  agreedAt: string;
  note: string;
}

/** 依存先（外部サービス・権限）の変更記録 */
export interface DependencyChange {
  id: string;
  at: string;
  source: string;
  impact: string;
  action: string;
}

/** 移管・終了票 */
export interface Handover {
  docVersion: string;
  clientCopy: string;
  rights: string;
  manualTraining: string;
  outstanding: string;
  deletion: string;
}

export interface Support {
  contract: {
    startDate: string;
    endDate: string;
    monthlyFee: number;
    autoRenew: string;
    noticeDays: number;
    billingDay: string;
    [k: string]: unknown;
  };
  meetings: SupportMeeting[];
  scope: { included: string[]; excluded: string[] };
  graduationActions: {
    summary1page: string;
    nextProposal: string;
    referralRequest: string;
  };
  roadmap: Record<string, { milestone: string; achieved: boolean; date: string }>;
  nextThemes?: string;
  /** 次月の選択（明示合意がないのに自動受注・請求へ進めない。normalizeで必ず初期化される） */
  nextMonthChoice: NextMonthChoice;
  /** 依存先変更の記録（normalizeで必ず初期化される） */
  dependencyChanges: DependencyChange[];
  /** 安全確認の期限 */
  safetyDeadline?: string;
  /** 移管・終了票（normalizeで必ず初期化される） */
  handover: Handover;
  [k: string]: unknown;
}

export interface NextAction {
  id: string;
  text: string;
  due: string;
  done: boolean;
  doneAt?: string;
  source?: string;
  snoozedTo?: string;
}

export interface GeneratedDoc {
  id: string;
  docType: string;
  docNo: string;
  issuedAt: string;
  content: string;
  status: "draft" | "issued" | string;
}

export interface LegalDocEntry {
  status: DocStatus;
  signedAt: string;
  docNo: string;
}

export interface Maturity {
  scores: Record<string, string>;
  autoInferred: boolean;
  history: { at: string; scores: Record<string, string>; stage: string; avg: number }[];
  currentStage: MaturityStage;
}

export interface CaseRecord {
  id: string;
  createdAt: string;
  updatedAt?: string;
  settings: CaseSettings;
  answers: Record<string, string>;
  icebreakAnswers: Record<string, IcebreakAnswer>;
  memo: Record<string, string>;
  sheet: Sheet | null;
  flowAnalysis: FlowAnalysis | null;
  pricing: {
    inputs?: PricingInputs;
    result?: PricingResult;
    calculatedAt?: string;
    /** 選んだ支援メニュー（④の「このメニューを積算に反映」で入る） */
    menuPick?: ServiceMenuPick;
    /** 継続価値の比較（A/F） */
    af?: AfComparison;
  } | null;
  execution: Execution | null;
  reports: MonthlyReport[];
  support: Support | null;
  plan: string;
  kanNoMe: Record<string, string>;
  gartner: { stage: string; aiLeaderExists: string };
  maturity: Maturity;
  legalDocs: Record<string, LegalDocEntry>;
  legalChecklist: {
    pre: Record<string, boolean>;
    during: Record<string, boolean>;
    post: Record<string, boolean>;
    notes: Record<string, string>;
  };
  aiClauses: { hallucination: boolean; copyright: boolean; dataProtection: boolean };
  generatedDocs: GeneratedDoc[];
  estimate: { totalIncTax: number; validUntil: string; issuedAt: string };
  invoice: {
    paymentTerm: string;
    billingDate: string;
    dueDate: string;
    paidFlag: boolean;
    paidAt: string;
  };
  proposalDraft: { sections: Record<string, string>; lastEdited: string };
  nextActions: NextAction[];
  lostReasons: { at: string; tag: string; note: string }[];
  leadId?: string;
  /** FDE商品区分・個別仕様・価格状態・責任分担 */
  fde?: FdeProfile;
  /** FDE受注条件の7項目チェック（ok/ng/unknown の3値。空欄は未確認） */
  fdeFit?: Record<string, string>;
  fdeFitReason?: string;
  /** 顧客の現行管理費・承認負担（A/F比較の材料） */
  fdeFitCost?: string;
  /** 手動代替の可否 */
  fdeFitManual?: string;
  /** 三方良しレビュー（⑩）。判断補助の記録で、自動判定・合計点は付けない */
  sanpo: SanpoReview;
  /** ⑩三方良しへの自動転記の記録（④見積確定など）。values は前回自動で入れた文面で、手直し後の再上書きを防ぐために使う */
  sanpoAuto?: {
    at: string;
    source: string;
    fields: string[];
    values: Record<string, string>;
  };
  /** 案件の状態: ""(未設定=進行中として扱う) / active / paused / done / lost。空欄を進行中に読み替えて保存はしない */
  status?: CaseStatus;
  /** 面談の録画・録音の台帳。本体はこの端末の IndexedDB に暗号化して置き、ここには属性だけを持つ */
  recordings?: RecordingMeta[];
  [k: string]: unknown;
}

/** 面談の録画・録音の属性。ファイル本体は含まない（端末ローカルの暗号化チャンクとして別保管） */
export interface RecordingMeta {
  /** 大容量原本は保管せず、選択されたファイルから直接読む */
  sourceOnly?: boolean;
  transcription?: import("../lib/transcription/checkpoint").TranscriptionCheckpoint;
  id: string;
  /** 元のファイル名 */
  name: string;
  /** バイト数 */
  size: number;
  mimeType: string;
  kind: "video" | "audio";
  addedAt: string;
  /** 再生時間（秒）。取れないときは undefined のまま */
  durationSec?: number;
  /** 暗号化チャンク数 */
  chunkCount: number;
  /** メモ（どの面談か等） */
  note: string;
  /** 録画・録音の同意を得た日。空欄は未取得 */
  consentAt: string;
  /** 文字起こしの元ファイル名（貼り付けのときは空欄） */
  transcriptName: string;
  /** 文字起こし本文（タイムスタンプ除去済みの平文） */
  transcript: string;
  transcriptAt: string;
  transcriptReview?: import("../lib/transcription/review").TranscriptReview;
}

export type CaseStatus = "" | "active" | "paused" | "done" | "lost";

/** 三方良しレビュー（⑩タブ）。全項目任意・空欄は「未設定」のまま残す */
export interface SanpoReview {
  /** 対象となる提案（案件・対象業務・提案版） */
  target: string;
  /** 顧客にとっての価値と負担 */
  customerValue: string;
  /** 自事務所として続けられる条件（工数・実行能力・余力・保守範囲） */
  officeCondition: string;
  /** 現場・取引先への影響（減る仕事・増える仕事・誤りの影響） */
  stakeholderImpact: string;
  /** 根拠と不明点（確認済み・観察・推測を分ける） */
  basis: string;
  /** 懸念と対応案 */
  concerns: string;
  /** 次に確認したいこと */
  toConfirm: string;
  /** 各視点の状態: ""(未設定) / unconfirmed / concern / confirmed。合計点は付けない */
  statusCustomer: string;
  statusOffice: string;
  statusStakeholder: string;
  /** 提案の比較メモ（現状維持 / 既存活用 / 新規制作） */
  compareKeep: string;
  compareReuse: string;
  compareNew: string;
  /** 次の行動の候補（本人が理由を残して選ぶ） */
  nextCandidate: string;
  nextReason: string;
  nextCheckDate: string;
  /** 導入後の振り返り */
  reviewDate: string;
  reviewResult: string;
}

export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  stance: string;
  note: string;
}

export interface PrepSheet {
  companyResearch: string;
  assumedIssues: string;
  keyPerson: string;
  budget: string;
  competitors: string;
  questions: string;
  goal: string;
  nextStepPlan: string;
}

/** 出典（公開情報の根拠）。URL・ページ題名・根拠抜粋・確認日を1セットで保持する */
export interface LeadSource {
  id: string;
  url: string;
  pageTitle: string;
  /** 必要最小限の根拠抜粋 */
  excerpt: string;
  /** 確認日 YYYY-MM-DD */
  confirmedAt: string;
}

/** 窓口判定。空欄は未設定。「禁止の記載が見つからない」を受付可と読み替えない */
export type ContactFit = "" | "accepted" | "prohibited" | "unknown";
/** 送信状態。案件段階・返信状態とは分離する。結果不明は自動再送しない */
export type SendState = "" | "draft" | "sent" | "failed" | "unknown";
/** 返信状態。拒否・停止要請を受けたら連絡停止とセットで記録する */
export type ReplyState = "" | "none" | "replied" | "refused";

/** 募集種別。雇用求人は課題仮説の参考情報で、外注ニーズとは区別する。空欄は未設定 */
export type LeadKind = "" | "outsourcing" | "partnership" | "jobPosting" | "hpInquiry" | "other";

/** 連絡停止（企業単位で扱い、同じ企業の全リードに継承表示する） */
export interface ContactStop {
  stopped: boolean;
  reason: string;
  /** 停止を記録した日 YYYY-MM-DD */
  at: string;
}

/**
 * 提供可能サービスの台帳（本人が編集する正本）。
 * 料金式は既存の価格プリセットを再利用し、営業側に別の料金式を作らない。
 * 未登録・能力未確認の作業を「対応可能」と約束しないための照合元。
 */
export interface ServiceRecord {
  id: string;
  createdAt: string;
  /** サービス名 */
  name: string;
  /** サービスID（料金計算との照合用コード） */
  code: string;
  /** 対象業務 */
  targetWork: string;
  /** 成果物 */
  deliverables: string;
  /** 使用技術 */
  technologies: string;
  /** 対応不能条件 */
  unavailConditions: string;
  /** 必要資料 */
  requiredMaterials: string;
  /** 標準工程 */
  standardProcess: string;
  /** 工数条件 */
  effortConditions: string;
  /** 修正範囲 */
  revisionScope: string;
  /** 保守範囲 */
  maintenanceScope: string;
  /** 見本URL */
  sampleUrl: string;
  /** 提供能力の確認状況。空欄は未設定 */
  capability: "" | "confirmed" | "unconfirmed";
  /** 料金計算への入力項目 */
  pricingInputs: string;
}

/** v3 のフィールド名をそのまま維持（v3 JSON をそのまま取り込めるようにするため） */
export interface LeadRecord {
  id: string;
  createdAt: string;
  updatedAt?: string;
  company: string;
  name: string;
  pattern: number;
  industry: string;
  dept: string;
  role: string;
  email: string;
  /** 接点・きっかけ（公開情報など） */
  contact: string;
  /** 課題仮説 */
  hypothesis: string;
  status: LeadStatus;
  sentAt: string | null;
  repliedAt: string | null;
  sentPattern: number | null;
  sentSubject: string | null;
  convertedCaseId: string | null;
  funnelStatus?: FunnelStatus;
  salesStage: SalesStage;
  stageEnteredAt: string;
  prepSheet: PrepSheet;
  nextActions: NextAction[];
  optinBasis: string;
  sendLog: { at: string; kind: string }[];
  qualification: Record<string, number>;
  dealValue: number;
  winProbability: number | null;
  stakeholders: Stakeholder[];
  lostReason?: { tag: string; note: string; at: string } | null;
  source?: string;
  /** FDE適合確認（資料2章の7項目。ok/ng/unknown の3値。空欄は未確認） */
  fit?: {
    items: Record<string, string>;
    verdict: "" | "fit" | "unfit" | "undecided";
    reason: string;
    /** 接触（送信）の承認 */
    contactApproved: boolean;
  };
  /** FDE営業段階: 適合確認/診断受注/構築受注/月次試行/有料継続 */
  fdeStage?: "" | "fit" | "diagnosis" | "build" | "trial" | "retained";
  /** 情報の区別: 本人申告/こちらの解釈/未確認。空欄は未設定。サイトの選択回答だけで受注可と判定しない */
  infoBasis?: "" | "declared" | "interpretation" | "unconfirmed";
  /** 相談メモの手動貼り付け欄（専用インポートは作らない） */
  consultMemo?: string;
  /** 出典（URL・ページ題名・根拠抜粋・確認日）。事実・推測・未確認の分離の土台 */
  sources?: LeadSource[];
  /** 募集種別。雇用求人は外注ニーズと区別する。空欄は未設定 */
  leadKind?: LeadKind;
  /** 窓口判定: 受付明示あり/禁止・用途不一致/不明。空欄は未設定 */
  contactFit?: ContactFit;
  /** 送信状態（案件段階とは分離。結果不明は自動再送しない） */
  sendState?: SendState;
  /** 返信状態（拒否・停止要請は連絡停止とセットで記録） */
  replyState?: ReplyState;
  /** 連絡停止（企業単位で扱い、同じ企業の全リードに継承表示する） */
  contactStop?: ContactStop;
  /** 接触経路（こちらから送った場合のみ）。空欄は未設定。相手からの問い合わせは leadKind=hpInquiry で扱う */
  channel?: "" | "email" | "form";
  /** 送信した本文の記録（取り込み時・手動記録用） */
  sentBody?: string;
  [k: string]: unknown;
}

export interface SalesKpi {
  targets: { weeklyApproach: number; weeklyMeeting: number; monthlyProposal: number };
  log: { week: string; approach: number; meeting: number; proposal: number }[];
  /** 営業工数（分）の月次記録。受注済み売上と期待売上を分けて見るための土台 */
  effort?: { month: string; minutes: number }[];
}

export interface Referral {
  id: string;
  from: string;
  to: string;
  at: string;
  status: string;
  note: string;
}

export interface Goals {
  monthlyEngageTarget: number;
  consultToDiag: number;
  diagToEngage: number;
}

/** 自社管理（オフィスモード）の月次記録。共通時間・AI費用・容量の計画と実績 */
export interface OfficeMonth {
  /** 共通の本人実働（分）。発信・営業・経理・保守・見直しの合計 */
  commonSelfMin: number;
  /** 共通のAI稼働（分）。月100時間には含めない */
  commonAiMin: number;
  /** AI等の純増費（円・その月） */
  aiCost: number;
  note: string;
  /** 容量判定の計画入力（時間）。未入力は0ではなくnullで未確定を保持する */
  planCommonH: number | null;
  planBuildH: number | null;
  planDiagH: number | null;
  planSetupH: number | null;
  planExtraH: number | null;
  /** 事故等のストレス予約枠（時間） */
  planReserveH: number | null;
}

export interface OfficeState {
  /** キーは YYYY-MM */
  months: Record<string, OfficeMonth>;
}

// ── 知見台帳（模倣に依存しない品質蓄積の仕組み 2026-09-20）──
export type KnowledgeKind =
  | "質問"
  | "判断基準"
  | "試験"
  | "例外対応"
  | "引継ぎ"
  | "積算の注意";
/** 内部再利用の状態遷移。終了状態は 却下/要再検証/廃止 */
export type KnowledgeState =
  | "候補"
  | "確認中"
  | "試験待ち"
  | "レビュー待ち"
  | "内部再利用承認済み"
  | "却下"
  | "要再検証"
  | "廃止";
/** 公開の状態は内部再利用とは別系統。内部承認≠公開承認 */
export type KnowledgePublish = "非公開" | "公開審査中" | "公開承認済み" | "公開停止";
/** 根拠区分。空欄は未設定 */
export type KnowledgeBasis = "" | "仮説" | "架空データで試験" | "実案件で確認";
/** 利用権・秘密・再識別リスクの審査結果 */
export type RightsReview = "" | "未審査" | "審査中" | "承認" | "否認";

/** 適用した案件への参照（内部限定。公開出力に含めない） */
export interface KnowledgeAppliedRef {
  caseId: string;
  /** 適用時点の知見の版（案件側に固定する） */
  version: string;
  reason: string;
  at: string;
}

export interface KnowledgeEntry {
  id: string;
  /** 題名 */
  title: string;
  kind: KnowledgeKind;
  /** 何の問題を防ぐか */
  problem: string;
  /** 一般化した内容（案件名・顧客名を含めない。名を消しただけでは安全とみなさない） */
  generalized: string;
  /** 適用条件 */
  conditions: string;
  /** 除外条件 */
  exclusions: string;
  basis: KnowledgeBasis;
  /** 確認済み範囲 */
  confirmedScope: string;
  /** 未確認範囲 */
  unconfirmedScope: string;
  rightsReview: RightsReview;
  /** 審査メモ */
  rightsNote: string;
  /** 版 */
  version: string;
  approvedBy: string;
  approvedAt: string;
  /** 見直し期限 */
  reviewDue: string;
  state: KnowledgeState;
  publish: KnowledgePublish;
  appliedRefs: KnowledgeAppliedRef[];
  createdAt: string;
  updatedAt: string;
}

/** 金庫の中身。まるごと暗号化してサーバーへ送る単位でもある。 */
export interface VaultState {
  cases: CaseRecord[];
  leads: LeadRecord[];
  leadCounter: number;
  currentCaseId: string | null;
  currentLeadId: string | null;
  currentTab: CaseTab;
  currentLeadTab: LeadTab;
  currentMode: Mode;
  profile: Profile;
  docTemplates: Record<string, string>;
  referrals: Referral[];
  goals: Goals;
  salesKpi: SalesKpi;
  retentionDays?: number;
  notifyEmail?: string;
  office?: OfficeState;
  /** 知見台帳（横断。⑥実行管理から開き、他の帳票は同じ台帳を参照する） */
  knowledge?: KnowledgeEntry[];
  /** 提供可能サービスの台帳（リード⑤。本人が編集する正本。営業側に別の料金式を作らない） */
  services?: ServiceRecord[];
}

export interface AuditEntry {
  seq: number;
  at: string;
  action: string;
  detail: string;
  prevHash: string;
  hash: string;
}
