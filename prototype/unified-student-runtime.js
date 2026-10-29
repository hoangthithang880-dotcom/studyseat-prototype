(function(){
const CHANNEL='studyseat-unified-v1';
function memory(){const d={};return{getItem:k=>Object.hasOwn(d,k)?d[k]:null,setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]};}
window.__SSStore=memory();window.__SSSession=memory();
window.__SSCurrent='';window.__SSQuery='';window.__SSHistory=[];window.__SSIntervals=[];window.__SSPageState={};
const nativeInterval=window.setInterval.bind(window);
window.setInterval=function(fn,ms){const id=nativeInterval(fn,ms);window.__SSIntervals.push(id);return id;};
window.__SSSend=function(type,extra={}){parent.postMessage({channel:CHANNEL,role:'student',type,...extra},'*');};
window.__SSNotify=function(){window.__SSSend('state',{canBack:!!window.__SSCurrent&&!window.__SSCurrent.startsWith('home.html'),title:({'home.html':'学生首页','room.html':'选择座位','confirm.html':'确认预约','bookings.html':'我的预约','profile.html':'个人中心'})[window.__SSCurrent.split('?')[0]]||'学生端'});};
window.__SSRemember=function(){const key=window.__SSCurrent;if(!key)return;const main=document.querySelector('main');window.__SSPageState[key]={scroll:main?.scrollTop||0,filter:window.__SSBookingFilter||'ALL'};};
window.__SSGo=function(href,replace=false,back=false){
 const url=new URL(href,'https://studyseat.prototype.local/'),name=url.pathname.split('/').pop(),target=name+url.search;
 if(name==='login.html'){window.__SSSend('requestLogout');return;}
 if(!window.__SSPages[name]||!window.StudySeat?.getSession())return;
 window.__SSRemember();
 window.__SSPageCleanup?.();window.__SSPageCleanup=null;
 if(!replace&&!back&&window.__SSCurrent&&window.__SSCurrent!==target){
  if(window.__SSCurrent.startsWith('confirm.html')&&window.__SSHasReceipt){window.__SSHistory=window.__SSHistory.filter(h=>!h.startsWith('confirm.html')&&!h.startsWith('room.html'));}
  else window.__SSHistory.push(window.__SSCurrent);
 }
 window.__SSIntervals.forEach(clearInterval);window.__SSIntervals=[];window.__SSHasReceipt=false;
 for(const key of ['closeSuccess','closeCheckin','closeCancel','ssRefresh'])window[key]=undefined;
 window.__SSCurrent=target;window.__SSQuery=url.search;
 const state=window.__SSPageState[target];window.__SSBookingFilter=state?.filter||'ALL';
 let html=window.__SSPages[name].replace('__SS_TAILWIND__',()=>window.__SSTailwind).replace('__SS_ECHARTS__',()=>window.__SSEcharts);
 document.open();document.write(html);document.close();
};
window.__SSBack=function(){
 const receipt=document.querySelector('#successOverlay:not(.hidden)');if(receipt){window.__SSHistory=[];window.__SSGo('bookings.html',true);return;}
 const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return;}
 for(const id of ['checkinModal','cancelModal','notifyOverlay','infoModal']){const el=document.getElementById(id);if(el&&!el.classList.contains('hidden')){el.classList.add('hidden');return;}}
 if(window.__SSCurrent.startsWith('confirm.html')){const room=window.StudySeat.getDraft()?.roomId||'lib-a101';while(window.__SSHistory.at(-1)?.startsWith('confirm.html'))window.__SSHistory.pop();const previous=window.__SSHistory.at(-1);if(previous?.startsWith('room.html')){window.__SSHistory.pop();window.__SSGo(previous,true,true);}else window.__SSGo('room.html?roomId='+room,true,true);return;}
 let target=window.__SSHistory.pop()||'home.html';while(target.startsWith('confirm.html'))target=window.__SSHistory.pop()||'home.html';window.__SSGo(target,true,true);
};
window.__SSReceive=function(e){
 if(e.source!==parent||e.data?.channel!==CHANNEL||e.data.role!=='student')return;
 const m=e.data;
 try{
  if(m.action==='login'){
   window.StudySeat.login(String(m.account),String(m.password),'student');
   if(!window.StudySeat.getDraft())window.StudySeat.saveDraft({roomId:'lib-a101',seatId:'lib-a101:A08',startAt:window.StudySeat.atTime('2026-10-28','14:00'),endAt:window.StudySeat.atTime('2026-10-28','16:00'),submitToken:window.StudySeat.uid()});
   window.__SSHistory=[];window.__SSPageState={};window.__SSCurrent='';window.__SSBookingFilter='ALL';window.__SSGo('home.html',true);
   window.__SSSend('loginResult',{ok:true});
  }else if(m.action==='logout'){
   window.__SSPageCleanup?.();window.__SSPageCleanup=null;window.__SSIntervals.forEach(clearInterval);window.__SSIntervals=[];window.StudySeat.logout();window.__SSHistory=[];window.__SSPageState={};window.__SSCurrent='';window.__SSHasReceipt=false;document.body.innerHTML='';window.__SSSend('loggedOut');
  }else if(m.action==='back'&&window.StudySeat.getSession())window.__SSBack();
  else if(m.action==='tools'&&window.StudySeat.getSession())document.getElementById('demo-tools')?.click();
 }catch(error){window.__SSSend(m.action==='login'?'loginResult':'error',{ok:false,message:error.message});}
};
window.addEventListener('message',window.__SSReceive);
})();
