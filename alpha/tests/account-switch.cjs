const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const baseURL = process.env.STUDYSEAT_TEST_URL || 'http://127.0.0.1:5059';
const evidence = path.resolve(process.env.STUDYSEAT_EVIDENCE_DIR || 'alpha/evidence/account-switch');
const accounts = { A: ['832402116', '123456'], B: ['student02', 'Study1234'], admin: ['admin01', 'Admin1234'] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const contains = (page, id, text) => page.waitForFunction(({ id, text }) => document.getElementById(id).textContent.includes(text), { id, text });
const notesLoaded = page => page.waitForFunction(() => {
  const text = document.getElementById('notes').textContent;
  return text !== '' && !text.includes('记录尚未加载');
});

async function login(page, who) {
  await page.locator('#username').waitFor({ state: 'visible' });
  await page.locator('#username').fill(accounts[who][0]);
  await page.locator('#password').fill(accounts[who][1]);
  await page.locator('#login-form button').click();
  await contains(page, 'identity', accounts[who][0]);
}
async function logout(page) {
  await page.locator('#logout').click();
  await page.locator('#username').waitFor({ state: 'visible' });
  await page.locator('#logout').waitFor({ state: 'hidden' });
}
async function save(page, marker) {
  await page.locator('#note').fill(marker);
  await page.locator('#note-form button').click();
  await contains(page, 'status', '已保存');
}
async function backend(page, endpoint) {
  return page.evaluate(async endpoint => { const response = await fetch('/api/v1' + endpoint); return { status: response.status, body: await response.json() }; }, endpoint);
}
async function fail(page, endpoint) {
  const route = `**/api/v1${endpoint}`;
  await page.route(route, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: '测试模拟的读取失败' } }) }));
  return () => page.unroute(route);
}
async function hold(page, endpoint) {
  const ready = deferred(), release = deferred(), delivered = deferred();
  const barrier = `response-${Date.now()}-${endpoint}`;
  await page.evaluate(({ endpoint, barrier }) => {
    const originalFetch = window.fetch;
    let captured = false;
    window.__responseBarriers ||= {};
    window.fetch = async (...args) => {
      const selected = !captured && String(args[0]) === '/api/v1' + endpoint;
      if (selected) captured = true;
      const response = await originalFetch(...args);
      if (selected) {
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const body = await originalJson();
          // Signal on the next task, after the consumer's promise continuations ran.
          setTimeout(() => { window.__responseBarriers[barrier] = true; }, 0);
          return body;
        };
      }
      return response;
    };
  }, { endpoint, barrier });
  const pattern = `**/api/v1${endpoint}`;
  await page.route(pattern, async route => {
    // Complete the real authenticated response before allowing an identity switch.
    const response = await route.fetch();
    ready.resolve();
    await release.promise;
    await route.fulfill({ response });
    delivered.resolve();
  }, { times: 1 });
  return { ready: ready.promise, release: async () => {
    release.resolve(); await delivered.promise;
    await page.waitForFunction(barrier => window.__responseBarriers[barrier], barrier);
    await page.unroute(pattern);
  } };
}

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge' });
  const results = [];
  async function scenario(name, task) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(new URL('/diagnostics', baseURL).href);
      await page.locator('#username').waitFor({ state: 'visible' });
      await task(page);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
      results.push({ name, result: 'passed' });
    } finally { await context.close(); }
  }
  try {
    await scenario('T1-logout-private-state', async page => {
      await login(page, 'A'); await save(page, `A_PRIVATE_${Date.now()}`);
      await page.locator('#note').fill('unsaved-private-draft');
      await logout(page);
      for (const id of ['welcome', 'identity', 'notes', 'events']) assert.equal(await page.locator('#' + id).textContent(), '');
      assert.equal(await page.locator('#note').inputValue(), '');
      assert.equal(await page.locator('#password').inputValue(), '');
      assert.equal(await page.locator('#admin').isVisible(), false);
      await login(page, 'admin'); await contains(page, 'events', '登录'); await logout(page);
      assert.equal(await page.locator('#events').textContent(), '');
      assert.equal(await page.locator('#admin').isVisible(), false);
    });
    await scenario('T2-notes-failure-isolation', async page => {
      await login(page, 'A'); const marker = `A_PRIVATE_${Date.now()}`; await save(page, marker);
      const notes = (await backend(page, '/persistence-notes')).body.data;
      const note = notes.find(n => n.content === marker);
      await logout(page); const remove = await fail(page, '/persistence-notes');
      await login(page, 'B'); await contains(page, 'status', '测试模拟的读取失败');
      assert.equal((await page.locator('#notes').textContent()).includes(marker), false);
      await remove();
      assert.equal((await backend(page, '/persistence-notes')).body.data.some(n => n.content === marker), false);
      assert.equal((await backend(page, '/persistence-notes/' + note.id)).status, 404);
      await page.reload(); await notesLoaded(page);
      assert.equal((await page.locator('#notes').textContent()).includes(marker), false);
    });
    await scenario('T3-rules-failure-hides-admin', async page => {
      await login(page, 'admin'); await contains(page, 'events', '登录'); await logout(page);
      const remove = await fail(page, '/rules'); await login(page, 'B');
      await contains(page, 'status', '测试模拟的读取失败');
      assert.equal(await page.locator('#admin').isVisible(), false);
      assert.equal(await page.locator('#events').textContent(), '');
      assert.equal((await backend(page, '/admin/audit-events')).status, 403);
      await remove();
    });
    for (const [who, endpoint, node] of [['A', '/persistence-notes', 'notes'], ['admin', '/admin/audit-events', 'events']]) {
      await scenario(`T4-delayed-${node}`, async page => {
        await login(page, who); await contains(page, who === 'A' ? 'notes' : 'events', who === 'A' ? 'A_PRIVATE_' : '登录');
        const pending = await hold(page, endpoint);
        await page.locator('#note').fill(`DELAYED_${Date.now()}`);
        await page.locator('#note-form button').click(); await pending.ready;
        await logout(page); await login(page, 'B'); await notesLoaded(page);
        const currentNotes = await page.locator('#notes').textContent();
        await pending.release();
        // A fresh current-generation read is a completion barrier for the old delivery.
        await backend(page, '/me');
        assert.equal((await page.locator('#identity').textContent()).includes('student02'), true);
        assert.equal((await page.locator('#notes').textContent()).includes('A_PRIVATE_'), false);
        assert.equal(await page.locator('#notes').textContent(), currentNotes);
        assert.equal(await page.locator('#events').textContent(), '');
        assert.equal(await page.locator('#admin').isVisible(), false);
      });
    }
    await scenario('T4-delayed-session-csrf', async page => {
      await login(page, 'A'); await contains(page, 'notes', 'A_PRIVATE_');
      const pending = await hold(page, '/auth/session');
      await page.locator('#note').fill(`CSRF_REFRESH_${Date.now()}`); await page.locator('#note-form button').click(); await pending.ready;
      await logout(page); await login(page, 'B'); await notesLoaded(page);
      await pending.release(); await backend(page, '/me');
      assert.equal((await page.locator('#identity').textContent()).includes('student02'), true);
      // A successful B mutation proves its current CSRF was not replaced by A's token.
      await save(page, `B_CURRENT_CSRF_${Date.now()}`);
      assert.equal((await backend(page, '/admin/audit-events')).status, 403);
    });
    const report = { result: 'passed', executed_at: new Date().toISOString(), browser: await browser.version(), channel: process.env.STUDYSEAT_BROWSER_CHANNEL || 'msedge', playwright: require('playwright/package.json').version, scenarios: results };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ result: 'failed', passed: results, message: error.message }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
