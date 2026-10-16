/**
 * 知見台帳 — 「模倣に依存しない品質蓄積の仕組み」（2026-09-20 追加指示文）
 * 横断の知見一覧は⑥実行管理から開き、②・③・④・⑧は同じ台帳を参照する。
 * - 情報の三層分離: 案件固有 / 内部の再利用知見 / 公開用見本
 * - 顧客名を消しただけでは安全な知見とみなさない
 * - 内部再利用承認と公開承認は別系統
 * - 案件への適用は自動上書きしない（版を案件側へ固定し、引用元ID・版・理由を残す）
 * - 廃止した知見は削除せず、検索候補から外す
 */
import { useMemo, useState } from "react";
import { useVault } from "../../hooks/use-vault";
import {
  Area,
  Badge,
  ConfirmButton,
  Empty,
  Field,
  Grid,
  Note,
  Panel,
  Select,
} from "../../components/kit";
import type {
  KnowledgeBasis,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgePublish,
  KnowledgeState,
  RightsReview,
} from "../../domain/types";

const KINDS: [KnowledgeKind, string][] = [
  ["質問", "質問"],
  ["判断基準", "判断基準"],
  ["試験", "試験"],
  ["例外対応", "例外対応"],
  ["引継ぎ", "引継ぎ"],
  ["積算の注意", "積算の注意"],
];

const STATES: [KnowledgeState, string][] = [
  ["候補", "候補"],
  ["確認中", "確認中（一般化・利用条件）"],
  ["試験待ち", "試験待ち"],
  ["レビュー待ち", "レビュー待ち"],
  ["内部再利用承認済み", "内部再利用承認済み"],
  ["却下", "却下（終了）"],
  ["要再検証", "要再検証（終了）"],
  ["廃止", "廃止（終了）"],
];

const PUBLISH_STATES: [KnowledgePublish, string][] = [
  ["非公開", "非公開"],
  ["公開審査中", "公開審査中"],
  ["公開承認済み", "公開承認済み"],
  ["公開停止", "公開停止"],
];

const BASIS: [KnowledgeBasis, string][] = [
  ["", "未設定"],
  ["仮説", "仮説"],
  ["架空データで試験", "架空データで試験"],
  ["実案件で確認", "実案件で確認"],
];

const RIGHTS: [RightsReview, string][] = [
  ["", "未設定"],
  ["未審査", "未審査"],
  ["審査中", "審査中"],
  ["承認", "承認"],
  ["否認", "否認"],
];

/** 終了状態（検索候補から外す。削除はしない） */
const CLOSED: KnowledgeState[] = ["却下", "要再検証", "廃止"];

const STATE_COLOR: Record<string, string> = {
  候補: "#8a857c",
  確認中: "#3B6E8F",
  試験待ち: "#C9A961",
  レビュー待ち: "#C9A961",
  内部再利用承認済み: "#4A7C59",
  却下: "#B85C38",
  要再検証: "#B85C38",
  廃止: "#6B665F",
};

const PUBLISH_COLOR: Record<string, string> = {
  非公開: "#6B665F",
  公開審査中: "#C9A961",
  公開承認済み: "#4A7C59",
  公開停止: "#B85C38",
};

