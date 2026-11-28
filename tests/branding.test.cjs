const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Approved book-and-seat mark is identical in prototype, live UI and export assets', () => {
  const canonical = read('prototype/brand-mark.svg');
  for (const file of ['alpha/studyseat/static/brand-mark.svg', 'deploy/assets/brand-mark.svg']) {
    assert.equal(read(file), canonical, file);
  }
  const paths = [...canonical.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  for (const file of ['deploy/assets/js/studyseat-prototype.js', 'modao/StudySeat_定版原型.html', 'deploy/assets/icon.svg']) {
    const text = read(file);
    for (const shape of paths) assert(text.includes(shape), file + ': missing approved shape');
    assert(!/[\u2667\u2663\u2618\u{1F340}]/u.test(text), file + ': retired brand remains');
  }
  const live = read('alpha/studyseat/static/prototype.js');
  assert(live.includes('src="/static/brand-mark.svg"'));
  assert(!/[\u2667\u2663\u2618\u{1F340}]/u.test(live));
  assert(read('alpha/studyseat/templates/prototype.html').includes("filename='brand-mark.svg'"));
});
