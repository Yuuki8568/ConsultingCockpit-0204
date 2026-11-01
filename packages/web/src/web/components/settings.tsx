import { PasskeyPanel } from "./passkey-panel";
import { authorize } from "../lib/step-up";
import { rewrapWriteKey } from "../lib/write-signing";
/** 設定 — 受託者プロフィール／書類雛形／文面ライブラリ／紹介／保全／端末／監査／取込 */
import { useEffect, useRef, useState } from "react";
import { useVault } from "../hooks/use-vault";
import {
  Area,
  Badge,
  ConfirmButton,
  CopyButton,
  Empty,
  Field,
  Grid,
  Modal,
  Note,
  NumField,
  Panel,
  Sec,
  Select,
  Stat,
  Tabs,
} from "./kit";
import { BUILT_IN_TEMPLATES, DOC_TYPE_DEFS } from "../domain/data/doc-templates";
import { MSG_TEMPLATES } from "../domain/data/templates-msg";
import { importVaultState, previewImport, reloadBuiltInTemplates } from "../domain/logic/state";
import { evaluatePassphraseStrength, relativeTime } from "../domain/logic/util";
import { client } from "../lib/api";
import {
  buildVerifier,
  checkVerifier,
  deriveVaultKeys,
  newSalt,
} from "../lib/crypto/vault-crypto";
import { SEC_CONFIG } from "../lib/security";
import { buildEncryptedBackup, decryptBackup, isEncryptedBackup } from "../lib/export/backup";
import { deviceIdFor, vaultStore } from "../lib/store/vault-store";
import { useDesktop } from "../hooks/use-desktop";
import { AutomaticBackupSettings } from "./automatic-backup";
import { DesktopBackup } from "./desktop-backup";

type Tab = "profile" | "templates" | "messages" | "referrals" | "security" | "data";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "受託者プロフィール" },
  { id: "templates", label: "書類雛形" },
  { id: "messages", label: "文面ライブラリ" },
  { id: "referrals", label: "紹介" },
  { id: "security", label: "保全・端末" },
  { id: "data", label: "取込・書き出し" },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("profile");
  return (
    <Modal open={open} onClose={onClose} title="設定" wide>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "profile" && <ProfileTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "messages" && <MessagesTab />}
      {tab === "referrals" && <ReferralsTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "data" && <DataTab />}
    </Modal>
  );
}

function ProfileTab() {
  const { state, mutate } = useVault();
  if (!state) return null;
  const p = state.profile;
  const set = (k: keyof typeof p) => (v: string) =>
    void mutate((s) => void (s.profile[k] = v), ["profile:main"]);

  const empty = (["address", "email", "invoice", "bank"] as const).filter((k) => !p[k]);

  return (
    <div className="space-y-4">
      <Note tone="info">
        ここに入れた内容が、すべての書類の乙（受託者）欄に差し込まれます。
        空欄のままだと書類に［要入力］と出ます。
      </Note>
      <Panel title="基本">
        <Grid cols={2}>
          <Field label="屋号" value={p.yago} onChange={set("yago")} />
          <Field label="氏名" value={p.name} onChange={set("name")} />
          <Field label="所在地" value={p.address} onChange={set("address")} />
          <Field label="メールアドレス" type="email" value={p.email} onChange={set("email")} />
          <Field label="ポートフォリオURL" value={p.url} onChange={set("url")} />
          <Field
            label="インボイス登録番号"
            value={p.invoice}
            onChange={set("invoice")}
            mono
            placeholder="T1234567890123"
          />
        </Grid>
        <div className="mt-3">
          <Area
            label="振込先口座"
            value={p.bank}
            rows={3}
            onChange={set("bank")}
            placeholder={"○○銀行 △△支店\n普通 1234567\nヤマシロ ユウキ"}
          />
        </div>
      </Panel>
      {empty.length > 0 && (
        <Note tone="warn">
          未入力の項目があります（
          {empty
            .map(
              (k) =>
                ({
                  address: "所在地",
                  email: "メールアドレス",
                  invoice: "インボイス番号",
                  bank: "口座",
                })[k],
            )
            .join("、")}
          ）。書類を出す前に埋めてください。
        </Note>
      )}
      <Note tone="info">
        屋号は「山代業務改善事務所」で統一しています。旧い表記や旧字体の氏名が残っている
        金庫は、取り込み時に正規表記へ自動で寄せています。
      </Note>
    </div>
  );
}

