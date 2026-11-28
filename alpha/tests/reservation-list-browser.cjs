const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.STUDYSEAT_TEST_URL || 'http://127.0.0.1:5057';
const evidence = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/reservation-list-review');
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { resolve, reject, promise }; };
const contains = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });
const queues = new WeakMap();
let sequence = 0;

// A stable GET route controls only delivery/failure; every snapshot comes from real Flask.
async function holdList(page, mode = 'success') {
  let queue = queues.get(page);
  if (!queue) {
    queue = [];
    queues.set(page, queue);
    await page.route('**/api/v1/reservations', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const slot = queue.find(item => !item.captured);
      if (!slot) return route.continue();
      slot.captured = true;
      try {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        slot.snapshot = (await response.json()).data;
        slot.ready.resolve();
        await slot.release.promise;
        if (slot.mode === 'abort') await route.abort('failed');
        else if (slot.mode === '503') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '受控旧列表读取失败' } }) });
        else await route.fulfill({ response });
        slot.delivered.resolve();
      } catch (error) {
        slot.ready.reject(error);
        slot.delivered.reject(error);
      }
    });
  }
  const slot = { mode, ready: deferred(), release: deferred(), delivered: deferred(), captured: false };
  const marker = `list-consumed-${++sequence}`;
  await page.evaluate(marker => {
    const original = window.fetch;
    let captured = false;
    window.fetch = async (...args) => {
      const selected = !captured && String(args[0]) === '/api/v1/reservations' && (args[1]?.method || 'GET') === 'GET';
      if (selected) captured = true;
      const finished = () => setTimeout(() => { window[marker] = true; }, 0);
      try {
        const response = await original(...args);
        if (selected) {
          const json = response.json.bind(response);
          response.json = async () => { try { return await json(); } finally { finished(); } };
        }
        return response;
      } catch (error) {
        if (selected) finished();
        throw error;
      }
    };
  }, marker);
  queue.push(slot);
  return { ready: slot.ready.promise, snapshot: () => slot.snapshot, release: async () => {
    slot.release.resolve(); await slot.delivered.promise;
    // Next task after JSON consumption or network rejection: callers and finally have run.
    await page.waitForFunction(marker => window[marker], marker);
  } };
}
async function login(page, complete = true) {
  await page.locator('#username').fill('832402116');
  await page.locator('#password').fill('123456');
  await page.locator('#login-form button').click();
  await contains(page, 'identity', '832402116');
  if (complete) {
    await page.waitForFunction(() => document.querySelectorAll('#room-id option').length === 4 && !document.getElementById('search-fields').disabled);
    await page.locator('#reload-reservations').waitFor({ state: 'visible' });
  }
}
async function search(page, hour) {
  const date = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  await page.locator('#room-id').selectOption('lib-a101');
  await page.locator('#start-at').fill(`${date}T${String(hour).padStart(2, '0')}:00`);
  await page.locator('#end-at').fill(`${date}T${String(hour + 1).padStart(2, '0')}:00`);
  await page.locator('#search-form button').click();
  await contains(page, 'availability', '此时段可预约');
}
const card = (page, record) => page.locator(`#reservations [data-reservation-id="${record.id}"]`);
async function create(page) {
  const result = page.waitForResponse(r => r.url().endsWith('/api/v1/reservations') && r.request().method() === 'POST');
  await page.locator('#booking-form button').click();
  const response = await result;
  assert.equal(response.status(), 201);
  const record = (await response.json()).data;
  await contains(page, 'status', '预约已保存，可刷新');
  await card(page, record).waitFor();
  return record;
}
async function backend(page) {
  const response = await page.request.get(base + '/api/v1/reservations');
  assert.equal(response.status(), 200);
  return (await response.json()).data;
}
async function cleanup(page) {
  const session = await page.request.get(base + '/api/v1/auth/session');
  const csrf = (await session.json()).data.csrf_token;
  for (const record of await backend(page)) if (record.status === 'PENDING_CHECKIN') {
    const result = await page.request.post(base + `/api/v1/reservations/${record.id}/cancel`, { headers: { 'X-CSRF-Token': csrf } });
    assert.equal(result.status(), 200);
  }
}
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  const results = [];
  let nextHour = 9;
  async function scenario(name, task) {
    console.log('SCENARIO', name);
    const context = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/diagnostics', base).href);
      await page.locator('#username').waitFor({ state: 'visible' });
      const proof = await task(page, nextHour++);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
      results.push({ name, result: 'passed', proof });
      await cleanup(page);
    } catch (error) {
      await page.screenshot({ path: path.join(evidence, `${name}-failure.png`), fullPage: true });
      const ui = await page.evaluate(() => ({ list: document.getElementById('reservations').textContent, status: document.getElementById('status').textContent }));
      fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ result: 'failed', scenario: name, completed: results, ui, server_records: await backend(page), error: error.stack }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  try {
    await scenario('A-empty-list-after-create', async (page, hour) => {
      await login(page); await search(page, hour);
      const old = await holdList(page);
      await page.locator('#reload-reservations').click(); await old.ready;
      assert.deepEqual(old.snapshot(), []);
      const record = await create(page);
      const status = await page.locator('#status').textContent();
      await old.release();
      assert.equal(await card(page, record).count(), 1, 'old empty list must not hide the saved reservation');
      assert((await card(page, record).textContent()).includes('待签到'));
      assert.equal(await page.locator('#status').textContent(), status);
      assert.equal((await backend(page)).find(r => r.id === record.id).status, 'PENDING_CHECKIN');
      return { reservation_id: record.id, old_count: 0, server_status: 'PENDING_CHECKIN' };
    });
    for (const order of ['new-first', 'old-first']) await scenario(`B-D-cancel-${order}`, async (page, hour) => {
      await login(page); await search(page, hour);
      const record = await create(page);
      const old = await holdList(page);
      await page.locator('#reload-reservations').click(); await old.ready;
      assert.equal(old.snapshot().find(r => r.id === record.id).status, 'PENDING_CHECKIN');
      const newer = await holdList(page);
      await card(page, record).getByRole('button', { name: '取消预约' }).click(); await newer.ready;
      assert.equal(newer.snapshot().find(r => r.id === record.id).status, 'CANCELLED');
      if (order === 'old-first') {
        await old.release();
        assert(await page.locator('#reload-reservations').isDisabled(), 'old finally must not enable the newer list load');
      }
      await newer.release();
      await contains(page, 'status', '已取消');
      const status = await page.locator('#status').textContent();
      if (order === 'new-first') await old.release();
      assert((await card(page, record).textContent()).includes('已取消'));
      assert.equal(await card(page, record).locator('button').count(), 0);
      assert.equal(await page.locator('#status').textContent(), status);
      assert.equal((await backend(page)).find(r => r.id === record.id).status, 'CANCELLED');
      return { order, reservation_id: record.id, server_status: 'CANCELLED' };
    });
    for (const mode of ['503', 'abort']) await scenario(`C-old-error-${mode}`, async (page, hour) => {
      await login(page); await search(page, hour);
      const old = await holdList(page, mode);
      await page.locator('#reload-reservations').click(); await old.ready;
      const record = await create(page);
      const newest = await holdList(page);
      await page.locator('#reload-reservations').click(); await newest.ready;
      const status = await page.locator('#status').textContent();
      await old.release();
      assert.equal(await card(page, record).count(), 1);
      assert.equal(await page.locator('#status').textContent(), status);
      assert(await page.locator('#reload-reservations').isDisabled(), 'stale error cleanup must not release the latest button');
      await newest.release();
      assert.equal(await card(page, record).count(), 1);
      assert(await page.locator('#reload-reservations').isEnabled());
      assert(!(await page.locator('#status').textContent()).includes('失败'));
      return { failure_mode: mode, reservation_id: record.id, server_status: (await backend(page)).find(r => r.id === record.id).status };
    });
    await scenario('E-current-error-remains-visible-and-retryable', async page => {
      await login(page);
      const failed = await holdList(page, '503');
      await page.locator('#reload-reservations').click(); await failed.ready;
      await failed.release();
      await contains(page, 'status', '受控旧列表读取失败');
      assert((await page.locator('#reservations').textContent()).includes('预约加载失败'));
      assert(await page.locator('#reload-reservations').isEnabled());
      await page.locator('#reload-reservations').click();
      await page.waitForFunction(() => !document.getElementById('reload-reservations').disabled);
      assert(!(await page.locator('#reservations').textContent()).includes('预约加载失败'));
      assert.equal(await page.locator('#status').textContent(), '');
      return { current_error_visible: true, retry_succeeded: true };
    });
    await scenario('F-superseded-initial-list-keeps-catalog', async (page, hour) => {
      const old = await holdList(page);
      await login(page, false); await old.ready;
      await page.locator('#note').fill('list-order-initialization-retry');
      await page.locator('#note-form button').click();
      await contains(page, 'status', '已保存，可刷新');
      const current = await page.locator('#reservations').textContent();
      await old.release();
      assert.equal(await page.locator('#reservations').textContent(), current);
      assert.equal(await page.locator('#room-id option').count(), 4);
      assert(await page.locator('#start-at').isEnabled());
      assert(await page.locator('#reload-dashboard').isHidden());
      await search(page, hour);
      return { room_options: 4, catalog_enabled: true };
    });
    const report = { result: 'passed', executed_at: new Date().toISOString(), browser: await browser.version(), channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge', playwright: require('playwright/package.json').version, scenarios: results };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
