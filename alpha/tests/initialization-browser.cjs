const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.STUDYSEAT_TEST_URL || 'http://127.0.0.1:5057';
const evidence = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/initialization-review');
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { resolve, reject, promise }; };
const contains = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });

async function login(page) {
  await page.locator('#username').fill('832402116');
  await page.locator('#password').fill('123456');
  await page.locator('#login-form button').click();
  await contains(page, 'identity', '832402116');
}
async function initialized(page) {
  await page.waitForFunction(() => document.querySelectorAll('#room-id option').length === 4);
  await page.waitForFunction(() => !document.querySelector('#start-at').disabled && !document.querySelector('#start-at').closest('fieldset')?.disabled);
  await page.locator('#room-id').selectOption('lib-a101');
}
// One stable route per page queues controlled deliveries, including concurrent queries.
const heldRoutes = new WeakMap();
let holdSequence = 0;
async function hold(page, pathname, rejectRead = false) {
  let queue = heldRoutes.get(page);
  if (!queue) {
    queue = [];
    heldRoutes.set(page, queue);
    await page.route('**/api/v1/**', async route => {
      const slot = queue.find(s => !s.captured && new URL(route.request().url()).pathname === '/api/v1' + s.pathname);
      if (!slot) return route.continue();
      slot.captured = true;
      try {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        slot.ready.resolve();
        await slot.release.promise;
        await route.fulfill({ response });
        slot.delivered.resolve();
      } catch (error) {
        slot.ready.reject(error);
        slot.delivered.reject(error);
      }
    });
  }
  const slot = { pathname, ready: deferred(), release: deferred(), delivered: deferred(), captured: false };
  const marker = `consumed-${++holdSequence}`;
  await page.evaluate(({ pathname, marker, rejectRead }) => {
    const original = window.fetch;
    let selected = false;
    window.fetch = async (...args) => {
      const capture = !selected && new URL(String(args[0]), location.href).pathname === '/api/v1' + pathname;
      if (capture) selected = true;
      const response = await original(...args);
      if (capture) {
        const json = response.json.bind(response);
        response.json = async () => {
          const body = await json();
          setTimeout(() => { window[marker] = true; }, 0);
          if (rejectRead) throw new TypeError('受控旧查询读取失败');
          return body;
        };
      }
      return response;
    };
  }, { pathname, marker, rejectRead });
  queue.push(slot);
  return { ready: slot.ready.promise, release: async () => {
    slot.release.resolve(); await slot.delivered.promise;
    await page.waitForFunction(marker => window[marker], marker);
  } };
}
async function search(page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/seats');
  await page.locator('#search-form button').click();
  const result = await response;
  assert.equal(result.status(), 200);
  await contains(page, 'availability', '此时段可预约');
  return result;
}

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  const results = [];
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
      await task(page);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
      results.push({ name, result: 'passed' });
    } catch (error) {
      await page.screenshot({ path: path.join(evidence, `${name}-failure.png`), fullPage: true });
      const state = await page.evaluate(() => ({ rooms: document.querySelectorAll('#room-id option').length, status: document.getElementById('status').textContent, reservations: document.getElementById('reservations').textContent }));
      fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ result: 'failed', scenario: name, completed: results, state, error: error.stack }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  try {
    await scenario('A-delayed-rooms-input', async page => {
      const rooms = await hold(page, '/rooms');
      await login(page); await rooms.ready;
      await page.locator('#student-booking').waitFor({ state: 'visible' });
      const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      if (await page.locator('#start-at').isEnabled()) {
        await page.locator('#start-at').fill(`${tomorrow}T11:00`);
        await page.locator('#end-at').fill(`${tomorrow}T12:00`);
      } else {
        assert(await page.locator('#end-at').isDisabled());
        assert(await page.locator('#room-id').isDisabled());
        assert(await page.locator('#search-form button').isDisabled());
        // Disabled controls also receive synthetic input to exercise invalidation independently.
        await page.locator('#start-at').dispatchEvent('input');
        await page.locator('#end-at').dispatchEvent('input');
      }
      await rooms.release();
      assert.equal(await page.locator('#room-id option').count(), 4, 'room initialization must survive query input');
      await initialized(page);
      assert(await page.locator('#search-form button').isEnabled());
      const start = await page.locator('#start-at').inputValue();
      const end = await page.locator('#end-at').inputValue();
      const response = await search(page);
      const parameters = new URL(response.url()).searchParams;
      assert.equal(parameters.get('start_at'), start + ':00+08:00');
      assert.equal(parameters.get('end_at'), end + ':00+08:00');
      const saved = page.waitForResponse(r => r.url().endsWith('/api/v1/reservations') && r.request().method() === 'POST');
      await page.locator('#booking-form button').click();
      const created = await saved;
      assert.equal(created.status(), 201);
      const record = (await created.json()).data;
      await page.locator(`[data-reservation-id="${record.id}"]`).getByRole('button', { name: '取消预约', exact: true }).waitFor();
      assert.equal(created.request().postDataJSON().start_at, start + ':00+08:00');
      await page.locator(`[data-reservation-id="${record.id}"]`).getByRole('button', { name: '取消预约', exact: true }).click();
      await contains(page, 'status', '已取消');
    });
    for (const order of ['after', 'before']) await scenario(`B-old-seats-${order}-new-query`, async page => {
      await login(page); await initialized(page);
      const old = await hold(page, '/seats');
      await page.locator('#search-form button').click(); await old.ready;
      const start = await page.locator('#start-at').inputValue();
      await page.locator('#end-at').fill(start.slice(0, 10) + 'T11:00');
      await page.locator('#room-id').selectOption('east-b203');
      const newer = await hold(page, '/seats');
      await page.locator('#search-form button').click(); await newer.ready;
      if (order === 'before') {
        await old.release();
        assert(await page.locator('#search-form button').isDisabled(), 'old cleanup must not enable the newer pending query');
        assert.equal(await page.locator('#seat-id option').count(), 0);
      }
      await newer.release();
      await contains(page, 'availability', '47');
      const current = await page.locator('#seat-id').innerHTML();
      assert.equal(await page.locator('#seat-id option').count(), 47);
      if (order === 'after') await old.release();
      assert.equal(await page.locator('#seat-id').innerHTML(), current);
      assert((await page.locator('#availability').textContent()).includes('47'));
      assert(await page.locator('#search-form button').isEnabled());
    });
    await scenario('B-old-read-error-preserves-new-query', async page => {
      await login(page); await initialized(page);
      const old = await hold(page, '/seats', true);
      await page.locator('#search-form button').click(); await old.ready;
      await page.locator('#room-id').selectOption('east-b203');
      await search(page);
      const current = await page.locator('#availability').textContent();
      await old.release();
      assert.equal(await page.locator('#availability').textContent(), current);
      assert.equal(await page.locator('#status').textContent(), '');
      assert.equal(await page.locator('#seat-id option').count(), 47);
    });
    await scenario('C-query-input-preserves-reservation-load', async page => {
      await login(page); await initialized(page);
      const list = await hold(page, '/reservations');
      await page.locator('#reload-reservations').click(); await list.ready;
      const start = await page.locator('#start-at').inputValue();
      await page.locator('#start-at').fill(start.slice(0, 10) + 'T13:00');
      await page.locator('#end-at').fill(start.slice(0, 10) + 'T14:00');
      await list.release();
      assert(!(await page.locator('#reservations').textContent()).includes('正在加载'));
      assert(await page.locator('#reload-reservations').isEnabled());
      assert.equal(await page.locator('#room-id option').count(), 4);
    });
    await scenario('E-initialization-failure-retry', async page => {
      await page.route('**/api/v1/rooms', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '房间读取测试失败' } }) }), { times: 1 });
      await login(page);
      await contains(page, 'status', '房间读取测试失败');
      assert(await page.locator('#search-form button').isDisabled());
      await page.locator('#reload-dashboard').click();
      await initialized(page);
      assert(await page.locator('#start-at').isEnabled());
      await search(page);
    });
    const report = { result: 'passed', executed_at: new Date().toISOString(), browser: await browser.version(), channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge', playwright: require('playwright/package.json').version, scenarios: results };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
