const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function frames(){const context={window:{}};vm.runInNewContext(read('deploy/assets/js/studyseat-frames.js'),context);return context.window;}
function pages(student){return JSON.parse(student.match(/window\.__SSPages=([\s\S]*?);window\.__SSTailwind=/)[1]);}
function scripts(html){return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);}
test('Generated runtime includes the five original student views and independent admin MVP',()=>{
 const f=frames(),views=pages(f.UNIFIED_STUDENT);
 assert.deepEqual(Object.keys(views).sort(),['home.html','room.html','confirm.html','bookings.html','profile.html'].sort());
 for(const name of ['规则配置','资源管理','记录日志','重新开放','预览影响','有未保存的修改'])assert(f.UNIFIED_ADMIN.includes(name),name);
 assert(!views['room.html'].includes('aria-label="返回首页"'));
 assert(views['room.html'].includes('aria-hidden="true" class="w-9 h-9 shrink-0"'));
 assert(views['confirm.html'].includes("window.__SSGo('bookings.html',true)"));
 assert(f.UNIFIED_STUDENT.includes('window.__SSStore=memory()'));
 assert(f.UNIFIED_STUDENT.includes('window.__SSSession=memory()'));
 assert(read('deploy/login.html').includes('id="global-back"'));
});
test('Every generated first-party script, bootstrap and page script parses',()=>{
 for(const file of ['deploy/assets/js/studyseat-prototype.js','deploy/assets/js/studyseat-frames.js','deploy/assets/js/studyseat-admin-model.js','deploy/assets/js/studyseat-admin-ui.js'])new vm.Script(read(file),{filename:file});
 const f=frames();for(const [name,html]of Object.entries({student:f.UNIFIED_STUDENT,admin:f.UNIFIED_ADMIN,...pages(f.UNIFIED_STUDENT)}))for(const [i,s]of scripts(html).entries())new vm.Script(s,{filename:name+':script'+i});
});
test('Build sources are portable and the release retains authenticated navigation guards',()=>{
 const build=read('scripts/build-prototype.py');assert(!build.includes('/Users/'));assert(build.includes("Path(__file__).resolve().parent.parent"));
 const runtime=read('prototype/unified-student-runtime.js'),host=read('deploy/assets/js/studyseat-prototype.js');
 assert(runtime.includes('!window.StudySeat?.getSession()'));assert(runtime.includes('e.source!==parent'));
 assert(host.includes('e.source!==frames[m.role].contentWindow'));
 assert(host.includes("$('#unified-password').value=''"));
});
