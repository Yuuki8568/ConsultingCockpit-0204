/** ⑤商談後メモ — その場で埋める記録。ここが埋まると進捗が1つ進む。 */
import { useCurrentCase } from "../../hooks/use-current";
import { Area, CopyButton, Field, Grid, Note, Panel } from "../../components/kit";
import { CaseRecordings } from "./recordings";

export function CaseMemo() {
  const { c, patch } = useCurrentCase();
  if (!c) return null;
  const m = c.memo;

  const set = (k: string) => (v: string) => void patch((x) => void (x.memo[k] = v));

  const asText = [
    `${c.settings.companyName || "【企業名】"} 商談メモ`,
    `日時: ${m.datetime || ""}`,
    `出席者: ${m.attendees || ""}`,
    `決める人: ${m.decisionMaker || ""}`,
    "",
    "【話したこと】",
    m.summary || "",
    "",
    "【決まったこと】",
    m.decisions || "",
    "",
    "【合意したこと】",
    m.agreed || "",
    "",
    "【未合意・保留】",
    m.unagreed || "",
    "",
    "【相手の懸念】",
    m.concerns || "",
    "",
    "【追加で確認すること】",
    m.toConfirm || "",
    "",
    "【予算感】",
    m.budget || "",
    "",
    "【次にやること】",
    (c.nextActions || [])
      .filter((a) => !a.done)
      .map((a) => `・${a.text}${a.due ? `（${a.due}）` : ""}`)
      .join("\n") || "（未登録）",
  ].join("\n");

  return (
    <div className="space-y-4">
      <Panel
        title="商談の記録"
        note="面談直後の記憶が一番正確です。帰り道に埋めるつもりで、短く書いてください。"
        right={<CopyButton text={asText} label="メモをコピー" />}
      >
        <Grid cols={3}>
          <Field
            label="日時"
            type="datetime-local"
            value={m.datetime ?? ""}
            onChange={set("datetime")}
          />
          <Field
            label="出席者"
            value={m.attendees ?? ""}
            onChange={set("attendees")}
            placeholder="○○部長、△△課長"
          />
          <Field
            label="最終的に決める人"
            value={m.decisionMaker ?? ""}
            onChange={set("decisionMaker")}
            placeholder="社長／取締役会など"
          />
        </Grid>

        <div className="mt-4 space-y-3">
          <Area
            label="話したこと"
            value={m.summary ?? ""}
            onChange={set("summary")}
            rows={6}
            hint="相手が実際に使った言葉をそのまま残しておくと、提案書と③フロー分析でそのまま使えます。"
          />
          <Area
            label="決まったこと"
            value={m.decisions ?? ""}
            onChange={set("decisions")}
            rows={4}
            hint="決まっていないことは書かない。曖昧なままにしておくと後で揉めます。"
          />
          <Area
            label="予算感"
            value={m.budget ?? ""}
            onChange={set("budget")}
            rows={3}
            hint="④単価設計と③フロー分析の制約欄に自動で引き継がれます。"
          />
        </div>
      </Panel>

      <CaseRecordings />

      <Panel
        title="合意と未合意の分離"
        note="口頭の流れで「決まったこと」に未合意を混ぜないための欄です。合意したことだけを上の「決まったこと」に書き、ここに分けて残します。"
      >
        <div className="space-y-3">
          <Area
            label="合意したこと（双方が認めたこと）"
            value={m.agreed ?? ""}
            onChange={set("agreed")}
            rows={3}
            hint="相手の言葉で確認を取れた事実だけを書きます。"
          />
          <Area
            label="未合意・保留（まだ決まっていないこと）"
            value={m.unagreed ?? ""}
            onChange={set("unagreed")}
            rows={3}
            hint="ここに残ったものは、次の連絡で必ず確認します。空欄のままなら未確認、ではなく「保留なし」です。"
          />
          <Area
            label="相手の懸念・ためらい"
            value={m.concerns ?? ""}
            onChange={set("concerns")}
            rows={3}
            hint="反対ではなく引っかかり。価格・責任範囲・社内調整など、言葉のまま残します。"
          />
          <Area
            label="追加で確認すること"
            value={m.toConfirm ?? ""}
            onChange={set("toConfirm")}
            rows={2}
            hint="現行の管理費・担当者・既存ツールの契約など、提案に必要な未確認事項。"
          />
          <Area
            label="価格仮説への反応"
            value={m.priceReaction ?? ""}
            onChange={set("priceReaction")}
            rows={2}
            hint="④単価設計のA/F比較や月額の仮説を伝えたときの反応を記録します。数値の妥当性はここでは確定させません。"
          />
        </div>
      </Panel>

      <Panel title="次にやること" note="ここに入れたものは、上部の「次にやること」にまとめて出ます。">
        <NextActionEditor />
      </Panel>

      <Note tone="info">
        面談で得た情報を②ヒアリング設計の回答欄にも転記しておくと、③フロー分析と提案書骨子の精度が上がります。
      </Note>
    </div>
  );
}

function NextActionEditor() {
  const { c, patch } = useCurrentCase();
  if (!c) return null;
  const list = c.nextActions ?? [];

  return (
    <div className="space-y-2">
      {list.length === 0 && (
        <p className="text-[12px] text-paper-faint">まだありません。下から追加してください。</p>
      )}
      {list.map((a, i) => (
        <div
          key={a.id}
          className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-850 px-2.5 py-2"
        >
          <input
            type="checkbox"
            className="accent-[#0e7490]"
            checked={a.done}
            onChange={(e) =>
              void patch((x) => {
                const t = x.nextActions[i];
                t.done = e.target.checked;
                t.doneAt = e.target.checked ? new Date().toISOString() : undefined;
              })
            }
          />
          <input
            className="field min-w-[180px] flex-1 py-1"
            value={a.text}
            onChange={(e) => void patch((x) => void (x.nextActions[i].text = e.target.value))}
            placeholder="やること"
            style={a.done ? { textDecoration: "line-through", opacity: 0.55 } : undefined}
          />
          <input
            type="date"
            className="field num w-[150px] py-1"
            value={a.due ?? ""}
            onChange={(e) => void patch((x) => void (x.nextActions[i].due = e.target.value))}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void patch((x) => x.nextActions.splice(i, 1))}
            aria-label="削除"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn btn-sm"
        onClick={() =>
          void patch((x) =>
            x.nextActions.push({
              id: "A" + Date.now().toString(36),
              text: "",
              due: "",
              done: false,
              source: "memo",
            }),
          )
        }
      >
        + やることを足す
      </button>
    </div>
  );
}
