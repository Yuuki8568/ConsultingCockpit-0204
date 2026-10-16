/** ①案件設定 — 企業情報・面談条件・契約書に差し込む甲情報・タイミング・観の目・推奨メニュー */
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import { Area, Badge, Check, Field, Grid, Note, NumField, Panel, Select } from "../../components/kit";
import type { FdeProductKind } from "../../domain/types";

/** FDE商品区分（2026-09-20統合資料。料金は内部提案値で公開料金ではない） */
const FDE_PRODUCTS: [FdeProductKind, string][] = [
  ["", "未設定"],
  ["diagnosis", "業務適合診断（内部提案値 5万円/回）"],
  ["build", "限定構築（同 15万円×4段階）"],
  ["monthly", "月次運用管理支援（同 25万円/月・最初の価格仮説）"],
  ["change", "変更実装（個別見積り）"],
  ["inspection", "低頻度点検・内製移行（範囲別見積り）"],
];
import { GARTNER_DEFS } from "../../domain/data/diagnosis-legal";
import { scoreMenus } from "../../domain/data/service-menu";

const INDUSTRIES: [string, string][] = [
  ["general", "一般・その他"],
  ["manufacturing", "製造業"],
  ["retail", "小売業"],
  ["service", "サービス業"],
  ["it", "IT・情報通信"],
  ["medical", "医療・介護"],
  ["legal", "士業"],
  ["education", "教育"],
  ["finance", "金融"],
  ["construction", "建設・不動産"],
  ["logistics", "物流"],
];

const SIZES: [string, string][] = [
  ["small", "小規模（〜30名）"],
  ["medium", "中規模（30〜300名）"],
  ["large", "大規模（300名超）"],
];

const ROLES: [string, string][] = [
  ["executive", "経営層（社長・役員）"],
  ["manager", "管理職（部長・課長）"],
  ["frontline", "現場担当者"],
  ["mixed", "混合（複数役職）"],
];

const DURATIONS: [string, string][] = [
  ["30", "30分"],
  ["45", "45分"],
  ["60", "60分"],
  ["90", "90分"],
  ["120", "120分"],
];

const KAN_NO_ME: [string, string][] = [
  ["s1", "見（表面）：相手が口にした困りごとは何か"],
  ["s2", "観（本質）：その困りごとの裏で、本当に困っているのは何か"],
  ["s3", "拍子：いま動かすべきか、待つべきか。相手の速さはどれくらいか"],
  ["s4", "位取り：最初に手を付ける1点はどこか"],
  ["s5", "残り：やらないと決めることは何か"],
];

