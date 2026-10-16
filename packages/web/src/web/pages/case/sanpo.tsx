/**
 * ⑩三方良し — 顧客・自事務所・現場/取引先の3視点で価値と負担を記録する判断補助。
 * 受注可否を自動で決めない。合計点は付けない。空欄は「未設定」のまま残す。
 * 記録は内部用。顧客向けの出力（Excel/Word/印刷）には含まれない。
 * ④で見積が確定した時点で、事実として転記できる項目（対象・費用・工数など）だけを
 * 空欄に下書きとして自動で入れる。手で書き換えた項目は以後いじらない。
 * 状態の3値・懸念・次の行動は判断なので自動では設定しない。
 */
import { useState } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { Area, Field, Grid, Note, Panel, Select } from "../../components/kit";
import { sanpoHasConcern } from "../../domain/logic/case";
import { SANPO_AUTO_FIELD_LABELS, applySanpoAutofill } from "../../domain/logic/sanpo";
import { jpDate, newId } from "../../domain/logic/util";
import type { SanpoReview } from "../../domain/types";

const STATUS_OPTIONS: [string, string][] = [
  ["", "（未設定）"],
  ["unconfirmed", "未確認"],
  ["concern", "懸念あり"],
  ["confirmed", "確認済み"],
];

const NEXT_OPTIONS: [string, string][] = [
  ["", "（未設定）"],
  ["recheck", "追加確認"],
  ["pilot", "限定試行を検討"],
  ["propose", "提案を検討"],
  ["reconsider", "条件を見直す"],
  ["decline", "見送る"],
];

