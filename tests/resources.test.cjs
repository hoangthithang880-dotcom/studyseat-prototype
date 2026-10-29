const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const deploy = path.join(root, 'deploy');
test('T29 local assets and page links resolve under a nested deployment directory', () => {
 for (const file of [...fs.readdirSync(deploy).filter(f=>f.endsWith('.html')).map(f=>path.join(deploy,f)),path.join(root,'index.html')]) {
  const html=fs.readFileSync(file,'utf8');
  for(const [, url] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
   if(url.startsWith('#'))continue;
   assert(!/^(https?:|\/\/|\/|file:|javascript:)/.test(url),`${file}: nonrelative asset or link ${url}`);
   const target=path.resolve(path.dirname(file),url.split(/[?#]/)[0]);assert(fs.existsSync(target),`${file}: missing ${url}`);
  }
 }
});
test('T31 deliverable documentation and deployment contain no obsolete rules or false official claims',()=>{
 const files=[path.join(root,'README.md'),path.join(root,'prototype/student-app.js'),...fs.readdirSync(deploy).filter(f=>f.endsWith('.html')).map(f=>path.join(deploy,f))];
 for(const file of files) {
  const text=fs.readFileSync(file,'utf8');
  assert(!/coisininand\.github|每日限约\s*1\s*次|累计\s*3\s*次违约|冻结预约权限\s*7\s*天|统一认证已接入|即时生效.*全体学生/.test(text),file);
 }
});
test('Delivery documents link to existing local instructions, evidence and screenshots',()=>{
 const files=[path.join(root,'README.md'),...fs.readdirSync(path.join(root,'docs')).filter(f=>f.endsWith('.md')).map(f=>path.join(root,'docs',f))];
 for(const file of files){for(const [,url]of fs.readFileSync(file,'utf8').matchAll(/\]\(([^\s)]+)\)/g)){if(/^(https?:|#)/.test(url))continue;assert(fs.existsSync(path.resolve(path.dirname(file),decodeURIComponent(url.split('#')[0]))),`${file}: missing ${url}`);}}
});
test('Formal entry resource URLs match current hashes and the release manifest',()=>{
 const {createHash}=require('node:crypto'),release=JSON.parse(fs.readFileSync(path.join(root,'docs/prototype-release.json'),'utf8'));
 const html=fs.readFileSync(path.join(deploy,'login.html'),'utf8');
 for(const [asset,expected]of Object.entries(release.assets)){
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(deploy,asset))).digest('hex').slice(0,12),expected,asset);
  assert(html.includes(`${asset}?v=${expected}`),asset);
 }
});
test('Every legacy public page resolves to the same formal entry and current release',()=>{
 const {release}=JSON.parse(fs.readFileSync(path.join(root,'docs/prototype-release.json'),'utf8'));
 for(const name of ['index','home','room','confirm','bookings','profile','rules','resources','records']){
  const html=fs.readFileSync(path.join(deploy,name+'.html'),'utf8');
  assert(html.includes('login.html?v='+release),name);
  assert(html.includes('location.replace('),name);
 }
 const entry=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert(entry.includes('deploy/?v='+release));assert(entry.includes('href="deploy/assets/icon.svg"'));
});
