const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.STUDYSEAT_TEST_URL || 'http://127.0.0.1:5057';
const evidence = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/phase3-review/browser');
const contains = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(new URL('/diagnostics', base).href);
    await page.locator('#username').waitFor();
    await page.locator('#username').fill('admin01'); await page.locator('#password').fill('Admin1234');
    await page.locator('#login-form button').click();
    await page.waitForFunction(() => !document.getElementById('admin-fields').disabled);
    assert.equal(await page.locator('#rule-leave').inputValue(), '30');
    const ready = deferred(), release = deferred(), delivered = deferred();
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (String(args[0]) === '/api/v1/persistence-notes' && args[1]?.method === 'POST') {
          const json = response.json.bind(response);
          response.json = async () => { const body = await json(); setTimeout(() => { window.noteReceiptConsumed = true; }, 0); return body; };
        }
        return response;
      };
    });
    await page.route('**/api/v1/persistence-notes', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      ready.resolve(); await release.promise;
      await route.fulfill({ response }); delivered.resolve();
    }, { times: 1 });
    const marker = `draft-survives-note-${Date.now()}`;
    await page.locator('#note').fill(marker);
    await page.locator('#note-form button').click(); await ready.promise;
    await page.locator('#rule-leave').fill('45');
    release.resolve(); await delivered.promise;
    await page.waitForFunction(() => window.noteReceiptConsumed);
    await contains(page, 'status', '已保存');
    assert.equal(await page.locator('#rule-leave').inputValue(), '45', 'late note receipt must preserve the new rule draft');
    await contains(page, 'notes', marker);
    const rules = await page.request.get(base + '/api/v1/rules');
    assert.equal((await rules.json()).data.settings.leave_limit_minutes, 30);
    let dialogText;
    page.once('dialog', async dialog => { dialogText = dialog.message(); await dialog.dismiss(); });
    await page.locator('#logout').click();
    assert(dialogText?.includes('规则修改尚未保存'));
    assert(await page.locator('#dashboard').isVisible());
    assert.equal(await page.locator('#rule-leave').inputValue(), '45');
    await page.locator('#rules-form button[type="submit"]').click();
    await contains(page, 'status', '规则已保存');
    assert.equal((await (await page.request.get(base + '/api/v1/rules')).json()).data.settings.leave_limit_minutes, 45);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(evidence, 'draft-preserved.png'), fullPage: true });
    const checks = ['real POST receipt delayed while new rule draft is edited', 'draft remains 45 and database remains 30 until explicit rule save', 'unsaved-exit confirmation remains active', 'draft saves as 45 via real admin API', 'no page errors'];
    const left = await browser.newPage();
    const right = await browser.newPage();
    for (const student of [left, right]) {
      student.setDefaultTimeout(12000);
      student.on('pageerror', error => errors.push(error.message));
      await student.goto(new URL('/diagnostics', base).href); await student.locator('#username').waitFor();
      await student.locator('#username').fill('832402116'); await student.locator('#password').fill('123456');
      await student.locator('#login-form button').click();
      await student.waitForFunction(() => document.querySelectorAll('#room-id option').length === 4 && !document.getElementById('search-fields').disabled);
    }
    async function reload(student) {
      await student.locator('#reload-reservations').click();
      await student.waitForFunction(() => !document.getElementById('reload-reservations').disabled);
    }
    async function action(student, id, label, state) {
      await student.locator(`[data-reservation-id="${id}"]`).getByRole('button', { name: label, exact: true }).click();
      await student.locator(`[data-reservation-id="${id}"]`).filter({ hasText: state }).waitFor();
      await contains(student, 'status', '已保存');
    }
    for (const lateAction of ['leave', 'return']) {
      const csrf = (await (await left.request.get(base + '/api/v1/auth/session')).json()).data.csrf_token;
      const now = new Date((await (await left.request.get(base + '/api/v1/health')).json()).data.server_time);
      const start = new Date(now.getTime() + 120000);
      const created = await left.request.post(base + '/api/v1/reservations', { headers: { 'X-CSRF-Token': csrf }, data: {
        seat_id: 'activity-24:A01', start_at: start.toISOString(), end_at: new Date(start.getTime() + 3600000).toISOString(), idempotency_key: `review-cycle-${lateAction}`,
      } });
      assert.equal(created.status(), 201);
      const record = (await created.json()).data;
      await reload(left);
      await action(left, record.id, '签到（页面确认）', '使用中');
      if (lateAction === 'return') await action(left, record.id, '暂离', '暂离中');
      const observed = (await (await left.request.get(base + '/api/v1/reservations/' + record.id)).json()).data;
      const waiting = deferred(), send = deferred();
      const endpoint = base + `/api/v1/reservations/${record.id}/${lateAction}`;
      await left.route(endpoint, async route => {
        assert.equal(route.request().postDataJSON().expected_version, observed.state_version);
        waiting.resolve(); await send.promise; await route.continue();
      }, { times: 1 });
      await left.locator(`[data-reservation-id="${record.id}"]`).getByRole('button', { name: lateAction === 'leave' ? '暂离' : '返回座位', exact: true }).click();
      await waiting.promise;
      await reload(right);
      if (lateAction === 'leave') {
        await action(right, record.id, '暂离', '暂离中'); await action(right, record.id, '返回座位', '使用中');
      } else {
        await action(right, record.id, '返回座位', '使用中'); await action(right, record.id, '暂离', '暂离中');
      }
      const before = (await (await right.request.get(base + '/api/v1/reservations/' + record.id)).json()).data;
      const auditBefore = (await (await page.request.get(base + '/api/v1/admin/audit-events')).json()).data;
      const response = left.waitForResponse(response => response.url() === endpoint);
      send.resolve();
      assert.equal((await response).status(), 409);
      await contains(left, 'status', '预约状态已改变');
      assert.deepEqual((await (await right.request.get(base + '/api/v1/reservations/' + record.id)).json()).data, before);
      assert.deepEqual((await (await page.request.get(base + '/api/v1/admin/audit-events')).json()).data, auditBefore);
      await reload(left);
      await action(left, record.id, '结束使用', '已结束');
      checks.push(`two real student sessions: first delayed ${lateAction} rejected with 409; later cycle/deadline/audits unchanged; refresh recovers`);
    }
    assert.deepEqual(errors, []);
    await left.screenshot({ path: path.join(evidence, 'stale-cycle-recovered.png'), fullPage: true });
    const report = { result: 'passed', executed_at: new Date().toISOString(), browser: await browser.version(), channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge', checks };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ result: 'failed', error: error.stack, rule_leave: await page.locator('#rule-leave').inputValue(), status: await page.locator('#status').textContent() }, null, 2));
    await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
