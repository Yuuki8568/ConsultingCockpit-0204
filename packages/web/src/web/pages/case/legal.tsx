/** ⑨契約・法務チェック — 書類の状態管理・チェックリスト・書類生成・9書類まとめ出力 */
import { useMemo } from "react";
import { useCurrentCase } from "../../hooks/use-current";
import { useVault } from "../../hooks/use-vault";
import {
  Check,
  ConfirmButton,
  Empty,
  Grid,
  Note,
  Panel,
  Sec,
} from "../../components/kit";
import { DOC_TYPE_DEFS } from "../../domain/data/doc-templates";
import { LEGAL_CHECKLIST_ITEMS } from "../../domain/data/diagnosis-legal";
import { fillTemplate, gatherTemplateContext, generateDocNo } from "../../domain/logic/docs";
import { safeFileName } from "../../domain/logic/util";
import { downloadZip } from "../../lib/export/zip";
import { docViewer } from "../../lib/store/doc-viewer-store";
import { trace } from "../../lib/trace";
import type { DocStatus, GeneratedDoc } from "../../domain/types";

const DOC_STATUS: [DocStatus, string, string][] = [
  ["todo", "未着手", "#6B665F"],
  ["sent", "送付済み", "#3B6E8F"],
  ["signed", "締結済み", "#4A7C59"],
  ["na", "不要", "#2A2A2A"],
];

/**
 * 契約時に揃える9書類。ここに並べるのは「雛形のキー」。
 * 進行状況を持つ legalDocs 側はキーが別で、NDA だけ大文字なので
 * DOC_TYPE_DEFS の pickKey で対応付ける（v3 の持ち方をそのまま維持）。
 */
const NINE_DOCS = [
  "nda",
  "estimate",
  "purchaseOrder",
  "mainContract",
  "aiAddendum",
  "dpa",
  "deliveryReceipt",
  "completionReport",
  "disclaimer",
] as const;

/** 雛形のキー → legalDocs のキー */
function statusKey(templateKey: string): string {
  const def = (DOC_TYPE_DEFS as Record<string, { pickKey: string | null }>)[templateKey];
  return def?.pickKey ?? templateKey;
}

const PHASES = ["pre", "during", "post"] as const;