export function CaseSetup() {
  const { c, patch } = useCurrentCase();
  const { state } = useVault();
  if (!c || !state) return null;
  const s = c.settings;
  const k = s.kakuyaku;

  const fromLead = state.leads.find((l) => l.convertedCaseId === c.id);

  // 設定が変わるたびに推奨メニューを再計算（閲覧のみ、適用は④で）
  const stage = c.maturity.currentStage || c.gartner.stage || "";
  const menuTop = scoreMenus({
    industry: s.industry || "general",
    size: s.size || "small",
    stage,
    aiLeader: c.gartner.aiLeaderExists || "",
    keywords: s.keywords || "",
    knownInfo: s.knownInfo || "",
    hypothesis: (c.memo && (c.memo.hypothesis as string)) || "",
  })[0];

  return (
    <div className="space-y-4">
      <Panel title="企業情報" note="ここに入れた内容が、ヒアリング設計と書類の差し込みに使われます。">
        <Grid cols={2}>
          <Field
            label="企業名"
            value={s.companyName}
            onChange={(v) =>
              void patch((x) => {
                x.settings.companyName = v;
                x.name = v;
              })
            }
            placeholder="株式会社○○"
          />
          <Field
            label="面談日"
            type="date"
            value={s.meetingDate}
            onChange={(v) => void patch((x) => void (x.settings.meetingDate = v))}
          />
          <Select
            label="案件の状態"
            value={c.status ?? ""}
            onChange={(v) => void patch((x) => void (x.status = v as typeof x.status))}
            options={[
              ["", "未設定（進行中として扱う）"],
              ["active", "進行中"],
              ["paused", "休止中"],
              ["done", "完了"],
              ["lost", "失注"],
            ]}
            hint="完了・失注にすると左の一覧の下の「終わった案件」に畳まれます。休止中は進行中とは分けて表示します。"
          />
          <Select
            label="業種"
            value={s.industry}
            onChange={(v) => void patch((x) => void (x.settings.industry = v))}
            options={INDUSTRIES}
          />
          <Select
            label="規模"
            value={s.size}
            onChange={(v) => void patch((x) => void (x.settings.size = v))}
            options={SIZES}
          />
          <Select
            label="面談相手の層"
            value={s.role}
            onChange={(v) => void patch((x) => void (x.settings.role = v))}
            options={ROLES}
            hint="質問の重み付けが変わります。②ヒアリング設計で再生成してください。"
          />
          <Select
            label="面談時間"
            value={String(s.duration)}
            onChange={(v) => void patch((x) => void (x.settings.duration = Number(v)))}
            options={DURATIONS}
            hint="時間から出題数を決めます（3分で1問）。"
          />
        </Grid>

        <div className="mt-4 space-y-3">
          <Field
            label="想定課題キーワード"
            value={s.keywords}
            onChange={(v) => void patch((x) => void (x.settings.keywords = v))}
            placeholder="受発注, 在庫管理, 請求書処理"
            hint="読点かカンマで区切ります。先頭のものが案件名やフロー分析の対象名に使われます。"
          />
          <Area
            label="事前に分かっていること"
            value={s.knownInfo}
            onChange={(v) => void patch((x) => void (x.settings.knownInfo = v))}
            rows={3}
            placeholder="公開情報・紹介者から聞いた話・過去のやり取りなど"
          />
        </div>

        {fromLead && (
          <div className="mt-4">
            <Note tone="ok">
              このリードから案件化されています：{fromLead.company}
              {fromLead.hypothesis && <>（課題仮説：{fromLead.hypothesis}）</>}
            </Note>
          </div>
        )}
      </Panel>

      {menuTop && (
        <Panel
          title="この案件に合いそうな支援メニュー"
          note="業種・規模・想定課題と成熟度から自動で推奨しています。金額・工数を積算に反映するには④単価設計で選んでください。"
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-medium text-paper">{menuTop.item.name}</span>
                <Badge color="#0e7490">{menuTop.score}点</Badge>
              </div>
              <p className="mt-1 text-[13px] text-paper-dim">{menuTop.item.catchcopy}</p>
              <p className="mt-2 text-[12px] text-paper-faint">
                期間：{menuTop.item.period}／工数：{menuTop.item.hoursMin}〜{menuTop.item.hoursMax}時間／料金の目安：{menuTop.item.priceNote}
              </p>
              {menuTop.reasons.length > 0 && (
                <p className="mt-2 text-[12px] text-paper-faint">
                  推した理由：{menuTop.reasons.join("／")}
                </p>
              )}
            </div>
          </div>
        </Panel>
      )}

      <Panel
        title="契約書に差し込む甲（クライアント）情報"
        note="⑨法務チェックで書類を作るときに、そのまま差し込まれます。空欄は［要入力］と表示されます。"
      >
        <Grid cols={2}>
          <Field
            label="所在地"
            value={k.companyAddress}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.companyAddress = v))}
            placeholder="東京都○○区…"
          />
          <Field
            label="代表者名"
            value={k.representative}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.representative = v))}
          />
          <Field
            label="代表者の肩書"
            value={k.representativeTitle}
            onChange={(v) =>
              void patch((x) => void (x.settings.kakuyaku.representativeTitle = v))
            }
            placeholder="代表取締役"
          />
          <Field
            label="担当者名"
            value={k.contact}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.contact = v))}
          />
          <Field
            label="担当者の部署"
            value={k.contactDept}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.contactDept = v))}
          />
          <Field
            label="担当者の役職"
            value={k.contactTitle}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.contactTitle = v))}
          />
          <Field
            label="担当者メール"
            type="email"
            value={k.contactEmail}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.contactEmail = v))}
          />
          <Field
            label="担当者電話"
            value={k.contactPhone}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.contactPhone = v))}
          />
          <Field
            label="Webサイト"
            value={k.website}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.website = v))}
          />
          <Field
            label="ハラスメント相談窓口"
            value={k.harassmentContact}
            onChange={(v) => void patch((x) => void (x.settings.kakuyaku.harassmentContact = v))}
            hint="フリーランス保護法で明示が求められる項目です。"
          />
        </Grid>
      </Panel>

      <Panel
        title="タイミングの見極め"
        note="今このクライアントに提案を出すべきかを判断するための材料です。"
      >
        <div className="space-y-1">
          <Check
            label="繁忙期にあたる"
            checked={s.timing.busy}
            onChange={(v) => void patch((x) => void (x.settings.timing.busy = v))}
            hint="繁忙期は「今は無理」と断られやすい一方、痛みが顕在化しているので課題は取りやすい。"
          />
          <Check
            label="組織変更・人の入れ替わりがあった"
            checked={s.timing.reorg}
            onChange={(v) => void patch((x) => void (x.settings.timing.reorg = v))}
            hint="引き継ぎの穴が空くタイミング。入りやすい。"
          />
          <Check
            label="経営層からの号令が出ている"
            checked={s.timing.topDown}
            onChange={(v) => void patch((x) => void (x.settings.timing.topDown = v))}
            hint="予算が動きやすい。ただし現場が置いていかれていないか確認が必要。"
          />
        </div>
        <div className="mt-3">
          <Area
            label="現場側の認識"
            value={s.timing.frontlineAware}
            onChange={(v) => void patch((x) => void (x.settings.timing.frontlineAware = v))}
            rows={2}
            placeholder="現場は課題を課題と認識しているか。それとも上だけが焦っているか。"
          />
        </div>
      </Panel>

      <Panel
        title="観の目・見の目"
        note="相手の言葉をそのまま受け取らず、裏側にある本当の困りごとを書き分けるための欄です。"
      >
        <div className="space-y-3">
          {KAN_NO_ME.map(([key, label]) => (
            <Area
              key={key}
              label={label}
              value={c.kanNoMe[key] ?? ""}
              onChange={(v) => void patch((x) => void (x.kanNoMe[key] = v))}
              rows={2}
            />
          ))}
          <Area
            label="AIで扱ってよい情報かどうかの整理"
            value={c.kanNoMe.aiOk ?? ""}
            onChange={(v) => void patch((x) => void (x.kanNoMe.aiOk = v))}
            rows={2}
            placeholder="個人情報・取引先の機密が混ざる業務は、加工してから入れる前提で設計する。"
          />
        </div>
      </Panel>

      <Panel
        title="ガートナー3段階の当たり"
        note="②ヒアリング設計の成熟度診断でも自動判定できます。ここは手で置く用です。"
      >
        <Grid cols={2}>
          <Select
            label="現在地"
            value={c.gartner.stage}
            onChange={(v) => void patch((x) => void (x.gartner.stage = v))}
            options={[
              ["", "未判定"],
              ["Defend", "Defend（守る）"],
              ["Extend", "Extend（広げる）"],
              ["Transform", "Transform（作り変える）"],
            ]}
          />
          <Select
            label="AI推進の担い手"
            value={c.gartner.aiLeaderExists}
            onChange={(v) => void patch((x) => void (x.gartner.aiLeaderExists = v))}
            options={[
              ["", "未確認"],
              ["none", "いない"],
              ["parttime", "兼任でいる"],
              ["fulltime", "専任がいる"],
            ]}
          />
        </Grid>
        {c.gartner.stage && GARTNER_DEFS[c.gartner.stage as keyof typeof GARTNER_DEFS] && (
          <div className="mt-3 space-y-2 text-[13px] leading-relaxed">
            {(() => {
              const d = GARTNER_DEFS[c.gartner.stage as keyof typeof GARTNER_DEFS];
              return (
                <>
                  <p className="text-paper">
                    <span className="text-paper-dim">状態：</span>
                    {d.state}
                  </p>
                  <p className="text-paper">
                    <span className="text-paper-dim">やること：</span>
                    {d.action}
                  </p>
                  <p className="text-paper">
                    <span className="text-paper-dim">次の一手：</span>
                    {d.nextMove}
                  </p>
                </>
              );
            })()}
          </div>
        )}
      </Panel>

      <Panel
        title="FDE商品と個別仕様"
        note="2026-09-20統合資料の商品体系。料金は内部提案値で公開料金ではありません。未確定の項目は空欄のままにします。"
      >
        <Grid cols={2}>
          <Select
            label="FDE商品区分"
            value={c.fde?.productKind ?? ""}
            onChange={(v) =>
              void patch((x) => {
                if (x.fde) x.fde.productKind = v as FdeProductKind;
              })
            }
            options={FDE_PRODUCTS}
            hint="既存の支援メニュー（診断・伴走・研修）とは別体系として管理します。"
          />
          <Select
            label="価格の状態"
            value={c.fde?.priceStatus ?? ""}
            onChange={(v) =>
              void patch((x) => {
                if (x.fde) x.fde.priceStatus = v as "" | "hypothesis" | "proposed" | "agreed";
              })
            }
            options={[
              ["", "未設定"],
              ["hypothesis", "価格仮説（内部）"],
              ["proposed", "提案済み"],
              ["agreed", "合意済み（契約額）"],
            ]}
            hint="提案額と契約額を分けて記録します。計画値を契約値に置き換えません。"
          />
        </Grid>
        <Grid cols={2} className="mt-3">
          <NumField
            label="提案額（円・税抜）"
            value={c.fde?.proposalAmount ?? 0}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.proposalAmount = v)))}
            hint="0は未入力。0円と確認できた場合だけ0のままにします。"
          />
          <NumField
            label="契約額（円・税抜）"
            value={c.fde?.contractAmount ?? 0}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.contractAmount = v)))}
          />
        </Grid>
        <Grid cols={2} className="mt-3">
          <Field
            label="顧客側の責任者"
            value={c.fde?.clientOwner ?? ""}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.clientOwner = v)))}
            placeholder="原資料と最終業務判断を担える人"
          />
          <Field
            label="顧客側の代行者"
            value={c.fde?.clientProxy ?? ""}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.clientProxy = v)))}
            placeholder="責任者不在時に判断を代行する人"
          />
        </Grid>
        <div className="mt-4 space-y-3">
          <Grid cols={2}>
            <Field
              label="業務の起点"
              value={c.fde?.scopeStart ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.scopeStart = v)))}
              placeholder="例: 受注データの確定"
            />
            <Field
              label="業務の終点"
              value={c.fde?.scopeEnd ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.scopeEnd = v)))}
              placeholder="例: 請求下書きの作成まで"
            />
          </Grid>
          <Area
            label="対象データ源"
            value={c.fde?.dataSources ?? ""}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.dataSources = v)))}
            rows={2}
            placeholder="標準試行の範囲候補は「1業務・2データ源・1つのAI利用経路・月次1回」"
          />
          <Grid cols={3}>
            <Field
              label="対象件数"
              value={c.fde?.targetCount ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.targetCount = v)))}
              placeholder="診断後に数値で確定"
            />
            <Field
              label="件数の上限"
              value={c.fde?.countLimit ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.countLimit = v)))}
              hint="未確定のまま無制限で受注しない"
            />
            <Field
              label="例外数の上限"
              value={c.fde?.exceptionLimit ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.exceptionLimit = v)))}
            />
          </Grid>
          <Grid cols={2}>
            <Field
              label="試験範囲"
              value={c.fde?.testScope ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.testScope = v)))}
              placeholder="正常・例外・失敗・停止・再開・手動代替"
            />
            <Field
              label="納期の前提"
              value={c.fde?.dueNote ?? ""}
              onChange={(v) => void patch((x) => void (x.fde && (x.fde.dueNote = v)))}
              placeholder="顧客の回答待ち・受入周期を含む"
            />
          </Grid>
          <Area
            label="情報利用条件（この案件で使ってよい情報の範囲）"
            value={c.fde?.dataUseTerms ?? ""}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.dataUseTerms = v)))}
            rows={2}
            placeholder="例: 案件固有の情報はこの案件でのみ使用。内部の再利用知見への転用は個別に審査する"
            hint="情報は「案件固有」「内部の再利用知見」「公開用見本」の三層に分けて管理します"
          />
          <Field
            label="利用する基準の版"
            value={c.fde?.basisVersions ?? ""}
            onChange={(v) => void patch((x) => void (x.fde && (x.fde.basisVersions = v)))}
            placeholder="例: 知見KN… v1.2 / 雛形 v3（適用した版をここに固定する）"
            hint="⑥の知見台帳から採用した知見のIDと版を記録します。新版が出ても自動では更新しません"
            mono
          />
          <div className="rounded-sm border border-line bg-ink-900 p-3">
            <div className="mb-2 text-[12px] font-medium text-paper">共通メタ（版・根拠・確認者・適用期間）</div>
            <Grid cols={3}>
              <Field
                label="版"
                value={c.fde?.version ?? ""}
                onChange={(v) => void patch((x) => void (x.fde && (x.fde.version = v)))}
                placeholder="例: v1.0"
              />
              <Field
                label="確認者"
                value={c.fde?.confirmedBy ?? ""}
                onChange={(v) => void patch((x) => void (x.fde && (x.fde.confirmedBy = v)))}
                placeholder="仕様を確認した人"
              />
              <Field
                label="変更理由"
                value={c.fde?.changeReason ?? ""}
                onChange={(v) => void patch((x) => void (x.fde && (x.fde.changeReason = v)))}
                placeholder="版を上げた理由"
              />
            </Grid>
            <Grid cols={2} className="mt-3">
              <Field
                label="適用期間（開始）"
                type="date"
                value={c.fde?.validFrom ?? ""}
                onChange={(v) => void patch((x) => void (x.fde && (x.fde.validFrom = v)))}
              />
              <Field
                label="適用期間（終了）"
                type="date"
                value={c.fde?.validTo ?? ""}
                onChange={(v) => void patch((x) => void (x.fde && (x.fde.validTo = v)))}
              />
            </Grid>
            <div className="mt-3">
              <Area
                label="根拠"
                value={c.fde?.basis ?? ""}
                onChange={(v) => void patch((x) => void (x.fde && (x.fde.basis = v)))}
                rows={2}
                placeholder="この仕様・価格の根拠（診断結果・商談日・資料など）"
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Note tone="warn">
            全件のルール照合は全件の内容審査と同じではありません。原資料にない案件の完全発見・将来無事故・利益達成は保証しません。資料不足は「未実施・限定実施」と記録します。
          </Note>
        </div>
      </Panel>
    </div>
  );
}