export function CaseSanpo() {
  const { c, patch } = useCurrentCase();
  const [added, setAdded] = useState("");
  const [autoMsg, setAutoMsg] = useState("");
  if (!c) return null;
  const sp = c.sanpo;
  const auto = c.sanpoAuto;
  const canAutofill = !!(c.pricing?.result || (c.estimate?.totalIncTax ?? 0) > 0);

  // ④単価設計の確定内容から、空欄（または前回の転記から手を付けていない項目）だけを埋める。
  const runAutofill = () => {
    void patch((x) => {
      const filled = applySanpoAutofill(x, "⑩のボタンから実行");
      setAutoMsg(
        filled.length > 0
          ? `${filled.length} 項目に入れました: ${filled
              .map((k) => SANPO_AUTO_FIELD_LABELS[k])
              .join("、")}`
          : canAutofill
            ? "新しく入る項目はありませんでした（空欄がないか、手で修正済みの項目だけです）。"
            : "④単価設計で計算するか見積を確定すると、ここに転記できる内容ができます。",
      );
    });
  };

  const set = (k: keyof SanpoReview) => (v: string) =>
    void patch((x) => void (x.sanpo[k] = v));

  // 「次に確認したいこと」の各行を、案件の次の行動（⑤メモやアクションハブに出る一覧）へ追加する。
  // 同じ文面は二重に足さない。
  const addToActions = () => {
    const lines = sp.toConfirm
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (lines.length === 0) return;
    void patch((x) => {
      const existing = new Set(x.nextActions.map((a) => a.text));
      let n = 0;
      for (const l of lines) {
        const text = `【確認】${l}`;
        if (existing.has(text)) continue;
        x.nextActions.push({
          id: newId("A"),
          text,
          due: x.sanpo.nextCheckDate || "",
          done: false,
          source: "sanpo",
        });
        existing.add(text);
        n++;
      }
      setAdded(
        n > 0
          ? `${n} 件を「次の行動」に追加しました（⑤商談後メモ・上部のアクション一覧に出ます）。`
          : "追加済みの内容だけでした。新しい確認事項はありません。",
      );
    });
  };

  return (
    <div className="space-y-4">
      <Note tone="info">
        受注可否を自動で決めるものではなく、あとから判断を振り返るための記録です。
        合計点は付けません。空欄は「未設定」のまま残り、確認済みには読み替えません。
        ここに書いた内容は内部用で、顧客向けの出力（Excel・Word・印刷）には含まれません。
      </Note>

      {sanpoHasConcern(c) && (
        <Note tone="warn">
          懸念が記録されています。この表示は操作を止めるものではありません。
          「次に確認したいこと」を下のボタンで「次の行動」に追加すると、対応の追跡ができます。
        </Note>
      )}

      {auto && auto.fields.length > 0 && (
        <Note tone="ok">
          {auto.source}（{jpDate(auto.at)}）に、確定した内容から
          {auto.fields.map((k) => SANPO_AUTO_FIELD_LABELS[k as keyof typeof SANPO_AUTO_FIELD_LABELS] ?? k).join("・")}
          を自動で入れています。手で書き換えた項目は以後の自動転記で上書きしません。
          各視点の状態や懸念は自動では設定しません。
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={runAutofill}>
          ④で確定した内容から空欄を埋める
        </button>
        {autoMsg && <span className="text-[11px] text-paper-faint">{autoMsg}</span>}
      </div>

      <Panel
        title="三方良しメモ"
        note="すべて任意です。役立ちそうな案件だけで使ってください。"
      >
        <Field
          label="対象となる提案"
          value={sp.target}
          onChange={set("target")}
          placeholder="どの案件・業務・提案版への判断か"
        />
        <div className="mt-4 space-y-3">
          <Area
            label="顧客にとっての価値と負担"
            value={sp.customerValue}
            onChange={set("customerValue")}
            rows={4}
            placeholder="期待する効果／費用・準備・学習の負担"
          />
          <Area
            label="自事務所として続けられる条件"
            value={sp.officeCondition}
            onChange={set("officeCondition")}
            rows={4}
            placeholder="工数・実行能力・稼働余力・保守範囲。無理な受注を避けるための条件"
          />
          <Area
            label="現場・取引先への影響（誰の作業が増えるか）"
            value={sp.stakeholderImpact}
            onChange={set("stakeholderImpact")}
            rows={4}
            placeholder="減る仕事・増える仕事・誤りが起きたときの影響"
          />
          <Area
            label="根拠と不明点"
            value={sp.basis}
            onChange={set("basis")}
            rows={4}
            hint="顧客確認・観察・計測など確認済みのことと、仮説・未確認のことを分けて書きます。"
          />
          <Area
            label="懸念と対応案"
            value={sp.concerns}
            onChange={set("concerns")}
            rows={4}
            placeholder="起きそうな問題・考えられる対応・次の行動"
          />
          <Area
            label="次に確認したいこと"
            value={sp.toConfirm}
            onChange={set("toConfirm")}
            rows={4}
            hint="1行1件で書くと、そのまま「次の行動」に追加できます。"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" onClick={addToActions}>
              確認したいことを「次の行動」に追加
            </button>
            {added && <span className="text-[11px] text-paper-faint">{added}</span>}
          </div>
        </div>
      </Panel>

      <Panel
        title="各視点の状態"
        note="合計点は付けません。負担や懸念が他の利益で見えなくならないよう、3つを別々に記録します。"
      >
        <Grid cols={3}>
          <Select
            label="顧客側"
            value={sp.statusCustomer}
            onChange={set("statusCustomer")}
            options={STATUS_OPTIONS}
          />
          <Select
            label="自事務所側"
            value={sp.statusOffice}
            onChange={set("statusOffice")}
            options={STATUS_OPTIONS}
          />
          <Select
            label="現場・取引先側"
            value={sp.statusStakeholder}
            onChange={set("statusStakeholder")}
            options={STATUS_OPTIONS}
          />
        </Grid>
      </Panel>

      <Panel
        title="提案の比較メモ"
        note="新規制作ありきで進めないための比較です。現状維持・既存活用も選択肢として並べます。"
      >
        <Grid cols={3}>
          <Area
            label="現状維持"
            value={sp.compareKeep}
            onChange={set("compareKeep")}
            rows={5}
            placeholder="変えない場合の価値と負担"
          />
          <Area
            label="既存活用"
            value={sp.compareReuse}
            onChange={set("compareReuse")}
            rows={5}
            placeholder="既存の仕組みを活かす場合"
          />
          <Area
            label="新規制作"
            value={sp.compareNew}
            onChange={set("compareNew")}
            rows={5}
            placeholder="新しく作る場合"
          />
        </Grid>
      </Panel>

      <Panel
        title="次の行動の候補"
        note="自動判定ではなく、理由を残して自分で選びます。"
      >
        <Grid cols={2}>
          <Select
            label="次の行動の候補"
            value={sp.nextCandidate}
            onChange={set("nextCandidate")}
            options={NEXT_OPTIONS}
          />
          <Field
            label="次回の確認日"
            type="date"
            value={sp.nextCheckDate}
            onChange={set("nextCheckDate")}
          />
        </Grid>
        <div className="mt-3">
          <Area
            label="選んだ理由"
            value={sp.nextReason}
            onChange={set("nextReason")}
            rows={3}
            placeholder="なぜその候補にしたか。あとから見直すときの手がかりになります。"
          />
        </div>
      </Panel>

      <Panel
        title="導入後の振り返り"
        note="提案時の想定と実際の結果をつなげます。未計測のものは「未計測」と書き、成功と扱いません。"
      >
        <Field
          label="振り返りの確認日"
          type="date"
          value={sp.reviewDate}
          onChange={set("reviewDate")}
        />
        <div className="mt-3">
          <Area
            label="実際の結果（想定との差）"
            value={sp.reviewResult}
            onChange={set("reviewResult")}
            rows={5}
            placeholder="顧客の効果・自社の負担・現場への影響。想定と違った点も残します。"
          />
        </div>
      </Panel>
    </div>
  );
}