function TemplatesTab() {
  const { state, mutate } = useVault();
  const [editing, setEditing] = useState<string | null>(null);
  if (!state) return null;

  const keys = Object.keys(DOC_TYPE_DEFS);

  return (
    <div className="space-y-4">
      <Note tone="info">
        雛形の中の <code>{"{{甲企業名}}"}</code> のような部分は、書類を作るときに
        案件情報と受託者プロフィールから自動で埋まります。
        ここは旧案件用の保存雛形です。新規案件の2026-10-23承認版は版を固定して別管理し、この画面の上書きでは更新しません。新規版の案件条件は⑨契約・法務の案件条件・情報管理票から確認してください。
      </Note>

      <Panel
        title="旧案件用・12種類の保存雛形"
        right={
          <ConfirmButton
            label="組込雛形で全部上書き"
            confirmLabel="編集内容を捨てて戻す"
            className="btn btn-sm btn-danger"
            onConfirm={() => void mutate((s) => reloadBuiltInTemplates(s))}
          />
        }
      >
        <table className="tbl">
          <thead>
            <tr>
              <th>書類</th>
              <th className="w-20">記号</th>
              <th className="w-24">文字数</th>
              <th className="w-24">状態</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const def = (DOC_TYPE_DEFS as Record<string, { jp: string; code: string }>)[k];
              const body = state.docTemplates[k] ?? "";
              const modified = body !== (BUILT_IN_TEMPLATES as Record<string, string>)[k];
              return (
                <tr key={k}>
                  <td>{def.jp}</td>
                  <td className="num text-[12px]">{def.code}</td>
                  <td className="n text-[12px]">{body.length.toLocaleString("ja-JP")}</td>
                  <td>
                    {modified ? <Badge color="#C9A961">編集済み</Badge> : <Badge>組込</Badge>}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setEditing(k)}>
                      編集
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing
            ? `雛形の編集 — ${(DOC_TYPE_DEFS as Record<string, { jp: string }>)[editing].jp}`
            : ""
        }
        wide
        footer={
          editing && (
            <>
              <ConfirmButton
                label="組込雛形に戻す"
                confirmLabel="編集を捨てて戻す"
                onConfirm={() =>
                  void mutate(
                    (s) => {
                      s.docTemplates[editing] = (BUILT_IN_TEMPLATES as Record<string, string>)[
                        editing
                      ];
                    },
                    [`template:${editing}`],
                  )
                }
              />
              <CopyButton text={state.docTemplates[editing] ?? ""} label="全文をコピー" />
            </>
          )
        }
      >
        {editing && (
          <textarea
            className="field font-body max-h-[60vh] min-h-[420px] resize-y text-[13px] leading-[1.9]"
            value={state.docTemplates[editing] ?? ""}
            onChange={(e) =>
              void mutate(
                (s) => {
                  s.docTemplates[editing] = e.target.value;
                },
                [`template:${editing}`],
              )
            }
          />
        )}
      </Modal>
    </div>
  );
}

