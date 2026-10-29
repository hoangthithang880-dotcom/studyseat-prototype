const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('Current documentation replaces retired Modao guides and accurately describes the formal component',()=>{
 for(const name of ['墨刀搭建指南-StudySeat.md','墨刀AI生成提示词-StudySeat学生端.md','原型使用与演示指南.md','原型交付与使用说明.md','blog-原型设计.md','import-proto.js'])assert(!fs.existsSync(path.join(root,name)),name);
 const guide=fs.readFileSync(path.join(root,'docs/墨刀原型搭建与维护说明.md'),'utf8');
 for(const name of ['00 正式入口｜Study Seat','375×812','学生与管理端业务数据独立','刷新或重新打开恢复初始场景','不是墨刀原生工程文件'])assert(guide.includes(name),name);
 const backup=fs.readFileSync(path.join(root,'modao/StudySeat_定版原型.html'),'utf8');assert(backup.includes('id="global-back"'));assert(backup.includes('window.UNIFIED_STUDENT='));assert(backup.includes('window.UNIFIED_ADMIN='));
});
test('GitHub export is self-contained, matches source hashes, excludes unrelated files and refuses overwrite',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'studyseat-submission-')),output=path.join(temporary,'repository');
 const python=process.env.STUDYSEAT_PYTHON||'python3';
 try{
  execFileSync(python,[path.join(root,'scripts/prepare-github.py'),'--output',output]);
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'SUBMISSION_MANIFEST.json'),'utf8'));
  for(const file of manifest.files){assert.equal(createHash('sha256').update(fs.readFileSync(path.join(output,file.path))).digest('hex'),file.sha256,file.path);assert(fs.readFileSync(path.join(root,file.path)).equals(fs.readFileSync(path.join(output,file.path))));}
  for(const name of ['.git','studyseat-raw','studyseat-blue','studyseat-admin','studyseat-supply','ph.json','srs-content.md','srs-images','ppt-inspect','blog-dump.txt','blog-structure.json','fix-data.js','tests/legacy','docs/验收与演示说明.md','docs/screenshots/before-login.png'])assert(!fs.existsSync(path.join(output,name)),name);
  const before=fs.readFileSync(path.join(output,'README.md'));assert.throws(()=>execFileSync(python,[path.join(root,'scripts/prepare-github.py'),'--output',output],{stdio:'pipe'}));assert(fs.readFileSync(path.join(output,'README.md')).equals(before));
  // The exported source can regenerate the deployable site without any ancestor workspace.
  const prior=fs.readFileSync(path.join(output,'docs/prototype-release.json'));execFileSync(python,[path.join(output,'scripts/build-prototype.py')]);assert(fs.readFileSync(path.join(output,'docs/prototype-release.json')).equals(prior));
  for(const file of [path.join(output,'README.md'),...fs.readdirSync(path.join(output,'docs')).filter(n=>n.endsWith('.md')).map(n=>path.join(output,'docs',n))])for(const [,url]of fs.readFileSync(file,'utf8').matchAll(/\]\(([^\s)]+)\)/g)){if(/^(https?:|#)/.test(url))continue;assert(fs.existsSync(path.resolve(path.dirname(file),decodeURIComponent(url.split('#')[0]))),file+': '+url);}
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
