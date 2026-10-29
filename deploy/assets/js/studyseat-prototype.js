(function(){
'use strict';
const CHANNEL='studyseat-unified-v1',frames={student:document.getElementById('student-frame'),admin:document.getElementById('admin-frame')},entry=document.getElementById('entry'),head=document.getElementById('global-nav');
let current=null,loginRole='student',busy=false,ready={student:false,admin:false},status={student:{},admin:{}};
const $=s=>document.querySelector(s);
function send(role,action,extra={}){frames[role].contentWindow.postMessage({channel:CHANNEL,role,action,...extra},'*');}
function drawEntry(role='student'){
 loginRole=role;busy=false;current=null;head.hidden=true;for(const f of Object.values(frames))f.classList.remove('visible');entry.hidden=false;
 entry.innerHTML=`<div class="loginhero"><div class="mark">♧</div><h1><span>Study</span> <span>Seat</span></h1><p>智慧校园自习室预约与座位管理系统</p><div class="slogan">知行有座 · 学习有序</div></div><section class="loginpanel">${role==='admin'?'<button type="button" id="entry-back" class="entryback">‹ 返回统一登录</button><h2>管理员登录</h2><p class="sub">管理端独立模拟 · 请使用管理员演示账号</p>':'<div class="roles"><button type="button" class="selected" id="student-role">学生登录</button><button type="button" id="admin-role">管理员登录</button></div>'}<form id="unified-login" novalidate><label>${role==='admin'?'管理员':'学生'}演示账号<input id="unified-account" autocomplete="off" placeholder="请输入演示账号" value="${role==='admin'?'admin01':''}"><small id="account-error"></small></label><label>密码<div class="password"><input type="password" id="unified-password" autocomplete="off" placeholder="请输入密码"><button type="button" id="show-password" aria-label="显示密码">◉</button></div><small id="password-error"></small></label><p id="login-error" role="alert"></p><button id="submit-login" type="submit" class="submit">${role==='admin'?'登录管理端':'登 录'}</button></form><p class="credentials">公开演示凭据 · 不接入学校统一认证<br>${role==='admin'?'admin01 / Admin1234':'学生 A：832402116 / 123456<br>学生 B：student02 / Study1234'}</p></section><p class="foot">福州大学 · 软件工程实践课程<br>Study Seat 知行有座队<br><span>学生与管理端数据独立，刷新后恢复演示场景</span></p>`;
 $('#admin-role')?.addEventListener('click',()=>drawEntry('admin'));$('#student-role')?.addEventListener('click',()=>drawEntry('student'));$('#entry-back')?.addEventListener('click',()=>drawEntry('student'));
 $('#show-password').onclick=()=>{const p=$('#unified-password');p.type=p.type==='password'?'text':'password';$('#show-password').setAttribute('aria-label',p.type==='password'?'显示密码':'隐藏密码');};
 $('#unified-login').onsubmit=e=>{e.preventDefault();if(busy)return;const account=$('#unified-account').value.trim(),password=$('#unified-password').value;$('#account-error').textContent=account?'':'请输入演示账号';$('#password-error').textContent=password?'':'请输入密码';$('#login-error').textContent='';if(!account||!password)return;if(!ready[loginRole]){$('#login-error').textContent='原型正在准备，请稍后再次登录';return;}busy=true;$('#submit-login').disabled=true;send(loginRole,'login',{account,password});};
}
function showRole(role){current=role;busy=false;entry.hidden=true;head.hidden=false;for(const [name,frame]of Object.entries(frames))frame.classList.toggle('visible',name===role);updateHeader();}
function updateHeader(){if(!current)return;$('#role-title').textContent=status[current].title||(current==='student'?'学生首页':'规则配置');$('#global-back').hidden=!status[current].canBack;$('#global-tools').hidden=current!=='student';}
window.addEventListener('message',e=>{const m=e.data;if(!m||m.channel!==CHANNEL||!Object.hasOwn(frames,m.role)||e.source!==frames[m.role].contentWindow)return;
 if(m.type==='ready'){ready[m.role]=true;return;}
 if(m.type==='state'){status[m.role]=m;if(current===m.role)updateHeader();return;}
 if(m.type==='loginResult'){if(loginRole!==m.role||entry.hidden)return;busy=false;$('#submit-login').disabled=false;if(m.ok){$('#unified-password').value='';showRole(m.role);}else $('#login-error').textContent=m.message||'演示账号或密码错误';return;}
 if(m.type==='loggedOut'){if(current===m.role)drawEntry('student');return;}
 if(m.type==='requestLogout'&&current===m.role){requestLogout();return;}
 if(m.type==='error'&&current===m.role){$('#host-message').textContent=m.message;setTimeout(()=>$('#host-message').textContent='',3000);}
});
function requestLogout(){if(!current)return;if(current==='admin'){send('admin','logout');return;}$('#logout-confirm').hidden=false;}
$('#global-back').onclick=()=>current&&send(current,'back');$('#global-exit').onclick=requestLogout;$('#global-tools').onclick=()=>send('student','tools');
$('#stay').onclick=()=>$('#logout-confirm').hidden=true;
$('#leave').onclick=()=>{const role=current;$('#logout-confirm').hidden=true;if(role)send(role,'logout');};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#logout-confirm').hidden){e.preventDefault();$('#logout-confirm').hidden=true;}});
drawEntry();frames.student.srcdoc=window.UNIFIED_STUDENT;frames.admin.srcdoc=window.UNIFIED_ADMIN;
})();
