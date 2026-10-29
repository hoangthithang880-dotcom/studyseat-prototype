from pathlib import Path
import json,re
PROJECT=Path(__file__).resolve().parent.parent
P=PROJECT/'prototype'
ROOT=PROJECT/'deploy'
def tag(s): return '<script>'+s.replace('</script','<\\/script')+'</script>'
def data(s): return json.dumps(s,ensure_ascii=False).replace('<','\\u003c')
def replace(s,a,b):
    assert a in s, a[:120]
    return s.replace(a,b)
domain=(ROOT/'assets/js/studyseat-domain.js').read_text().replace("adapter('localStorage')","adapter('__SSStore')").replace("adapter('sessionStorage')","adapter('__SSSession')")
adapter=(P/'student-app.js').read_text()
adapter=replace(adapter,'function navigate(href, replace = false) { if (replace) location.replace(versionedPage(href)); else location.href = versionedPage(href); }','function navigate(href, replace = false) { window.__SSGo(href,replace); }')
adapter=adapter.replace('location.search','window.__SSQuery').replace('location.reload()', 'window.__SSGo(window.__SSCurrent,true)')
adapter=replace(adapter,"let filter = 'ALL'", "let filter = window.__SSBookingFilter || 'ALL'")
adapter=replace(adapter,'filter=b.dataset.filter;bookingsPage(true);','filter=b.dataset.filter;window.__SSBookingFilter=filter;bookingsPage(true);')
adapter=replace(adapter,"S.logout(); navigate('login.html');", "window.__SSSend('requestLogout');")
adapter=replace(adapter,"window.closeSuccess = () => $('#successOverlay').classList.add('hidden');", "window.closeSuccess = () => { const overlay=$('#successOverlay');if(overlay&&!overlay.classList.contains('hidden'))window.__SSGo('bookings.html',true); };")
adapter=replace(adapter,"$('#successOverlay').classList.remove('hidden');", "$('#successOverlay').classList.remove('hidden');window.__SSHasReceipt=true;")
# The existing checkout listener must consume the click before generic link navigation.
adapter=replace(adapter,"if (anchor) anchor.setAttribute('href', versionedPage(anchor.getAttribute('href')));", "if (anchor) { anchor.setAttribute('href', versionedPage(anchor.getAttribute('href'))); if(anchor.id==='ss-back'){event.preventDefault();event.stopImmediatePropagation();window.__SSBack();} }")
css=(ROOT/'assets/css/studyseat.css').read_text()
extra='html,body{width:375px!important;height:100vh!important;margin:0!important;min-height:0!important}#app{width:375px!important;height:100vh!important;max-height:100vh!important}.ss-status{display:none!important}.ss-dialog,.ss-dialog-inner{max-height:calc(100vh - 24px)!important}'
after='''
(function(){
window.addEventListener('message',window.__SSReceive);
document.addEventListener('click',function(e){
 if(e.defaultPrevented)return;const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;const href=a.getAttribute('href'),name=href.split('?')[0].split('/').pop();if(window.__SSPages[name]){e.preventDefault();window.__SSGo(href);}
});
window.__SSNotify();const state=window.__SSPageState[window.__SSCurrent];if(state&&document.querySelector('main'))document.querySelector('main').scrollTop=state.scroll;
})();
'''
pages={}
for name in ['home.html','room.html','confirm.html','bookings.html','profile.html']:
    html=(P/'student'/name).read_text().replace('<script src="vendor/tailwindcss.js"></script>','__SS_TAILWIND__').replace('<script src="vendor/echarts.min.js"></script>','__SS_ECHARTS__')
    if name == 'room.html':
        # The host toolbar provides Back; retain only spacing in the room heading.
        html,count=re.subn(r'<a\b[^>]*aria-label="返回首页"[^>]*>[\s\S]*?</a>', '<span aria-hidden="true" class="w-9 h-9 shrink-0"></span>', html)
        assert count == 1, 'Expected exactly one duplicate room back arrow'
    def inline(m):
        attrs,code=m.group(1),m.group(2)
        if 'src=' in attrs:return m.group(0)
        funcs=list(dict.fromkeys(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)\s*\(',code)))
        return tag('(function(){\n'+code+('\nObject.assign(window,{'+','.join(funcs)+'});' if funcs else '')+'\n})();')
    html=re.sub(r'<script([^>]*)>([\s\S]*?)</script>',inline,html)
    html=re.sub(r'<link rel="stylesheet" href="assets/css/studyseat.css[^\"]*">','<style>'+css+extra+'</style>',html)
    html=re.sub(r'<link rel="icon"[^>]*>','',html)
    local=adapter.replace("page = location.pathname.split('/').pop() || 'index.html'",'page = '+json.dumps(name))
    html=re.sub(r'<script src="assets/js/studyseat-domain.js[^\"]*"></script>\s*<script src="assets/js/studyseat-app.js[^\"]*"></script>',lambda _:tag(domain)+tag(local)+tag(after),html)
    html=html.replace('>StudySeat<','>Study Seat<')
    pages[name]=html
runtime=P.joinpath('unified-student-runtime.js').read_text()
student='<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'+tag(runtime)+tag(domain)+tag('window.__SSPages='+data(pages)+';window.__SSTailwind='+data(tag((ROOT/'vendor/tailwindcss.js').read_text()))+';window.__SSEcharts='+data(tag((ROOT/'vendor/echarts.min.js').read_text()))+';StudySeat.setDemoTime(Date.parse("2026-10-28T13:50:00+08:00"));window.__SSSend("ready");')+'</body></html>'
adminui=P.joinpath('admin-ui.js').read_text()
start=adminui.index('function go(');end=adminui.index('function render()',start)
adminui=adminui[:start]+adminui[end:]
adminui=replace(adminui,"if(!logged)$('#loginform').onsubmit=e=>{e.preventDefault();login();};", "if(!logged)$('#loginform').onsubmit=e=>{e.preventDefault();login();};notifyHost();")
adminui=replace(adminui,'</section></div>`:\'\';}', '</section></div>`:\'\';if(logged)notifyHost();}')
adminui=replace(adminui,"else if(act==='associated'){filter={closure:id};page=1;dismiss();go('records','bookings');}", "else if(act==='associated'){const origin={...navSnapshot(),closeId:id};dismiss();navHistory.push(origin);filter={closure:id};page=1;view='records';tab='bookings';draft=null;opening=null;render();}")
adminui=replace(adminui,"else if(act==='notifications'){const c=", "else if(act==='notifications'){const c=")
adminui=replace(adminui,"if(act==='dismiss'){if(popup?.onCancel)","if(act==='dismiss'){if(popup?.title==='新增资源关闭'){backAdmin();return;}if(popup?.onCancel)")
# Notification back returns to its originating closure detail.
adminui=replace(adminui,"没有受影响预约，无需生成通知预览。</p>'));}","没有受影响预约，无需生成通知预览。</p>'));popup.onCancel=()=>closeDetail(id);drawModal();}")
adminui=adminui.replace("${btn('退出管理端','logout','secondary wide')}", '')
adminui=replace(adminui,"view='rules';tab='rules';page=1;render();toast('已恢复", "view='rules';tab='rules';page=1;navHistory=[];render();toast('已恢复")
bridge=P.joinpath('unified-admin-bridge.js').read_text()
adminui=replace(adminui,'\nrender();\n})();','\n'+bridge+'\nrender();\n})();')
admincss=P.joinpath('admin.css').read_text()+'html,body,#app{height:100vh!important}.status{display:none!important}.sheet{max-height:calc(100vh - 24px)!important}'
admin='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>'+admincss+'</style></head><body><div id="app"></div><div id="modal"></div><div id="toast" role="status"></div>'+tag(ROOT.joinpath('assets/js/studyseat-admin-model.js').read_text())+tag(adminui)+'</body></html>'
# Commit generated frames so deployment needs no build server or external services.
from hashlib import sha256
frames=ROOT/'assets/js/studyseat-frames.js'
frames.write_text('/* Generated by scripts/build-prototype.py; edit prototype/ sources. */\nwindow.UNIFIED_STUDENT='+data(student)+';\nwindow.UNIFIED_ADMIN='+data(admin)+';\n')
ROOT.joinpath('assets/js/studyseat-admin-ui.js').write_text(adminui)
assets=['assets/css/studyseat-prototype.css','assets/js/studyseat-frames.js','assets/js/studyseat-prototype.js']
hashes={a:sha256((ROOT/a).read_bytes()).hexdigest()[:12] for a in assets}
release=sha256(''.join(hashes.values()).encode()).hexdigest()[:12]
host="""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Study Seat · 统一入口与导航</title><link rel="icon" href="assets/icon.svg"><link rel="stylesheet" href="assets/css/studyseat-prototype.css?v=CSS_HASH"></head><body><div id="prototype"><div id="entry"></div><header id="global-nav" hidden><div class="safe"><span>13:50</span><span>原型演示</span></div><div class="navrow"><button id="global-back">‹ 返回</button><strong id="role-title"></strong><button id="global-tools">工具</button><button id="global-exit">退出登录</button></div></header><iframe id="student-frame" title="学生端业务视图"></iframe><iframe id="admin-frame" title="管理端业务视图"></iframe><div id="logout-confirm" class="shade" hidden><section class="dialog" role="dialog" aria-label="确认退出登录"><h2>退出登录？</h2><p>退出不会取消预约或结束自习，已保存的演示数据仍保留。</p><footer><button id="stay">继续使用</button><button id="leave">确认退出</button></footer></section></div><div id="host-message" role="status"></div></div><script src="assets/js/studyseat-frames.js?v=FRAMES_HASH"></script><script src="assets/js/studyseat-prototype.js?v=HOST_HASH"></script></body></html>"""
host=host.replace('CSS_HASH',hashes[assets[0]]).replace('FRAMES_HASH',hashes[assets[1]]).replace('HOST_HASH',hashes[assets[2]])
ROOT.joinpath('login.html').write_text(host)
# Historical bookmarks resolve to the formal entry instead of the retired static UI.
for name in ['index','home','room','confirm','bookings','profile','rules','resources','records']:
    ROOT.joinpath(name+'.html').write_text(f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Study Seat · 原型入口</title><meta http-equiv="refresh" content="0; url=login.html?v={release}"><link rel="icon" href="assets/icon.svg"><script>location.replace('login.html?v={release}');</script></head><body><p>正在进入统一登录页。<a href="login.html?v={release}">点击进入 Study Seat</a></p></body></html>""")
PROJECT.joinpath('index.html').write_text(f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Study Seat · 原型演示</title><meta http-equiv="refresh" content="0; url=deploy/?v={release}"><link rel="icon" href="deploy/assets/icon.svg"><script>location.replace('deploy/?v={release}');</script></head><body><p>正在进入 Study Seat 原型。<a href="deploy/?v={release}">点击进入</a></p></body></html>""")
PROJECT.joinpath('docs/prototype-release.json').write_text(json.dumps({'release':release,'modaoCanvas':'rcVZMWRghgfFFxdw','assets':hashes,'storage':'session-memory; refresh resets; roles independent'},ensure_ascii=False,indent=2)+'\n')
print('Built Study Seat static prototype:',release)
