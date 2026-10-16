/** リード① 追加とメール文面の生成 */
import { useState } from "react";
import { useVault } from "../../hooks/use-vault";
import { useCurrentLead } from "../../hooks/use-current";
import {
  Area,
  Badge,
  CopyButton,
  Empty,
  Field,
  Grid,
  Note,
  Panel,
  Sec,
  Select,
} from "../../components/kit";
import { Mask } from "../../components/mask";
import { LEAD_SOURCES, OPTIN_BASES } from "../../domain/data/sales";
import { buildPatterns } from "../../domain/logic/pricing";
import { assignPattern, sanitizeInput } from "../../domain/logic/sales";
import { makeEmptyLead } from "../../domain/logic/state";
import { LeadImport } from "./import";

const PATTERN_OPTS: [string, string][] = [
  ["auto", "自動で順番に割り当てる（1→2→3）"],
  ["1", "1. 堅実版"],
  ["2", "2. カジュアル版"],
  ["3", "3. 課題提起版"],
  ["4", "4. パーソナライズ版"],
];

export function LeadGenerate() {
  const { state, mutate, audit } = useVault();
  const { l, patch } = useCurrentLead();
  const [form, setForm] = useState({
    company: "",
    name: "",
    dept: "",
    role: "",
    email: "",
    industry: "",
    contact: "",
    hypothesis: "",
    source: "",
    assign: "auto",
  });
  const [err, setErr] = useState<string | null>(null);

  if (!state) return null;

  function add() {
    if (!form.company.trim() || !form.name.trim()) {
      setErr("送信先の企業名と担当者名は必ず入れてください。");
      return;
    }
    setErr(null);
    void mutate((s) => {
      const { pattern, nextCounter } = assignPattern(form.assign, s.leadCounter);
      s.leadCounter = nextCounter;
      const lead = makeEmptyLead();
      lead.company = sanitizeInput(form.company, 200);
      lead.name = sanitizeInput(form.name, 100);
      lead.dept = sanitizeInput(form.dept, 100);
      lead.role = sanitizeInput(form.role, 100);
      lead.email = sanitizeInput(form.email, 200);
      lead.industry = sanitizeInput(form.industry, 100);
      lead.contact = sanitizeInput(form.contact, 1000);
      lead.hypothesis = sanitizeInput(form.hypothesis, 1000);
      lead.source = form.source;
      lead.pattern = pattern;
      s.leads.push(lead);
      s.currentLeadId = lead.id;
    });
    audit("lead_create", { company: form.company });
    setForm({
      company: "",
      name: "",
      dept: "",
      role: "",
      email: "",
      industry: "",
      contact: "",
      hypothesis: "",
      source: "",
      assign: "auto",
    });
  }

  const patterns = l ? buildPatterns(l, state.profile) : [];
  const selected = patterns.find((p) => p.no === (l?.pattern ?? 1)) ?? patterns[0];

  return (
    <div className="space-y-4">
      <LeadImport />

      <Panel
        title="リードを追加する"
        note="接点・きっかけを具体的に入れると、文面のパーソナライズが効きます。"
        right={
          <button className="btn btn-primary btn-sm" onClick={add}>
            追加して文面を作る
          </button>
        }
      >
        <Grid cols={3}>
          <Field
            label="企業名（必須）"
            value={form.company}
            onChange={(v) => setForm((f) => ({ ...f, company: v }))}
          />
          <Field
            label="担当者名（必須）"
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          <Field
            label="メールアドレス"
            type="email"
            value={form.email}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          />
          <Field
            label="部署"
            value={form.dept}
            onChange={(v) => setForm((f) => ({ ...f, dept: v }))}
          />
          <Field
            label="役職"
            value={form.role}
            onChange={(v) => setForm((f) => ({ ...f, role: v }))}
          />
          <Field
            label="業種"
            value={form.industry}
            onChange={(v) => setForm((f) => ({ ...f, industry: v }))}
          />
        </Grid>
        <div className="mt-4 space-y-3">
          <Area
            label="接点・きっかけ"
            value={form.contact}
            rows={2}
            onChange={(v) => setForm((f) => ({ ...f, contact: v }))}
            placeholder="○○という記事を拝読 / セミナーで名刺交換 / 紹介者は△△さん"
            hint="ここが具体的であるほど返信率が変わります。文面にそのまま差し込まれます。"
          />
          <Area
            label="課題の仮説"
            value={form.hypothesis}
            rows={2}
            onChange={(v) => setForm((f) => ({ ...f, hypothesis: v }))}
            placeholder="受発注の電話対応に人手が取られているのではないか"
          />
          <Grid cols={2}>
            <Select
              label="どこから来たか"
              value={form.source}
              onChange={(v) => setForm((f) => ({ ...f, source: v }))}
              options={[["", "未設定"], ...LEAD_SOURCES.map((s) => [s, s] as [string, string])]}
            />
            <Select
              label="使う文面の型"
              value={form.assign}
              onChange={(v) => setForm((f) => ({ ...f, assign: v }))}
              options={PATTERN_OPTS}
              hint="自動にすると1→2→3を順番に使い、どの型が返信されやすいかを比べられます。"
            />
          </Grid>
        </div>
        {err && (
          <div className="mt-3">
            <Note tone="alert">{err}</Note>
          </div>
        )}
      </Panel>

      {!l ? (
        <Empty>リードを追加すると、ここに送る文面が出ます。</Empty>
      ) : (
        <>
          <ComplianceCheck />

          <Panel
            title="送る文面"
            note={`このリードには型 ${l.pattern} を割り当てています。ほかの型も見比べられます。`}
            right={
              <div className="flex gap-1">
                {patterns.map((p) => (
                  <button
                    key={p.no}
                    className={`btn btn-sm ${p.no === l.pattern ? "btn-primary" : ""}`}
                    onClick={() => void patch((x) => void (x.pattern = p.no))}
                  >
                    {p.no}
                  </button>
                ))}
              </div>
            }
          >
            {selected && (
              <div className="space-y-3">
                <Badge color="#0e7490">{selected.label}</Badge>

                <div>
                  <Sec>件名の候補</Sec>
                  <div className="space-y-1.5">
                    {selected.subjects.map((s: string, i: number) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-sm border border-line bg-ink-850 px-2.5 py-2"
                      >
                        <span className="min-w-0 flex-1 text-[13px]">
                          <Mask>{s}</Mask>
                        </span>
                        <CopyButton text={s} label="コピー" />
                        <button
                          className={`btn btn-sm ${l.sentSubject === s ? "btn-primary" : ""}`}
                          onClick={() => void patch((x) => void (x.sentSubject = s))}
                        >
                          これを使う
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="field-label mb-0">本文</span>
                    <div className="flex gap-1.5">
                      <CopyButton text={selected.body} label="本文をコピー" />
                      {l.email && (
                        <a
                          className="btn btn-sm"
                          href={`mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(l.sentSubject ?? selected.subjects[0])}&body=${encodeURIComponent(selected.body)}`}
                        >
                          メールソフトで開く
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="doc max-h-[440px] overflow-auto">
                    <Mask>{selected.body}</Mask>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                      void patch((x) => {
                        x.status = "sent";
                        x.sentAt = new Date().toISOString().slice(0, 10);
                        x.sentPattern = x.pattern;
                        x.sendLog.push({ at: new Date().toISOString(), kind: "initial" });
                      })
                    }
                  >
                    送ったことにする
                  </button>
                  {l.status === "sent" && (
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        void patch((x) => {
                          x.status = "replied";
                          x.repliedAt = new Date().toISOString().slice(0, 10);
                        })
                      }
                    >
                      返信があった
                    </button>
                  )}
                  {l.sentAt && (
                    <span className="num self-center text-[11px] text-paper-faint">
                      送信 {l.sentAt} / 型 {l.sentPattern}
                    </span>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Note tone="warn">
            型4（パーソナライズ版）は、括弧で示した段落を実際に見た内容へ必ず差し替えてから送ってください。
            そのまま送ると逆効果になります。
          </Note>
        </>
      )}
    </div>
  );
}

function ComplianceCheck() {
  const { l, patch } = useCurrentLead();
  if (!l) return null;
  const ok = !!l.optinBasis;
  return (
    <Panel
      title="送る前の確認"
      note="広告・宣伝を含むメールは、送ってよい相手かどうかを確認したうえで送ります（特定電子メール法）。"
    >
      <div className="space-y-1.5">
        {OPTIN_BASES.map(([v, label]) => (
          <label
            key={v}
            className="flex cursor-pointer items-start gap-2 text-[13px] leading-relaxed text-paper"
          >
            <input
              type="radio"
              name="optin"
              className="mt-1 accent-[#0e7490]"
              checked={l.optinBasis === v}
              onChange={() => void patch((x) => void (x.optinBasis = v))}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-3">
        {ok ? (
          <Note tone="ok">
            根拠を選びました。文面の末尾には送信者情報と配信停止の案内が自動で入っています。
          </Note>
        ) : (
          <Note tone="alert">
            送ってよい根拠が選ばれていません。当てはまるものがない相手には送らないでください。
          </Note>
        )}
      </div>
      {l.sendLog.length > 0 && (
        <div className="mt-3">
          <Sec>送信の記録</Sec>
          <ul className="space-y-0.5 text-[12px] text-paper-dim">
            {l.sendLog.map((s, i) => (
              <li key={i} className="num">
                {new Date(s.at).toLocaleString("ja-JP")} — {s.kind}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