function MessagesTab() {
  const cats = Object.keys(MSG_TEMPLATES);
  const [cat, setCat] = useState(cats[0]);
  const list = (MSG_TEMPLATES as Record<string, { name: string; subject: string; body: string }[]>)[
    cat
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button
            key={c}
            className={`btn btn-sm ${c === cat ? "btn-primary" : ""}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {list.map((t, i) => (
          <Panel key={i} title={t.name} right={<CopyButton text={t.body} label="本文をコピー" />}>
            <p className="mb-2 text-[12px] text-paper-dim">件名：{t.subject}</p>
            <div className="doc max-h-64 overflow-auto text-[13px]">{t.body}</div>
          </Panel>
        ))}
      </div>
      <Note tone="info">
        <code>{"{{甲担当者}}"}</code> のような部分は、⑧継続サポートから使うと案件情報で自動で埋まります。
        ここでコピーする場合は手で直してください。
      </Note>
    </div>
  );
}

function ReferralsTab() {
  const { state, mutate } = useVault();
  if (!state) return null;
  const list = state.referrals;

  return (
    <Panel
      title="紹介の記録"
      note="誰から誰へつないだかを残します。紹介料のやり取りはしない前提です。"
      right={
        <button
          className="btn btn-primary btn-sm"
          onClick={() =>
            void mutate(
              (s) =>
                s.referrals.push({
                  id: "F" + Date.now().toString(36),
                  from: "",
                  to: "",
                  at: new Date().toISOString().slice(0, 10),
                  status: "依頼中",
                  note: "",
                }),
              ["meta:app"],
            )
          }
        >
          + 紹介
        </button>
      }
    >
      {list.length === 0 ? (
        <Empty>まだありません。</Empty>
      ) : (
        <div className="space-y-2">
          {list.map((r, i) => (
            <div key={r.id} className="rounded-sm border border-line bg-ink-850 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[130px] flex-1">
                  <Field
                    label="紹介してくれた人"
                    value={r.from}
                    onChange={(v) =>
                      void mutate((s) => void (s.referrals[i].from = v), ["meta:app"])
                    }
                  />
                </div>
                <div className="min-w-[130px] flex-1">
                  <Field
                    label="紹介先"
                    value={r.to}
                    onChange={(v) => void mutate((s) => void (s.referrals[i].to = v), ["meta:app"])}
                  />
                </div>
                <div className="w-[140px]">
                  <Field
                    label="日付"
                    type="date"
                    value={r.at}
                    onChange={(v) => void mutate((s) => void (s.referrals[i].at = v), ["meta:app"])}
                  />
                </div>
                <div className="w-[130px]">
                  <Select
                    label="状態"
                    value={r.status}
                    onChange={(v) =>
                      void mutate((s) => void (s.referrals[i].status = v), ["meta:app"])
                    }
                    options={[
                      ["依頼中", "依頼中"],
                      ["紹介済み", "紹介済み"],
                      ["面談実施", "面談実施"],
                      ["案件化", "案件化"],
                      ["見送り", "見送り"],
                    ]}
                  />
                </div>
                <ConfirmButton
                  label="削除"
                  onConfirm={() => void mutate((s) => s.referrals.splice(i, 1), ["meta:app"])}
                />
              </div>
              <input
                className="field mt-2 py-1 text-[12px]"
                placeholder="メモ"
                value={r.note}
                onChange={(e) =>
                  void mutate((s) => void (s.referrals[i].note = e.target.value), ["meta:app"])
                }
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SecurityTab() {
  const { sync, state, mutate, lock } = useVault();
  const [devices, setDevices] = useState<
    { id: string; label: string; platform: string; lastSeenAtMs: number; revokedAtMs: number | null }[]
  >([]);
  const [history, setHistory] = useState<
    { id: string; atMs: number; kind: string; platform: string | null }[]
  >([]);
  const [chain, setChain] = useState<{ ok: boolean; checked: number; reason?: string } | null>(
    null,
  );
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<{ id: string; at: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [rekeyOpen, setRekeyOpen] = useState(false);
  const [loadErrors, setLoadErrors] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);
  const myId = deviceIdFor();

  const load = async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    const results = await Promise.allSettled([
      client.devices.list(), client.devices.loginHistory({ limit: 50 }), client.audit.count(), vaultStore.listConflicts(),
    ]);
    if (version !== loadVersion.current) return;
    const errors: Record<string,string> = {};
    const [d,h,c,f] = results;
    if(d.status==='fulfilled') setDevices(d.value); else { setDevices([]); errors.devices='端末一覧を取得できません。ログイン状態と通信を確認して再取得してください。'; }
    if(h.status==='fulfilled') setHistory(h.value); else { setHistory([]); errors.history='ログイン履歴を取得できませんでした。端末一覧の取得とは別のエラーです。'; }
    if(c.status==='fulfilled') setAuditCount(c.value.count); else { setAuditCount(null); errors.audit='操作記録の件数を取得できませんでした。'; }
    if(f.status==='fulfilled') setConflicts(f.value.map(x=>({id:x.id,at:x.at}))); else { setConflicts([]); errors.conflicts='端末内の競合記録を取得できませんでした。'; }
    setLoadErrors(errors);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    return () => { ++loadVersion.current; };
  }, []);

  if (!state) return null;

  return (
    <div className="space-y-4">
      <Panel title="どう守られているか">
        <div className="space-y-2 text-[13px] leading-relaxed text-paper-dim">
          <p>
            <span className="text-paper">鍵の作り方：</span>PBKDF2-SHA256 を{" "}
            <span className="num">{SEC_CONFIG.KDF_ITERATIONS.toLocaleString()}</span>{" "}
            回繰り返してパスフレーズから鍵を作ります。
          </p>
          <p>
            <span className="text-paper">暗号化：</span>AES-GCM 256bit。案件・リード・雛形は
            1件ずつ別に封をして、初期化ベクトルは毎回作り直しています。
          </p>
          <p>
            <span className="text-paper">預ける先に届くもの：</span>暗号文と初期化ベクトルだけです。
            パスフレーズも鍵も送っていないため、こちらのサーバーからは中身を読めません。
          </p>
          <p>
            <span className="text-paper">施錠：</span>操作が
            {Math.round(SEC_CONFIG.SESSION_TIMEOUT_MS / 60000)}分ないと自動で閉じ、
            {Math.round(SEC_CONFIG.WARN_AT_MS / 60000)}分で予告を出します。
          </p>
          <p>
            <span className="text-paper">解錠の制限：</span>
            この端末では {SEC_CONFIG.MAX_FAILURES}回続けて間違えると
            {Math.round(SEC_CONFIG.LOCKOUT_MS / 60000)}分停止します。
            さらに、解錠に使う材料の受け取りはサーバー側でも回数を制限しています
            （15分に20回まで。超えると5分間は渡しません）。
            ただし、材料を取得済みの相手が手元で総当たりする攻撃はこの仕組みでは防げません。
            長くて推測されにくいパスフレーズが最後の防御です。
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button className="btn btn-sm" onClick={() => lock("manual")}>
            いま施錠する
          </button>
          <button className="btn btn-sm" onClick={() => setRekeyOpen(true)}>
            パスフレーズを変える
          </button>
        </div>
      </Panel>

      <Panel title="同期の状態" right={<button className="btn btn-sm" disabled={loading} onClick={() => void load()}>{loading ? "取得中…" : "更新"}</button>}>
        <Grid cols={3}>
          <Stat
            label="未送信"
            value={sync.pending}
            color={sync.pending > 0 ? "#C9A961" : "#4A7C59"}
          />
          <Stat
            label="最終同期"
            value={sync.lastSyncedAtMs ? relativeTime(sync.lastSyncedAtMs) : "—"}
          />
          <Stat label="案件 / リード" value={`${state.cases.length} / ${state.leads.length}`} />
        </Grid>
        {sync.lastError && (
          <div className="mt-3">
            <Note tone="alert">{sync.lastError}</Note>
          </div>
        )}
      </Panel>

      {Object.entries(loadErrors).filter(([key])=>key!=="devices").map(([key,message])=><Note key={key} tone="alert">{message}</Note>)}
      {conflicts.length > 0 && (
        <Panel title="同じ場所を別々に直した記録" note="後から保存した側を採用し、負けた側をここに残しています。">
          <div className="space-y-1.5">
            {conflicts.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-sm border border-warn/40 bg-warn/8 px-2.5 py-2 text-[12px]"
              >
                <span className="num flex-1 truncate">{c.id}</span>
                <span className="num text-paper-faint">
                  {new Date(c.at).toLocaleString("ja-JP")}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await vaultStore.dismissConflict(c.id);
                    void load();
                  }}
                >
                  消す
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="この金庫を開いている端末" note="使わなくなった端末は失効させてください。">
        {loading ? <Empty>端末一覧を取得中…</Empty> : loadErrors.devices ? <div className="space-y-2"><Note tone="alert">{loadErrors.devices}</Note><button className="btn btn-primary" onClick={() => void load()}>再取得</button></div> : devices.length === 0 ? (
          <Empty>登録済みの端末はありません。</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>端末</th>
                <th className="w-24">種類</th>
                <th className="w-32">最後の利用</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.label}
                    {d.id === myId && (
                      <span className="ml-2">
                        <Badge color="#0e7490">この端末</Badge>
                      </span>
                    )}
                    {d.revokedAtMs && (
                      <span className="ml-2">
                        <Badge color="#B85C38">失効</Badge>
                      </span>
                    )}
                  </td>
                  <td className="text-[12px]">{d.platform}</td>
                  <td className="num text-[12px]">{relativeTime(d.lastSeenAtMs)}</td>
                  <td>
                    {d.id === myId ? (
                      <span className="text-[11px] text-paper-faint">—</span>
                    ) : d.revokedAtMs ? (
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          await client.devices.unrevoke({id:d.id,authorization:await authorize("device:unrevoke",{id:d.id})});
                          void load();
                        }}
                      >
                        戻す
                      </button>
                    ) : (
                      <ConfirmButton
                        label="失効"
                        confirmLabel="失効させる"
                        onConfirm={async () => {
                          await client.devices.revoke({id:d.id,authorization:await authorize("device:revoke",{id:d.id})});
                          void load();
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="操作の記録"
        note={auditCount != null ? `${auditCount} 件記録されています。` : undefined}
        right={
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setChain(await client.audit.verifyChain());
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "確認中…" : "改ざんがないか確認"}
          </button>
        }
      >
        <p className="mb-3 text-[12px] leading-relaxed text-paper-dim">
          1件ごとに直前の記録のハッシュを含めているため、途中を書き換えたり抜いたりすると
          つながりが合わなくなります。5分ごとに別の保存先へ末尾を記録します。直近の未記録部分の削除や、両方の保存先が改変された場合まで検出を保証するものではありません。対象企業名などの詳細は暗号化して保存しています。
        </p>
        {chain && (
          <Note tone={chain.ok ? "ok" : "alert"}>
            {chain.ok
              ? `${chain.checked} 件の連鎖と、独立保存済みの地点が一致しました。`
              : `検査未完了または不一致：${chain.reason}`}
          </Note>
        )}

        <div className="mt-4">
          <Sec>サインインと解錠の履歴</Sec>
          {history.length === 0 ? (
            <Empty>まだありません。</Empty>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="tbl">
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="num w-44 text-[12px]">
                        {new Date(h.atMs).toLocaleString("ja-JP")}
                      </td>
                      <td className="text-[12px]">
                        {
                          {
                            signin: "サインイン",
                            unlock_ok: "解錠",
                            unlock_fail: "解錠の失敗",
                            lockout: "一時停止",
                            manual_lock: "手動で施錠",
                            auto_lock: "自動で施錠",
                            signout: "サインアウト",
                            unlock_params: "解錠の材料を受け取り",
                            server_throttle: "試行が続いたため一時停止（サーバー側）",
                          }[h.kind] ?? h.kind
                        }
                      </td>
                      <td className="text-[12px] text-paper-faint">{h.platform ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2">
            <ConfirmButton
              label="履歴を消す"
              onConfirm={async () => {
                await client.devices.clearLoginHistory();
                void load();
              }}
            />
          </div>
        </div>
      </Panel>

      <Panel title="いつまで残すか" note="削除した案件・リードを、何日後に完全に消すかを決めます。">
        <div className="w-56">
          <NumField
            label="削除から完全消去までの日数"
            value={state.retentionDays ?? 0}
            onChange={(v) => void mutate((s) => void (s.retentionDays = v), ["meta:app"])}
            suffix="日"
            min={0}
            max={3650}
            hint="0 なら自動で消しません。"
          />
        </div>
        {(state.retentionDays ?? 0) > 0 && (
          <button
            className="btn btn-sm mt-3"
            onClick={async () => {
              const r = await client.sync.purgeDeleted({
                olderThanDays: state.retentionDays ?? 30,
              });
              alert(`${r.purged} 件を完全に消しました。`);
            }}
          >
            いま適用する
          </button>
        )}
      </Panel>

      <RekeyModal open={rekeyOpen} onClose={() => setRekeyOpen(false)} />
    </div>
  );
}

function RekeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);

  const ready = cur && n1.length >= 10 && n1 === n2 && !busy;

  async function go() {
    setBusy(true);
    setMsg(null);
    // 途中で失敗したときに元のままへ戻せるよう、3段階で行う。
    // 1. 新しい鍵で封じ直したものを用意（この時点では今の鍵もデータも変わらない）
    // 2. サーバー側を1トランザクションで差し替え
    // 3. 成功してからローカルへ書き戻して鍵を切り替える
    let prepared: Awaited<ReturnType<typeof vaultStore.prepareReencrypt>> | null = null;
    try {
      const st = await client.vault.status();
      if (!st.exists) throw new Error("金庫が見つかりません");
      const p = await client.vault.unlockParams();
      const oldKeys = await deriveVaultKeys(cur, p.kdfSalt, p.kdfIterations);
      const ok = await checkVerifier(oldKeys.vaultKey, {
        ciphertext: p.verifierCiphertext,
        iv: p.verifierIv,
      });
      if (!ok) {
        setMsg({ tone: "alert", text: "いまのパスフレーズが違います。" });
        return;
      }
      const salt = newSalt();
      const newKeys = await deriveVaultKeys(n1, salt, SEC_CONFIG.KDF_ITERATIONS);
      const verifier = await buildVerifier(newKeys.vaultKey);
      // レコードと録画を新しい鍵で封じ直す（録画は仮チャンクとして置く）
      prepared = await vaultStore.prepareReencrypt(newKeys.vaultKey, newKeys.macKey);
      const request = {
        writeKey: await rewrapWriteKey(oldKeys.vaultKey,newKeys.vaultKey),
        expectedGeneration: prepared.generation,
        kdfSalt: salt,
        kdfIterations: SEC_CONFIG.KDF_ITERATIONS,
        verifierCiphertext: verifier.ciphertext,
        verifierIv: verifier.iv,
        records: prepared.records,
      };
      await vaultStore.saveRekeyRequest(request);
      const res = await client.vault.rekey({...request,authorization:await authorize("vault:rekey",request)}, { signal: AbortSignal.timeout(15000) });
      await vaultStore.commitReencrypt(newKeys.vaultKey, newKeys.macKey, prepared);
      vaultStore.setBackupKdf(salt, SEC_CONFIG.KDF_ITERATIONS);
      prepared = null;
      setMsg({
        tone: "ok",
        text:
          `変更しました。${res.reEncrypted} 件を新しい鍵で封じ直しました。` +
          "この端末にある録画・録音も新しい鍵で封じ直しています。次回からは新しいパスフレーズで開きます。",
      });
      setCur("");
      setN1("");
      setN2("");
    } catch (e) {
      // 失敗した場合は仮チャンクを捨てて、今の鍵・データは元のままにする
      await vaultStore.abortReencrypt().catch(() => undefined);
      setMsg({
        tone: "alert",
        text:
          (e instanceof Error ? e.message : String(e)) +
          "（確定状態を確認できない場合があります。旧・新両方のパスフレーズを保管し、再解錠してください。復旧原本は削除していません）",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="パスフレーズを変える"
      footer={
        <button className="btn btn-primary btn-sm" disabled={!ready} onClick={() => void go()}>
          {busy ? "封じ直しています…" : "変更する"}
        </button>
      }
    >
      <div className="space-y-3">
        <Note tone="warn">
          全データとこの端末の録画・録音を新しい鍵で暗号化し直します。件数が多いと少し時間がかかります。
          途中で失敗しても、これまでのパスフレーズのまま使えます。
          なお、過去の操作記録に添付された暗号化メモは旧い鍵で封じられているため、
          変更後は開けなくなります（記録そのものと改ざんの検証は残ります）。
        </Note>
        <div>
          <label className="field-label" htmlFor="pp-cur">
            いまのパスフレーズ
          </label>
          <input
            id="pp-cur"
            type="password"
            className="field"
            value={cur}
            autoComplete="current-password"
            onChange={(e) => setCur(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="pp-new">
            新しいパスフレーズ（10文字以上）
          </label>
          <input
            id="pp-new"
            type="password"
            className="field"
            value={n1}
            autoComplete="new-password"
            onChange={(e) => setN1(e.target.value)}
          />
          {n1 && (
            <p
              className="mt-1 text-[11px]"
              style={{
                color:
                  evaluatePassphraseStrength(n1).level === "weak"
                    ? "#B85C38"
                    : evaluatePassphraseStrength(n1).level === "medium"
                      ? "#C9A961"
                      : "#4A7C59",
              }}
            >
              {evaluatePassphraseStrength(n1).label}
            </p>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="pp-new2">
            確認のためもう一度
          </label>
          <input
            id="pp-new2"
            type="password"
            className="field"
            value={n2}
            autoComplete="new-password"
            onChange={(e) => setN2(e.target.value)}
          />
          {n2 && n1 !== n2 && <p className="mt-1 text-[11px] text-alert">一致していません</p>}
        </div>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </div>
    </Modal>
  );
}

function DataTab() {
  const { state, replaceState, audit } = useVault();
  const desktop = useDesktop();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewImport> | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [raw, setRaw] = useState<string>("");
  const [done, setDone] = useState<string | null>(null);

  if (!state) return null;

  function pick(file: File) {
    const r = new FileReader();
    r.onload = () => {
      void (async () => {
        let text = String(r.result ?? "");
        if (isEncryptedBackup(text)) {
          // 暗号化された控えは、この金庫の鍵で開いてから確認画面へ進む
          try {
            text = await decryptBackup(text, backupPassphrase || undefined);
            setBackupPassphrase("");
          } catch {
            setPreview({
              ok: false,
              error:
                "この控えを開けませんでした。この金庫のパスフレーズで封じられた控えか、ファイルが壊れていないかを確認してください。",
              cases: 0,
              leads: 0,
              templates: 0,
              referrals: 0,
              generatedDocs: 0,
              reports: 0,
            });
            setRaw("");
            setDone(null);
            return;
          }
        }
        setRaw(text);
        setPreview(previewImport(text));
        setDone(null);
      })();
    };
    r.readAsText(file, "utf-8");
  }

  function download(json: string) {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cockpit-backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function exportEncrypted() {
    const s = vaultStore.getState();
    if (!s) return;
    download(await buildEncryptedBackup(s));
    audit("backup_export_encrypted");
  }

  function exportPlain() {
    download(vaultStore.exportJson());
    audit("backup_export_plain");
  }

  return (
    <div className="space-y-4">
      <Panel
        title="旧版（v3）のデータを取り込む"
        note="Netlify 版で書き出した JSON をそのまま読み込めます。"
      >
        <label className="field-label">別の金庫・鍵変更前の控えを復元する場合：出力時のパスフレーズ
          <input className="field" type="password" autoComplete="off" value={backupPassphrase}
            onChange={(e) => setBackupPassphrase(e.target.value)} />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
          }}
        />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          JSON ファイルを選ぶ
        </button>

        {preview && (
          <div className="mt-4">
            {preview.ok ? (
              <>
                <Sec>読み込む前の確認</Sec>
                <Grid cols={3}>
                  <Stat label="案件" value={preview.cases} />
                  <Stat label="リード" value={preview.leads} />
                  <Stat label="書類雛形" value={preview.templates} />
                  <Stat label="作成済み書類" value={preview.generatedDocs} />
                  <Stat label="月次レポート" value={preview.reports} />
                  <Stat label="紹介" value={preview.referrals} />
                </Grid>
                <div className="mt-3">
                  <Note tone="warn">
                    取り込むと、いまこの金庫にある内容（案件 {state.cases.length} 件・リード{" "}
                    {state.leads.length} 件）は置き換わります。
                    先に下の「いまの内容を書き出す」で控えを取ってください。
                  </Note>
                </div>
                <div className="mt-3">
                  <ConfirmButton
                    label="この内容で取り込む"
                    confirmLabel="置き換える（戻せません）"
                    className="btn btn-primary btn-sm"
                    onConfirm={async () => {
                      const next = importVaultState(raw);
                      await replaceState(next);
                      audit("v3_import", {
                        cases: next.cases.length,
                        leads: next.leads.length,
                      });
                      setDone(
                        `案件 ${next.cases.length} 件・リード ${next.leads.length} 件を取り込みました。`,
                      );
                      setPreview(null);
                      setRaw("");
                    }}
                  />
                </div>
              </>
            ) : (
              <Note tone="alert">{preview.error}</Note>
            )}
          </div>
        )}
        {done && (
          <div className="mt-3">
            <Note tone="ok">{done}</Note>
          </div>
        )}
      </Panel>

      <PasskeyPanel /><AutomaticBackupSettings />
      <DesktopBackup />

      <Panel
        title="控えを取る"
        note="標準は暗号化された控えです。開くにはこの金庫のパスフレーズが要ります。"
      >
        <button className="btn btn-primary btn-sm" onClick={() => void exportEncrypted()}>
          暗号化して書き出す（推奨）
        </button>
        <div className="mt-3">
          <ConfirmButton
            label="暗号化せず書き出す"
            confirmLabel="中身が読める形式で書き出す"
            onConfirm={exportPlain}
          />
        </div>
        {desktop && (
          <p className="mt-2 text-[12px] text-paper-dim">
            デスクトップ版では、ダウンロード先のフォルダを固定しておくと控えが溜まっていきます。
          </p>
        )}
        <div className="mt-3 space-y-2">
          <Note tone="info">
            暗号化した控えは、ファイルだけでは中身を読めません。復元は上の取り込みから行えます
            （この金庫のパスフレーズで開きます）。
            録画・録音の本体は控えに含まれません（この端末にだけ置いてあるため）。
          </Note>
          <Note tone="warn">
            「暗号化せず書き出す」は中身がそのまま読める形式です。やり取りの都合で必要な場合だけにし、
            共有フォルダやクラウド同期の対象には置かないでください。
            以前に書き出した暗号化されていない控えは、この変更で自動的に保護されません。
          </Note>
        </div>
      </Panel>

      <Panel title="この端末から消す" note="預けてある分は残ります。別の端末では引き続き開けます。">
        <ConfirmButton
          label="この端末の控えを消して施錠する"
          confirmLabel="消す"
          onConfirm={async () => {
            await vaultStore.wipeLocal();
          }}
        />
      </Panel>

      <Panel title="すべて消す" note="業務データと暗号文の過去世代を消去します。不正防止用の監査記録・制限回数・端末失効情報・パスキーは保持します。">
        <Note tone="alert">
          この操作は戻せません。案件 {state.cases.length} 件・リード {state.leads.length}{" "}
          件と、すべての書類・記録が消えます。金庫そのものも作り直しになります。
        </Note>
        <div className="mt-3">
          <ConfirmButton
            label="すべて消す"
            confirmLabel="本当にすべて消す（戻せません）"
            onConfirm={async () => {
              await client.vault.eraseAll({confirm:"ERASE",authorization:await authorize("vault:erase",{confirm:"ERASE"})});
              await vaultStore.wipeLocal();
              location.reload();
            }}
          />
        </div>
      </Panel>
    </div>
  );
}
