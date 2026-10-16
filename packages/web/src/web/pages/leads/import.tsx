/**
 * リード① ファイルからの読み取り（自動振り分け）。
 *
 * 外部AIには接続しない。JSONのキー名・テキストのラベル行・定型句だけで判定し、
 * 判定できない項目は「不明（空欄）」のままにして人が選ぶ（推測で埋めない）。
 * 同名企業が既にある場合は警告だけ出し、自動統合はしない。
 */
import { useRef, useState } from "react";
import { useVault } from "../../hooks/use-vault";
import { Badge, Note, Panel } from "../../components/kit";
import {
  decodeImportFile,
  IMPORT_KIND_OPTIONS,
  isSpreadsheetName,
  parseImportFile,
  parseSpreadsheetFile,
  type ImportKind,
  type ParsedImport,
} from "../../domain/logic/import-lead";
import { makeEmptyLead } from "../../domain/logic/state";

interface ImportItem extends ParsedImport {
  include: boolean;
}

const RESULT_LABEL: Record<string, string> = {
  sent: "送信確認済み",
  failed: "未送信確定",
  unknown: "結果不明",
};

export function LeadImport() {
  const { state, mutate, audit } = useVault();
  const [items, setItems] = useState<ImportItem[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!state) return null;

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const myEmail = state?.profile.email.trim();
    const opts = myEmail ? { myEmails: [myEmail] } : undefined;
    const next: ImportItem[] = [];
    for (const f of Array.from(list)) {
      try {
        const buf = await f.arrayBuffer();
        const parsed = isSpreadsheetName(f.name)
          ? parseSpreadsheetFile(f.name, buf)
          : parseImportFile(f.name, decodeImportFile(buf), opts);
        for (const p of parsed) next.push({ ...p, include: true });
      } catch {
        next.push({
          id: `IMP${Date.now().toString(36)}_err${next.length}`,
          sourceName: f.name,
          kind: "",
          company: "",
          name: "",
          email: "",
          subject: "",
          body: "",
          sentAt: "",
          sendResult: "",
          sourceUrl: "",
          stopFlag: false,
          note: "",
          warnings: ["ファイルを読み取れませんでした"],
          include: true,
        });
      }
    }
    setItems((cur) => [...cur, ...next]);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function update(id: string, fn: (it: ImportItem) => void) {
    setItems((cur) =>
      cur.map((it) => {
        if (it.id !== id) return it;
        const copy = { ...it };
        fn(copy);
        return copy;
      }),
    );
  }

  const isDup = (it: ImportItem) =>
    !!it.company.trim() && (state?.leads ?? []).some((l) => l.company === it.company.trim());
  const dupInBatch = (it: ImportItem) =>
    items.filter((x) => x.include && x.company.trim() && x.company.trim() === it.company.trim())
      .length > 1;

  const valid = items.filter((it) => it.include && it.kind !== "" && it.company.trim() !== "");
  const blocked = items.filter((it) => it.include && (it.kind === "" || it.company.trim() === ""));

  function createAll() {
    if (!state || valid.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const targets = valid.map((v) => v.id);
    void mutate((s) => {
      for (const it of valid) {
        const lead = makeEmptyLead();
        lead.company = it.company.trim();
        lead.name = it.name.trim();
        lead.email = it.email.trim();
        if (it.kind === "inbound") {
          // 相手からの問い合わせ。本人が書いた内容が届くので「本人申告」として扱う
          lead.leadKind = "hpInquiry";
          lead.source = "site";
          lead.infoBasis = "declared";
          lead.consultMemo = it.body;
          lead.contact = it.note || "HPの問い合わせフォームから相談を受信";
        } else {
          lead.channel = it.kind === "emailOut" ? "email" : "form";
          lead.source = "その他";
          lead.sendState = it.sendResult;
          lead.sentSubject = it.subject || null;
          lead.sentBody = it.body;
          if (it.sendResult === "sent") {
            lead.status = "sent";
            lead.sentAt = it.sentAt || today;
          }
          lead.sendLog.push({
            at: it.sentAt ? new Date(`${it.sentAt}T00:00:00`).toISOString() : new Date().toISOString(),
            kind: it.kind === "emailOut" ? "import:email" : "import:form",
          });
          lead.contact =
            it.note ||
            (it.kind === "emailOut"
              ? `営業メールを送信（${it.subject || "件名なし"}）`
              : "問い合わせフォームから営業文を送信");
        }
        if (it.sourceUrl) {
          lead.sources = lead.sources ?? [];
          lead.sources.push({
            id: "SRC" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            url: it.sourceUrl,
            pageTitle: "",
            excerpt: "",
            confirmedAt: it.sentAt || today,
          });
        }
        if (it.stopFlag) {
          lead.contactStop = {
            stopped: true,
            reason: "取込元の記録（連絡停止フラグ）",
            at: it.sentAt || today,
          };
        }
        s.leads.push(lead);
        s.currentLeadId = lead.id;
      }
    });
    audit("lead_import", {
      count: valid.length,
      kinds: valid.reduce<Record<string, number>>((a, it) => {
        a[it.kind] = (a[it.kind] ?? 0) + 1;
        return a;
      }, {}),
    });
    setItems((cur) => cur.filter((it) => !targets.includes(it.id)));
    setDone(`${valid.length} 件をリードとして作成しました。② 一覧で確認できます。`);
  }

  return (
    <Panel
      title="ファイルから読み取る（自動振り分け）"
      note="送信記録や問い合わせ通知のファイルを読み取り、メール送信／フォーム送信／問い合わせ受信に振り分けて新規リードを作ります。判定はキー名と定型句のルールだけで行い、推測で項目を埋めません。判定できないものは「不明」のまま残し、人が選んでから作成します。"
    >
      <div
        data-dropzone="lead-import"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors ${
          dragging
            ? "border-[#0e7490] bg-[rgba(14,116,144,0.14)]"
            : "border-line-strong bg-ink-850 hover:border-[#0e7490]"
        }`}
      >
        <p className="text-[13px] text-paper">
          ここにファイルをドラッグ＆ドロップ
        </p>
        <p className="text-[11px] leading-relaxed text-paper-faint">
          対応形式: JSON・NDJSON（送信記録）/ CSV・TSV（1行目が見出し）/
          Excel（.xlsx・.xls）/ テキスト（.txt・.md）/ メール（.eml）
          　複数ファイルをまとめて読めます。
          <br />
          Excelから書き出したCSV（Shift_JIS）もそのまま読めます。
          .emlは、差出人が設定画面のメールアドレスと一致すれば「こちらからの送信」と判定します。
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => fileRef.current?.click()}
          >
            ファイルを選ぶ
          </button>
          {items.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setItems([])}>
              読み取り済みの項目をすべて外す
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".json,.jsonl,.ndjson,.csv,.tsv,.txt,.md,.eml,.xlsx,.xls"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>

      {done && (
        <div className="mt-3">
          <Note tone="ok">{done}</Note>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="tbl w-full text-[12px]">
            <thead>
              <tr>
                <th className="w-10">取込</th>
                <th className="w-56">種別</th>
                <th className="min-w-[180px]">企業名 / 担当者</th>
                <th className="w-28">送信日</th>
                <th className="w-28">送信結果</th>
                <th className="min-w-[160px]">確認事項</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="accent-[#0e7490]"
                      checked={it.include}
                      onChange={(e) => update(it.id, (x) => void (x.include = e.target.checked))}
                    />
                  </td>
                  <td>
                    <select
                      className="field py-1 text-[12px]"
                      aria-label="種別"
                      value={it.kind}
                      onChange={(e) =>
                        update(it.id, (x) => void (x.kind = e.target.value as ImportKind))
                      }
                    >
                      {IMPORT_KIND_OPTIONS.map(([v, lbl]) => (
                        <option key={v} value={v}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="field py-1 text-[12px]"
                      placeholder="企業名（必須）"
                      value={it.company}
                      onChange={(e) => update(it.id, (x) => void (x.company = e.target.value))}
                    />
                    <input
                      className="field mt-1 py-1 text-[12px]"
                      placeholder="担当者名"
                      value={it.name}
                      onChange={(e) => update(it.id, (x) => void (x.name = e.target.value))}
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {isDup(it) && <Badge color="#C9A961">同名企業あり（統合はしません）</Badge>}
                      {dupInBatch(it) && <Badge color="#C9A961">この読み取り内で同名</Badge>}
                      {it.stopFlag && <Badge color="#B85C38">連絡停止フラグ</Badge>}
                    </div>
                  </td>
                  <td className="num">{it.sentAt || "—"}</td>
                  <td>{it.sendResult ? RESULT_LABEL[it.sendResult] : "—"}</td>
                  <td>
                    <div className="space-y-0.5 text-[11px] text-paper-faint">
                      <div className="num">{it.sourceName}</div>
                      {it.warnings.map((w, i) => (
                        <div key={i} className="text-[#c9a961]">
                          {w}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          {blocked.length > 0 && (
            <Note tone="warn">
              種別が「不明」または企業名が空の {blocked.length}{" "}
              件は作成されず残ります。種別を選び、企業名を入れてから実行してください。
            </Note>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={valid.length === 0}
            onClick={createAll}
          >
            {valid.length} 件をリードとして作成
          </button>
        </div>
      )}
    </Panel>
  );
}