export function CaseLegal() {
  const { c, patch } = useCurrentCase();
  const { state, audit } = useVault();

  const ctx = useMemo(
    () => (c && state ? gatherTemplateContext(c, state) : null),
    [c, state],
  );

  const checkStats = useMemo(() => {
    if (!c) return { done: 0, total: 0, pct: 0 };
    let done = 0;
    let total = 0;
    for (const ph of PHASES) {
      const items = (LEGAL_CHECKLIST_ITEMS as Record<string, { items: string[][] }>)[ph].items;
      for (const [k] of items) {
        total++;
        const v = (c.legalChecklist[ph] as Record<string, unknown>)[k];
        if (v === true || v === "done" || v === "na") done++;
      }
    }
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [c]);

  if (!c || !state || !ctx) return null;

  /** 金庫内の書類本文を id 指定で更新する（ビューアからの遅延保存用） */
  const persistDocContent = (docId: string, content: string) => {
    void patch((x) => {
      const t = x.generatedDocs.find((z) => z.id === docId);
      if (t) t.content = content;
    });
  };

  /**
   * 書類をビューアで開く。渡すのは開いた瞬間のスナップショット。
   * 以後の表示は金庫 state を参照しない（専用ストア方式）ため、
   * 同期やタブの再マウントでモーダルが消えることはない。
   */
  const openViewer = (g: GeneratedDoc) => {
    docViewer.open(
      {
        docId: g.id,
        caseId: c.id,
        title: (DOC_TYPE_DEFS as Record<string, { jp: string }>)[g.docType]?.jp ?? g.docType,
        docNo: g.docNo,
        company: c.settings.companyName || "",
      },
      typeof g.content === "string" ? g.content : "",
      (content) => persistDocContent(g.id, content),
    );
  };

  const generate = (docType: string) => {
    trace("generate_begin", { docType });
    try {
      const tpl = state.docTemplates[docType];
      if (!tpl) {
        trace("generate_fail", { docType, reason: "no_template" });
        window.alert(
          `「${(DOC_TYPE_DEFS as Record<string, { jp: string }>)[docType]?.jp ?? docType}」の雛形が空です。設定の「書類雛形」から組込雛形を読み込んでください。`,
        );
        return;
      }
      const docNo = generateDocNo(docType, state);
      const filled = fillTemplate(tpl, ctx);
      const id = "D" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      void patch((x) => {
        x.generatedDocs.push({
          id,
          docType,
          docNo,
          issuedAt: new Date().toISOString().slice(0, 10),
          content: filled.text,
          status: "draft",
        });
        const sk = statusKey(docType);
        x.legalDocs[sk] ??= { status: "todo", signedAt: "", docNo: "" };
        x.legalDocs[sk].docNo = docNo;
      });
      audit("doc_generate", { docType, docNo });
      trace("generate_done", { docType });
      openViewer({
        id,
        docType,
        docNo,
        issuedAt: new Date().toISOString().slice(0, 10),
        content: filled.text,
        status: "draft",
      });
    } catch (e) {
      trace("generate_fail", {
        docType,
        reason: e instanceof Error ? e.message : String(e),
      });
      // ここで静かに止まると「画面が固まった」ように見えるため、必ず知らせる
      window.alert(
        `書類の生成に失敗しました: ${e instanceof Error ? e.message : String(e)}\n\n繰り返し出る場合は、この画面を再読み込みしてください。`,
      );
    }
  };

  const exportNine = () => {
    const company = safeFileName(c.settings.companyName || "無題");
    const entries = NINE_DOCS.map((key, i) => {
      const def = (DOC_TYPE_DEFS as Record<string, { jp: string }>)[key];
      const tpl = state.docTemplates[key] ?? "";
      const filled = fillTemplate(tpl, ctx);
      const docNo = c.legalDocs[statusKey(key)]?.docNo || generateDocNo(key, state);
      const html = wordHtml(def?.jp ?? key, docNo, filled.text);
      return {
        name: `${String(i + 1).padStart(2, "0")}_${def?.jp ?? key}_${docNo}.doc`,
        content: html,
      };
    });
    // 未入力の一覧も同梱する（渡す前に自分で埋めるためのメモ）
    const missing = new Set<string>();
    NINE_DOCS.forEach((key) => {
      fillTemplate(state.docTemplates[key] ?? "", ctx).missing.forEach((m) => missing.add(m));
    });
    entries.push({
      name: "00_未入力の一覧.txt",
      content:
        `${c.settings.companyName || "無題"} 向け 契約書類一式\n作成日 ${new Date().toLocaleString("ja-JP")}\n\n` +
        (missing.size > 0
          ? `以下は空欄のため［要入力］と表示されています。渡す前に埋めてください。\n\n` +
            Array.from(missing)
              .map((m) => `・${m}`)
              .join("\n")
          : "空欄はありません。") +
        `\n\n※ すべての書類は「免責事項(第3版)」と一体で運用します。\n※ 補助金の申請書類作成代行は行政書士の業務範囲です（行政書士法第19条）。当方は情報提供と、お客様ご自身が作成する書類への助言までを行います。\n`,
    });
    downloadZip(`${company}_契約書類一式_${new Date().toISOString().slice(0, 10)}`, entries);
    audit("nine_docs_export", { company: c.settings.companyName });
  };

  const generatedFor = (docType: string) =>
    c.generatedDocs.filter((g) => g.docType === docType).slice(-1)[0];

  return (
    <div className="space-y-4">
      <Panel
        title="書類の状態"
        note="契約時に揃える9書類。締結済みまで進めると、この案件は法務面で完了です。"
        right={
          <button className="btn btn-primary btn-sm" onClick={exportNine}>
            9書類をまとめて書き出す
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>書類</th>
                <th className="w-40">状態</th>
                <th className="w-36">締結日</th>
                <th className="w-44">書類番号</th>
                <th className="w-44" />
              </tr>
            </thead>
            <tbody>
              {NINE_DOCS.map((key) => {
                const def = (DOC_TYPE_DEFS as Record<string, { jp: string; code: string }>)[key];
                const sk = statusKey(key);
                const d = c.legalDocs[sk] ?? { status: "todo", signedAt: "", docNo: "" };
                const g = generatedFor(key);
                const missing = fillTemplate(state.docTemplates[key] ?? "", ctx).missing.length;
                return (
                  <tr key={key}>
                    <td>
                      <span className="text-[13px]">{def?.jp ?? key}</span>
                      {missing > 0 && (
                        <span className="ml-2 text-[11px] text-warn">未入力 {missing}件</span>
                      )}
                    </td>
                    <td>
                      <select
                        className="field py-1"
                        value={d.status}
                        onChange={(e) =>
                          void patch((x) => {
                            x.legalDocs[sk] ??= { status: "todo", signedAt: "", docNo: "" };
                            x.legalDocs[sk].status = e.target.value as DocStatus;
                            if (e.target.value === "signed" && !x.legalDocs[sk].signedAt)
                              x.legalDocs[sk].signedAt = new Date().toISOString().slice(0, 10);
                          })
                        }
                      >
                        {DOC_STATUS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        className="field num py-1"
                        value={d.signedAt}
                        onChange={(e) =>
                          void patch((x) => {
                            x.legalDocs[sk] ??= { status: "todo", signedAt: "", docNo: "" };
                            x.legalDocs[sk].signedAt = e.target.value;
                          })
                        }
                      />
                    </td>
                    <td className="num text-[12px] text-paper-dim">{d.docNo || "—"}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-sm" onClick={() => generate(key)}>
                          作る
                        </button>
                        {g && (
                          <button className="btn btn-sm" onClick={() => openViewer(g)}>
                            見る
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="AI利用に関する取り決め"
        note="AI特約に入れる条項の選択です。データの扱い方を基準に決めます。"
      >
        <div className="space-y-1">
          <Check
            label="生成AIの出力の正確性は保証しない旨を入れる"
            checked={c.aiClauses.hallucination}
            onChange={(v) => void patch((x) => void (x.aiClauses.hallucination = v))}
            hint="誤情報が混ざる前提で、確認は人がやるという役割分担を明記します。"
          />
          <Check
            label="著作権・学習利用に関する条項を入れる"
            checked={c.aiClauses.copyright}
            onChange={(v) => void patch((x) => void (x.aiClauses.copyright = v))}
            hint="全サービスで学習させない設定を維持し、その証跡を報告する形にします。"
          />
          <Check
            label="秘密情報・個人情報の加工義務を入れる"
            checked={c.aiClauses.dataProtection}
            onChange={(v) => void patch((x) => void (x.aiClauses.dataProtection = v))}
            hint="未加工のまま入れることは禁止し、誰の情報か分からない形に加工してから使います。未加工で使う場合は書面での承諾が必要です。"
          />
        </div>
        <div className="mt-3">
          <Note tone="info">
            AI特約はサービスのプランで線を引くのではなく、扱うデータの種類で線を引く形にしています。
            個人向けプランでも、学習させない設定を入れたうえで加工したデータだけを扱えば使えます。
          </Note>
        </div>
      </Panel>

      <Panel
        title="抜けていないかの確認"
        note={`${checkStats.done} / ${checkStats.total} 完了（${checkStats.pct}%）`}
      >
        <div className="space-y-5">
          {PHASES.map((ph) => {
            const group = (
              LEGAL_CHECKLIST_ITEMS as Record<string, { title: string; items: string[][] }>
            )[ph];
            return (
              <div key={ph}>
                <Sec>{group.title}</Sec>
                <div className="space-y-1">
                  {group.items.map(([k, label]) => {
                    const v = (c.legalChecklist[ph] as Record<string, unknown>)[k];
                    const done = v === true || v === "done";
                    const na = v === "na";
                    return (
                      <div key={k} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1.5 accent-[#0e7490]"
                          checked={done}
                          onChange={(e) =>
                            void patch((x) => {
                              (x.legalChecklist[ph] as Record<string, unknown>)[k] = e.target
                                .checked
                                ? "done"
                                : "";
                            })
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <span
                            className="text-[13px] leading-relaxed"
                            style={{
                              color: na ? "#6B665F" : "var(--color-paper)",
                              textDecoration: na ? "line-through" : undefined,
                            }}
                          >
                            {label}
                          </span>
                          <input
                            className="field mt-1 py-1 text-[12px]"
                            placeholder="補足（任意）"
                            value={c.legalChecklist.notes[k] ?? ""}
                            onChange={(e) =>
                              void patch(
                                (x) => void (x.legalChecklist.notes[k] = e.target.value),
                              )
                            }
                          />
                        </div>
                        <button
                          className="btn btn-ghost btn-sm shrink-0"
                          onClick={() =>
                            void patch((x) => {
                              (x.legalChecklist[ph] as Record<string, unknown>)[k] = na
                                ? ""
                                : "na";
                            })
                          }
                        >
                          {na ? "戻す" : "不要"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="補助金について"
        note="どこまでやるかの線は法律で決まっています。ここを越えないでください。"
      >
        <Grid cols={2}>
          <div className="rounded-sm border border-ok/40 bg-ok/8 px-3 py-2.5">
            <div className="mb-1.5 text-[12px] font-medium text-ok">できること</div>
            <ul className="space-y-1 text-[12px] leading-relaxed text-paper-dim">
              <li>・活用できそうな制度の情報提供</li>
              <li>・お客様ご自身が作る事業計画書への助言</li>
              <li>・AI導入計画の設計・伴走支援</li>
              <li>・提携する行政書士の紹介（紹介料は受け取らない）</li>
            </ul>
          </div>
          <div className="rounded-sm border border-alert/40 bg-alert/8 px-3 py-2.5">
            <div className="mb-1.5 text-[12px] font-medium text-alert">できないこと</div>
            <ul className="space-y-1 text-[12px] leading-relaxed text-paper-dim">
              <li>・申請書・事業計画書の有償での作成代行</li>
              <li>・成功報酬型での申請支援</li>
              <li>・申請システムへの代理入力・代理提出</li>
              <li>・採択されるという説明</li>
            </ul>
          </div>
        </Grid>
        <div className="mt-3">
          <Note tone="alert">
            改正行政書士法第19条により、名目を問わず無資格での有償作成代行は認められません。
            提案書にもこの範囲を明記してください（②の提案書骨子には自動で入ります）。
          </Note>
        </div>
      </Panel>

      <Panel title="作った書類" note="内容はこの端末で暗号化してから保存されます。">
        {c.generatedDocs.length === 0 ? (
          <Empty>まだ作っていません。上の表の「作る」から生成します。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[620px]">
              <thead>
                <tr>
                  <th className="w-44">書類番号</th>
                  <th>種類</th>
                  <th className="w-32">発行日</th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {c.generatedDocs
                  .slice()
                  .reverse()
                  .map((g) => (
                    <tr key={g.id}>
                      <td className="num text-[12px]">{g.docNo}</td>
                      <td>
                        {(DOC_TYPE_DEFS as Record<string, { jp: string }>)[g.docType]?.jp ??
                          g.docType}
                      </td>
                      <td className="num text-[12px]">{g.issuedAt}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-sm" onClick={() => openViewer(g)}>
                            見る
                          </button>
                          <ConfirmButton
                            label="削除"
                            onConfirm={() => {
                              // 開いている書類が消える場合はビューアも閉じる
                              if (docViewer.getDoc()?.docId === g.id) docViewer.close();
                              void patch((x) => {
                                const i = x.generatedDocs.findIndex((z) => z.id === g.id);
                                if (i >= 0) x.generatedDocs.splice(i, 1);
                              });
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 書類の表示モーダルは app.tsx の DocViewerModal が担う（ここには置かない） */}
    </div>
  );
}

function wordHtml(title: string, docNo: string, body: string): string {
  const esc = (s: string) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>@page{size:A4 portrait;margin:18mm}body{font-family:"Yu Gothic","Meiryo",sans-serif;font-size:10.5pt;line-height:1.8}h1{font-size:13pt;text-align:center;border-bottom:2px solid #0e7490;padding-bottom:6px;margin:0 0 12px}.docno{text-align:right;font-size:9pt;color:#666}pre{white-space:pre-wrap;font-family:inherit;margin:0}</style></head><body><div class="docno">${esc(docNo)}</div><h1>${esc(title)}</h1><pre>${esc(body)}</pre></body></html>`;
}
