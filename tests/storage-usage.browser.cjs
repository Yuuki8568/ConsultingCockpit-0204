// Synthetic storage metadata only. No production connection or customer content.
const { chromium } = require("../packages/web/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const cwd = path.resolve(__dirname, "../packages/web");
const html = "storage-usage-test.html",
  entry = "storage-usage-test.tsx";

(async () => {
  fs.writeFileSync(
    path.join(cwd, html),
    '<meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/storage-usage-test.tsx"></script>',
  );
  fs.writeFileSync(
    path.join(cwd, entry),
    `
import '/src/web/styles.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StorageUsagePanel } from '/src/web/components/storage-usage';
import { AuditVerificationControl } from '/src/web/components/audit-verification';
window.calls = 0;
window.auditCalls = 0;
window.auditInputs = [];
window.root = createRoot(document.body.appendChild(document.createElement('div')));
window.root.render(<main style={{ padding: 12, maxWidth: 700 }}><StorageUsagePanel /><AuditVerificationControl /></main>);
`,
  );
  const server = spawn(
    "node",
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4193"],
    { cwd, stdio: "ignore" },
  );
  let browser;
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch("http://127.0.0.1:4193/" + html)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "Vite startup");
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    for (const width of [360, 412, 1280]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        isMobile: width < 600,
        hasTouch: width < 600,
      });
      await page.route("**/src/web/lib/api.ts", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `
export const client = { vault: { storageUsage: async () => {
  window.calls++;
  if (window.shouldFail) throw Error('must not display raw provider error');
  if (window.defer) await new Promise(resolve => { window.finish = resolve; });
  return window.usage;
} }, audit: { verifyChain: async input => {
  window.auditCalls++; window.auditInputs.push(input);
  if (window.auditFail) throw Error('private-provider-error');
  const result = window.auditResults.shift();
  if (window.auditHoldAt === window.auditCalls) await new Promise(resolve => { window.auditContinue = resolve; });
  return result;
} } };
`,
        }),
      );
      await page.goto("http://127.0.0.1:4193/" + html);
      const button = page.getByRole("button", { name: "保存容量を確認", exact: true });
      await button.waitFor();
      await page.evaluate(() => {
        window.usage = {
          backend: "d1",
          measuredAtMs: 1793923200000,
          records: {
            liveCount: 850,
            deletedCount: 50,
            totalCount: 900,
            liveEncryptedBytes: 1024 * 1024,
            deletedEncryptedBytes: 1024,
            totalEncryptedBytes: 1049600,
            largestCiphertextBytes: 1000,
          },
          revisions: { count: 1200, logicalBytes: 1024 * 1024 * 3 },
          audit: { count: 9000, encryptedPayloadBytes: 2048 },
          logicalBytesTotal: 4197376,
          limits: [
            {
              key: "d1-records",
              label: "案件・リード等の保存件数",
              used: 900,
              limit: 1000,
              unit: "records",
              severity: "critical",
              basis: "exact",
              note: "取り込みを続ける前に、保存方式の見直しが必要です。",
            },
          ],
        };
        window.defer = true;
      });
      assert.equal(await page.evaluate(() => window.calls), 0, "mount must not aggregate storage");
      const box = await button.boundingBox();
      assert.ok(box.height >= 44, "touch target height");
      await button.click();
      await page.getByRole("button", { name: "保存容量を確認中…" }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "保存容量を確認中…" }).isDisabled(),
        true,
      );
      assert.equal(await page.evaluate(() => window.calls), 1, "single manual query");
      await page.evaluate(() => window.finish());
      await page.getByRole("table", { name: "保存容量の内訳" }).waitFor();
      await page.getByText(/Cloudflare D1：/).waitFor();
      await page.getByText("案件・リード等の保存件数：現在の処理上限に近づいています").waitFor();
      assert.equal(
        await page.getByRole("row", { name: /変更前の保存履歴/ }).innerText(),
        "変更前の保存履歴\t1,200\t3 MiB",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        "responsive panel " + width,
      );
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await page.evaluate(() => window.calls), 1, "focus must not aggregate storage");

      await page.evaluate(() => {
        window.defer = false;
        window.shouldFail = true;
      });
      await button.click();
      await page
        .getByText(
          "保存容量を確認できませんでした。通信状態を確認して、しばらくしてから再試行してください。",
        )
        .waitFor();
      assert.equal(
        await page.getByRole("table", { name: "保存容量の内訳" }).count(),
        0,
        "failed refresh clears stale usage",
      );
      assert.equal(
        (await page.locator("body").innerText()).includes("raw provider"),
        false,
        "sanitize errors",
      );
      await page.evaluate(() => {
        window.shouldFail = false;
        window.usage.backend = "libsql";
        window.usage.limits = [];
      });
      await button.click();
      await page.getByText(/現在のサーバーDB：/).waitFor();
      assert.equal(await page.getByText(/Cloudflare D1：/).count(), 0, "no assumed cutover");
      assert.equal(await page.evaluate(() => window.calls), 3);
      console.log("PASS manual storage usage, safe refresh and responsive layout:", width);

      const audit = page.getByRole('button', { name: '改ざんがないか確認', exact: true });
      assert.equal(await page.evaluate(() => window.auditCalls), 0, 'audit is manual only');
      assert.ok((await audit.boundingBox()).height >= 44);
      await page.evaluate(() => {
        window.auditResults = [
          { ok: false, complete: false, checked: 100, total: 205, startedAtMs: 1, startsAtSeq: 1, cursor: 'signed-cursor' },
          { ok: true, complete: true, checked: 205, total: 205, startedAtMs: 1, startsAtSeq: 1 },
        ];
        window.auditHoldAt = 2;
      });
      await audit.click();
      await page.getByRole('status').filter({ hasText: '205 件中 100 件' }).waitFor();
      assert.equal(await page.getByText('205 件の連鎖と、独立保存済みの地点が一致しました。').count(), 0);
      assert.equal(await page.evaluate(() => window.auditInputs[1].cursor), 'signed-cursor');
      await page.evaluate(() => window.auditContinue());
      await page.getByText('205 件の連鎖と、独立保存済みの地点が一致しました。').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);

      // Cancel while the network ignores abort, then release the old response.
      // It must not request another page or restore a stale success message.
      await page.evaluate(() => {
        window.auditResults = [{ ok: false, complete: false, checked: 100, total: 205, startedAtMs: 1, startsAtSeq: 1, cursor: 'old' }];
        window.auditHoldAt = 3;
      });
      await audit.click();
      await page.getByRole('button', { name: '確認を中止', exact: true }).click();
      await page.getByText(/確認を中止しました。全件の確認は完了していません/).waitFor();
      await page.evaluate(() => window.auditContinue());
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.auditCalls), 3);
      assert.equal(await page.getByText('205 件の連鎖と、独立保存済みの地点が一致しました。').count(), 0);
      await page.evaluate(() => { window.auditFail = true; });
      await audit.click();
      await page.getByText(/検証を完了できません。通信とログイン状態を確認し/).waitFor();
      assert.equal((await page.locator('body').innerText()).includes('private-provider-error'), false);

      await page.evaluate(() => {
        window.auditFail = false;
        window.auditResults = [{ ok: false, complete: false, checked: 100, total: 205, startedAtMs: 1, startsAtSeq: 1, cursor: 'unmount' }];
        window.auditHoldAt = 5;
      });
      await audit.click();
      await page.getByRole('button', { name: '確認を中止', exact: true }).waitFor();
      await page.evaluate(() => { window.root.unmount(); window.auditContinue(); });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.auditCalls), 5, 'unmount stops subsequent pages');
      console.log('PASS audit progress, complete-only success, cancellation, errors and unmount:', width);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
    for (const file of [html, entry]) fs.rmSync(path.join(cwd, file), { force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
