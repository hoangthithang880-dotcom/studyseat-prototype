(function(root){
'use strict';
const DEFAULT={duration:4,advance:7,early:10,late:15,leave:30};
const LABELS={duration:'单次预约最长时长',advance:'最多提前预约天数',early:'签到提前时间',late:'签到截止时间',leave:'暂离最长时间'};
const ROOMS=[{id:'a101',name:'图书馆 3F 自习室 A101',capacity:120},{id:'b203',name:'东区教学楼 B203',capacity:48},{id:'activity',name:'学生活动中心 24小时自习室',capacity:64},{id:'window',name:'图书馆 2F 临窗阅览区',capacity:80}];
const NOW='2026-10-28T13:50';
const ACTIVE=['待签到','使用中','暂离中'];
const copy=x=>JSON.parse(JSON.stringify(x));
const overlap=(a,b,c,d)=>a<d&&c<b;
function seats(id){const n=ROOMS.find(r=>r.id===id)?.capacity||0;return Array.from({length:n},(_,i)=>String.fromCharCode(65+Math.floor(i/(n/4)))+String(i%(n/4)+1).padStart(2,'0'));}
function initial(){
 const spec=[['a101','A09','14:00','16:00','待签到'],['a101','A10','14:00','16:00','待签到'],['b203','A01','13:00','15:00','使用中'],['b203','A02','13:00','15:00','暂离中'],['window','A03','10:00','12:00','已结束'],['activity','A04','10:00','12:00','已超时'],['a101','A11','12:00','13:00','已取消']];
 return {rules:{...DEFAULT},version:1,savedAt:'初始演示规则',schedules:Object.fromEntries(ROOMS.map(r=>[r.id,Array.from({length:7},()=>r.id==='activity'?{mode:'all',start:'00:00',end:'23:59'}:{mode:'time',start:'08:00',end:'22:00'})])),bookings:spec.map((r,i)=>{
  const letter=String.fromCharCode(65+i), events=[{at:'2026-10-28 09:00',text:'创建预约 · 规则 V1'}];
  if(i===2||i===3)events.push({at:'2026-10-28 13:00',text:'模拟签到 · 使用中'});
  if(i===3)events.push({at:'2026-10-28 13:40',text:'暂离 · 截止 14:10'});
  if(i===4)events.push({at:'2026-10-28 10:00',text:'模拟签到'},{at:'2026-10-28 12:00',text:'结束使用'});
  if(i===5)events.push({at:'2026-10-28 10:16',text:'未在签到窗口内签到 · 已超时'});
  if(i===6)events.push({at:'2026-10-28 11:00',text:'学生主动取消'});
  return {id:i+1,code:'SE-20261028-'+String(i+1).padStart(4,'0'),name:'演示学生 '+letter,student:'demo-stu-'+letter.toLowerCase(),room:r[0],seat:r[1],start:'2026-10-28T'+r[2],end:'2026-10-28T'+r[3],status:r[4],snapshot:{version:1,...DEFAULT},reason:i===5?'未在签到窗口内签到':i===6?'学生主动取消':'',events};
 }),closures:[],logs:[],tick:0};
}
function create(){let state=initial();
 const stamp=()=> '2026-10-28 13:50:'+String((state.tick++)%60).padStart(2,'0');
 function log(type,object,detail,bookingIds=[]){const l={id:state.logs.length+1,at:stamp(),actor:'admin01 · 演示管理员',type,object,detail,bookingIds:[...bookingIds]};state.logs.unshift(l);return l;}
 function saveRules(input){const next={};for(const k of Object.keys(DEFAULT)){if(!/^\d+$/.test(String(input[k]))||!Number.isSafeInteger(Number(input[k]))||Number(input[k])<=0)throw Object.assign(new Error('请输入正整数'),{field:k});next[k]=Number(input[k]);}const changes=Object.keys(next).filter(k=>next[k]!==state.rules[k]).map(k=>LABELS[k]+'：'+state.rules[k]+' → '+next[k]);if(!changes.length)return false;state.rules=next;state.version++;const l=log('规则修改','规则 V'+state.version,changes.join('\n'));state.savedAt=l.at;return true;}
 function saveSchedule(room,days,value){if(!ROOMS.some(r=>r.id===room)||!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw new Error('请选择自习室和星期');if(!['all','off','time'].includes(value.mode))throw new Error('请选择开放方式');if(value.mode==='time'&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.end)||value.end<=value.start))throw new Error('结束时间必须晚于开始时间');
 const conflicts=state.bookings.filter(b=>{const day=(new Date(b.start.slice(0,10)+'T00:00:00Z').getUTCDay()+6)%7;return b.room===room&&ACTIVE.includes(b.status)&&days.includes(day)&&(value.mode==='off'||value.mode==='time'&&(b.start.slice(11)<value.start||b.end.slice(11)>value.end));});if(conflicts.length)throw Object.assign(new Error('新开放时段无法覆盖 '+conflicts.length+' 条有效预约，请先处理冲突。'),{conflicts});
 const changes=days.filter(d=>JSON.stringify(state.schedules[room][d])!==JSON.stringify(value));if(!changes.length)return false;const detail=changes.map(d=>'周'+('一二三四五六日'[d])+'：'+scheduleText(state.schedules[room][d])+' → '+scheduleText(value)).join('\n');changes.forEach(d=>state.schedules[room][d]=copy(value));log('开放时段调整',ROOMS.find(r=>r.id===room).name,detail);return true;}
 function preview(c){if(!ROOMS.some(r=>r.id===c.room))throw new Error('请选择自习室');if(c.scope!=='room'&&c.scope!=='seat')throw new Error('请选择关闭范围');if(c.scope==='seat'&&!seats(c.room).includes(c.seat))throw new Error('请选择该自习室内的座位');if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(c.start)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(c.end)||!Number.isFinite(Date.parse(c.start+'+08:00'))||!Number.isFinite(Date.parse(c.end+'+08:00'))||c.start<NOW||c.end<=c.start)throw new Error('请填写当前或未来开始、且结束晚于开始的时段');if(c.reason.trim().length<2||c.reason.trim().length>200)throw new Error('关闭原因须为 2～200 字');return state.bookings.filter(b=>b.room===c.room&&(c.scope==='room'||b.seat===c.seat)&&ACTIVE.includes(b.status)&&overlap(b.start,b.end,c.start,c.end));}
 function close(c,token){if(state.closures.some(x=>x.token===token))return null;const affected=preview(c);if(affected.some(b=>b.status==='使用中'||b.status==='暂离中'))throw new Error('存在正在使用的预约，请先现场确认并结束使用，再重新预览');const at=stamp(),closure={...copy(c),reason:c.reason.trim(),id:state.closures.length+1,at,token,restored:false,bookingIds:affected.map(b=>b.id),notifications:[]};affected.forEach(b=>{b.status='已取消';b.reason='管理员关闭资源：'+closure.reason;b.closureId=closure.id;b.events.push({at,text:b.reason});closure.notifications.push({bookingId:b.id,text:b.name+'，您在'+ROOMS.find(r=>r.id===b.room).name+' '+b.seat+' 座的预约（'+b.start.replace('T',' ')+'—'+b.end.slice(11)+'），因'+closure.reason+'已取消，请重新选择其他可用座位。'});});state.closures.unshift(closure);log('资源关闭',resourceText(closure),'关闭时段：'+c.start.replace('T',' ')+' — '+c.end.replace('T',' ')+'\n原因：'+closure.reason+'\n取消 '+affected.length+' 条待签到预约',closure.bookingIds);return closure;}
 function reopen(id){const c=state.closures.find(c=>c.id===id);if(!c||c.restored||c.end<=NOW)return false;c.restored=true;c.restoredAt=stamp();log('重新开放',resourceText(c),'解除关闭记录 #'+c.id+' 的剩余限制；原已取消预约不恢复。',c.bookingIds);return true;}
 function query(q={}){if(q.from&&q.to&&q.from>q.to)throw new Error('开始日期不能晚于结束日期');return state.bookings.filter(b=>(!q.from||b.start.slice(0,10)>=q.from)&&(!q.to||b.start.slice(0,10)<=q.to)&&(!q.room||b.room===q.room)&&(!q.status||b.status===q.status)&&(!q.key||[b.student,b.seat].some(x=>x.toLowerCase().includes(q.key.trim().toLowerCase())))&&(!q.closure||b.closureId===Number(q.closure))).sort((a,b)=>b.start.localeCompare(a.start)||b.id-a.id);}
 return {get state(){return state},saveRules,saveSchedule,preview,close,reopen,query,reset(){state=initial()}};
}
function scheduleText(v){return v.mode==='all'?'全天开放':v.mode==='off'?'全天不开放':v.start+'–'+v.end;}
function resourceText(c){return ROOMS.find(r=>r.id===c.room).name+(c.scope==='seat'?' / '+c.seat:' / 整间');}
function closureStatus(c){return c.restored?'已恢复':c.end<=NOW?'已结束':c.start>NOW?'待生效关闭':'关闭中';}
const api={create,DEFAULT,LABELS,ROOMS,NOW,ACTIVE,seats,scheduleText,resourceText,closureStatus};
if(typeof module!=='undefined')module.exports=api;else root.AdminModel=api;
})(typeof window!=='undefined'?window:globalThis);
