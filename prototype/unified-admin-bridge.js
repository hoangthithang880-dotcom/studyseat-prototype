const NAV_CHANNEL='studyseat-unified-v1';
let navHistory=[];
function tellHost(type,extra={}){parent.postMessage({channel:NAV_CHANNEL,role:'admin',type,...extra},'*');}
function notifyHost(){tellHost('state',{canBack:logged&&(!!popup||view!=='rules'||tab!=='rules'),title:view==='rules'?'规则配置':view==='resources'?'资源管理':'记录日志'});}
function navSnapshot(){return{view,tab,filter:JSON.parse(JSON.stringify(filter)),page,scroll:$('#main')?.scrollTop||0};}
function restoreNav(s){view=s.view;tab=s.tab;filter=s.filter||{};page=s.page||1;draft=null;opening=null;dismiss();render();if($('#main'))$('#main').scrollTop=s.scroll||0;if(s.closeId)closeDetail(s.closeId);}
function go(target,nextTab){const next=nextTab||(target==='rules'?'rules':target==='records'?'bookings':'');const action=()=>{if(target!==view||next!==tab)navHistory.push(navSnapshot());view=target;tab=next;draft=null;opening=null;page=1;render();};if(dirty())modal('有未保存的修改',notice('离开将放弃表单中的修改，已经保存的数据不受影响。'),'放弃修改',action,false,'继续编辑');else action();}
function editingClose(){return popup&&['新增资源关闭','确认关闭资源','无法关闭 · 需要现场处理'].includes(popup.title)&&!!closeDraft;}
function exit(){const action=()=>{logged=false;draft=null;opening=null;closeDraft=null;navHistory=[];filter={};page=1;view='rules';tab='rules';dismiss();render();tellHost('loggedOut');};if(dirty()||editingClose())modal('退出前有未保存内容',notice('退出将放弃未保存的编辑，不会撤销已保存的管理操作或重置数据。'),'放弃并退出',action,false,'继续编辑');else action();}
function backAdmin(){
 if(popup){if(popup.title==='新增资源关闭'){modal('放弃本次关闭填写？',notice('返回资源管理后将丢弃这份未提交表单，不生成关闭记录。'),'放弃填写',()=>{closeDraft=null;dismiss();},false,'继续填写');return;}if(popup.onCancel){popup.onCancel();return;}dismiss();return;}
 const action=()=>{if(view==='rules'&&tab==='opening'){const last=navHistory.at(-1);if(last?.view==='rules'&&last.tab==='rules')navHistory.pop();restoreNav({view:'rules',tab:'rules',filter,page:1});return;}restoreNav(navHistory.pop()||{view:'rules',tab:'rules',filter:{},page:1});};
 if(dirty())modal('有未保存的修改',notice('返回将放弃未保存内容，已保存的管理数据保留。'),'放弃修改',action,false,'继续编辑');else action();
}
window.addEventListener('message',e=>{if(e.source!==parent||e.data?.channel!==NAV_CHANNEL||e.data.role!=='admin')return;const m=e.data;
 if(m.action==='login'){if(m.account!=='admin01'||m.password!=='Admin1234'){tellHost('loginResult',{ok:false,message:'演示账号或密码错误'});return;}logged=true;navHistory=[];view='rules';tab='rules';draft=null;opening=null;filter={};page=1;dismiss();render();tellHost('loginResult',{ok:true});}
 else if(m.action==='logout'&&logged)exit();else if(m.action==='back'&&logged)backAdmin();
});
tellHost('ready');