function newEntry(): KnowledgeEntry {
  const now = new Date().toISOString();
  return {
    id: "KN" + Date.now().toString(36),
    title: "",
    kind: "質問",
    problem: "",
    generalized: "",
    conditions: "",
    exclusions: "",
    basis: "",
    confirmedScope: "",
    unconfirmedScope: "",
    rightsReview: "",
    rightsNote: "",
    version: "",
    approvedBy: "",
    approvedAt: "",
    reviewDue: "",
    state: "候補",
    publish: "非公開",
    appliedRefs: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 見直し期限が近い（30日以内）または過ぎているか */
export function reviewDueSoon(k: KnowledgeEntry, today: string): boolean {
  if (k.state !== "内部再利用承認済み" || !k.reviewDue) return false;
  const limit = new Date(today);
  limit.setDate(limit.getDate() + 30);
  return k.reviewDue <= limit.toISOString().slice(0, 10);
}

function EntryCard({
  k,
  caseId,
  caseName,
}: {
  k: KnowledgeEntry;
  caseId?: string;
  caseName?: string;
}) {
  const { state, mutate } = useVault();
  const [open, setOpen] = useState(false);
  const [applyReason, setApplyReason] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);

  const patch = (fn: (e: KnowledgeEntry) => void) =>
    void mutate(
      (s) => {
        const t = (s.knowledge ?? []).find((x) => x.id === k.id);
        if (t) {
          fn(t);
          t.updatedAt = new Date().toISOString();
        }
      },
      ["meta:app"],
    );

  const caseLabel = (id: string) =>
    state?.cases.find((c) => c.id === id)?.settings.companyName || id;

  return (
    <div className="rounded-sm border border-line bg-ink-850 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-[11px] text-paper-faint" title="知見ID">
          {k.id}
        </span>
        <span className="min-w-[160px] flex-1 truncate text-[13px] text-paper">
          {k.title || "（無題）"}
        </span>
        <Badge color="#8a857c">{k.kind}</Badge>
        <Badge color={STATE_COLOR[k.state] ?? "#6B665F"}>{k.state}</Badge>
        <Badge color={PUBLISH_COLOR[k.publish] ?? "#6B665F"}>{k.publish}</Badge>
        {k.version && <span className="num text-[11px] text-paper-faint">版 {k.version}</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? "閉じる" : "開く"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <Grid cols={3}>
            <Field
              label="題名"
              value={k.title}
              onChange={(v) => patch((e) => void (e.title = v))}
            />
            <Select
              label="種別"
              value={k.kind}
              onChange={(v) => patch((e) => void (e.kind = v as KnowledgeKind))}
              options={KINDS}
            />
            <Field
              label="版"
              value={k.version}
              onChange={(v) => patch((e) => void (e.version = v))}
              placeholder="例: 1.0"
              mono
            />
          </Grid>
          <Area
            label="何の問題を防ぐか"
            value={k.problem}
            rows={2}
            onChange={(v) => patch((e) => void (e.problem = v))}
          />
          <Area
            label="一般化した内容"
            value={k.generalized}
            rows={3}
            onChange={(v) => patch((e) => void (e.generalized = v))}
            hint="案件名・顧客名を含めないこと。名を消しただけでは安全な知見とみなしません。"
          />
          <Grid cols={2}>
            <Area
              label="適用条件"
              value={k.conditions}
              rows={2}
              onChange={(v) => patch((e) => void (e.conditions = v))}
            />
            <Area
              label="除外条件"
              value={k.exclusions}
              rows={2}
              onChange={(v) => patch((e) => void (e.exclusions = v))}
            />
          </Grid>
          <Grid cols={3}>
            <Select
              label="根拠区分"
              value={k.basis}
              onChange={(v) => patch((e) => void (e.basis = v as KnowledgeBasis))}
              options={BASIS}
            />
            <Field
              label="確認済み範囲"
              value={k.confirmedScope}
              onChange={(v) => patch((e) => void (e.confirmedScope = v))}
            />
            <Field
              label="未確認範囲"
              value={k.unconfirmedScope}
              onChange={(v) => patch((e) => void (e.unconfirmedScope = v))}
            />
          </Grid>
          <Grid cols={2}>
            <Select
              label="利用権・秘密・再識別リスク審査"
              value={k.rightsReview}
              onChange={(v) => patch((e) => void (e.rightsReview = v as RightsReview))}
              options={RIGHTS}
              hint="内部再利用の承認とは別に審査します"
            />
            <Field
              label="審査メモ"
              value={k.rightsNote}
              onChange={(v) => patch((e) => void (e.rightsNote = v))}
            />
          </Grid>
          <Grid cols={3}>
            <Select
              label="内部再利用の状態"
              value={k.state}
              onChange={(v) => patch((e) => void (e.state = v as KnowledgeState))}
              options={STATES}
              hint="却下・要再検証・廃止は終了状態です。削除せず検索候補から外れます"
            />
            <Field
              label="承認者"
              value={k.approvedBy}
              onChange={(v) => patch((e) => void (e.approvedBy = v))}
            />
            <Field
              label="承認日時"
              type="date"
              value={k.approvedAt}
              onChange={(v) => patch((e) => void (e.approvedAt = v))}
            />
          </Grid>
          <Grid cols={3}>
            <Select
              label="公開の状態（別系統）"
              value={k.publish}
              onChange={(v) => patch((e) => void (e.publish = v as KnowledgePublish))}
              options={PUBLISH_STATES}
              hint="内部再利用の承認は公開の承認を意味しません"
            />
            <Field
              label="見直し期限"
              type="date"
              value={k.reviewDue}
              onChange={(v) => patch((e) => void (e.reviewDue = v))}
            />
            <div className="flex items-end gap-2">
              {k.state === "候補" && k.appliedRefs.length === 0 && (
                <ConfirmButton
                  label="削除"
                  confirmLabel="削除する"
                  className="btn btn-ghost btn-sm"
                  onConfirm={() =>
                    void mutate(
                      (s) => {
                        s.knowledge = (s.knowledge ?? []).filter((x) => x.id !== k.id);
                      },
                      ["meta:app"],
                    )
                  }
                />
              )}
            </div>
          </Grid>

          {/* 案件への適用（内部限定の参照） */}
          <div className="rounded-sm border border-line px-2.5 py-2">
            <div className="mb-1.5 text-[11px] text-paper-dim">
              適用した案件への参照（内部限定。公開出力には含めません）
            </div>
            {k.appliedRefs.length === 0 ? (
              <p className="text-[11px] text-paper-faint">適用記録はまだありません。</p>
            ) : (
              <ul className="space-y-1">
                {k.appliedRefs.map((r, i) => (
                  <li key={i} className="text-[12px] text-paper-dim">
                    <span className="text-paper">{caseLabel(r.caseId)}</span>
                    <span className="num text-paper-faint"> 版 {r.version || "未設定"}</span>
                    <span className="num text-paper-faint"> {r.at.slice(0, 10)}</span>
                    {r.reason && <span className="text-paper-faint"> — {r.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
            {caseId && k.state === "内部再利用承認済み" && (
              <div className="mt-2">
                {applyOpen ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="field min-w-[220px] flex-1 py-1"
                      value={applyReason}
                      onChange={(e) => setApplyReason(e.target.value)}
                      placeholder="適用理由（なぜこの案件に使うか）"
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        patch((e) =>
                          e.appliedRefs.push({
                            caseId,
                            version: e.version,
                            reason: applyReason,
                            at: new Date().toISOString(),
                          }),
                        );
                        setApplyReason("");
                        setApplyOpen(false);
                      }}
                    >
                      版 {k.version || "未設定"} を固定して記録
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setApplyOpen(false)}>
                      やめる
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-sm" onClick={() => setApplyOpen(true)}>
                    この案件（{caseName || "無題"}）への適用を記録
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 知見台帳の本体（⑥実行管理に置く横断一覧） */
export function KnowledgeLedger({
  caseId,
  caseName,
}: {
  caseId?: string;
  caseName?: string;
}) {
  const { state, mutate } = useVault();
  const [showClosed, setShowClosed] = useState(false);
  const knowledge = useMemo(() => state?.knowledge ?? [], [state]);
  const active = knowledge.filter((k) => !CLOSED.includes(k.state));
  const closed = knowledge.filter((k) => CLOSED.includes(k.state));

  const add = () =>
    void mutate(
      (s) => {
        if (!Array.isArray(s.knowledge)) s.knowledge = [];
        s.knowledge.push(newEntry());
      },
      ["meta:app"],
    );

  return (
    <Panel
      title="知見台帳"
      note="案件をまたいで再利用する知見の台帳です（全案件で共通）。候補→確認中→試験待ち→レビュー待ち→内部再利用承認済みの順に進め、公開は別系統で審査します。案件への適用は自動上書きせず、版を固定して理由を残します。"
      right={
        <button className="btn btn-primary btn-sm" onClick={add}>
          + 知見候補
        </button>
      }
    >
      <div className="space-y-3">
        <Note tone="info">
          情報は「案件固有」「内部の再利用知見」「公開用見本」の三層に分けます。顧客名を消しただけでは安全な知見とみなさず、利用権・秘密・再識別リスクの審査を別途行います。
        </Note>
        {active.length === 0 ? (
          <Empty>
            知見はまだありません。案件で得た質問・判断基準・例外対応などを一般化して登録してください。すべての例外を知見化する必要はありません。
          </Empty>
        ) : (
          <div className="space-y-2">
            {active.map((k) => (
              <EntryCard key={k.id} k={k} caseId={caseId} caseName={caseName} />
            ))}
          </div>
        )}
        {closed.length > 0 && (
          <div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowClosed((v) => !v)}
            >
              {showClosed ? "終了した知見を隠す" : `終了した知見（${closed.length}件）を表示`}
            </button>
            {showClosed && (
              <div className="mt-2 space-y-2 opacity-70">
                {closed.map((k) => (
                  <EntryCard key={k.id} k={k} caseId={caseId} caseName={caseName} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** ⑧継続サポート用: 見直し期限の近い知見の一覧（参照のみ） */
export function KnowledgeReviewList() {
  const { state } = useVault();
  const today = new Date().toISOString().slice(0, 10);
  const due = (state?.knowledge ?? []).filter((k) => reviewDueSoon(k, today));
  if (due.length === 0) return null;
  return (
    <Panel
      title="知見の見直し"
      note="見直し期限が近い（30日以内）または過ぎている知見です。内容の確認・版の更新は⑥実行管理の知見台帳で行います。"
    >
      <ul className="space-y-1.5">
        {due.map((k) => (
          <li
            key={k.id}
            className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-850 px-2.5 py-1.5 text-[12px]"
          >
            <span className="num text-[11px] text-paper-faint">{k.id}</span>
            <span className="min-w-[160px] flex-1 truncate text-paper">
              {k.title || "（無題）"}
            </span>
            <span className="num text-[11px] text-paper-faint">版 {k.version || "未設定"}</span>
            <Badge color={k.reviewDue < today ? "#B85C38" : "#C9A961"}>
              見直し期限 {k.reviewDue}
              {k.reviewDue < today ? "（超過）" : ""}
            </Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
