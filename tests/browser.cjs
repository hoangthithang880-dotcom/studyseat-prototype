/* Current Modao contract. Uses DOM actions only; can run through Codex browser tools. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
async function verify({tab,base,phase,report=console.log,shot=async()=>{}}){
 const ui=tab.playwright,student=ui.frameLocator('#student-frame'),admin=ui.frameLocator('#admin-frame');
 const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
 const text=async(locator,expected)=>{await locator.filter({hasText:expected}).first().waitFor({state:'visible'});assert((await locator.allTextContents({timeoutMs:10000})).some(t=>t.includes(expected)));};
 const login=async(account='832402116',password='123456',role='student')=>{
  if(role==='admin')await button(ui,'管理员登录').click();
  await ui.locator('#unified-account').fill(account);await ui.locator('#unified-password').fill(password);await ui.locator('#submit-login').click();
  await ui.locator('#global-nav').waitFor({state:'visible'});
  await (role==='admin'?admin.locator('nav'):student.locator('main')).waitFor({state:'visible'});
 };
 const logout=async(role='student')=>{await ui.locator('#global-exit').click();if(role==='student')await button(ui,'确认退出').click();await ui.locator('#entry').waitFor({state:'visible'});assert.equal(await ui.locator('#unified-password').evaluate(e=>e.value),'');};
 if(phase==='student'){
  await tab.goto(new URL('login.html',base).href);
  await ui.getByRole('heading',{name:'Study Seat',exact:true}).waitFor({state:'visible'});await shot('local-login');
  await ui.locator('#submit-login').click();await text(ui.locator('#account-error'),'请输入');await text(ui.locator('#password-error'),'请输入');
  await ui.locator('#unified-account').fill('admin01');await ui.locator('#unified-password').fill('Admin1234');await ui.locator('#submit-login').click();await text(ui.locator('#login-error'),'所选角色不正确');
  await login();await text(ui.locator('#role-title'),'学生首页');
  await student.getByRole('link',{name:'立即选座',exact:true}).click();await text(ui.locator('#role-title'),'选择座位');
  assert.equal(await student.getByRole('link',{name:'返回首页',exact:true}).count(),0);await shot('local-room');
  await student.locator('#checkoutBtn').click();await text(ui.locator('#role-title'),'确认预约');
  await ui.locator('#global-back').click();await student.locator('[data-seat="lib-a101:A08"][aria-pressed="true"]').waitFor({state:'visible'});
  assert.equal(await student.locator('#query-start').evaluate(e=>e.value),'14:00');assert.equal(await student.locator('#query-end').evaluate(e=>e.value),'16:00');
  await student.locator('#checkoutBtn').click();await student.locator('label:has(#agreement) > span').first().click();await student.locator('#confirmBtn').click();await student.locator('#successOverlay:not(.hidden)').waitFor({state:'visible'});
  await button(student,'关闭预约凭证').click();await text(ui.locator('#role-title'),'我的预约');await student.locator('.booking-card').waitFor({state:'visible'});assert.equal(await student.locator('.booking-card').count(),1);await shot('local-booking');
  report('统一登录、身份校验、选座返回保留草稿、成功回执关闭及单条预约通过');
 }
 if(phase==='sessions'){
  await logout();await login();await student.getByRole('link',{name:'预约',exact:true}).click();await student.locator('.booking-card').waitFor({state:'visible'});assert.equal(await student.locator('.booking-card').count(),1);
  await logout();await login('student02','Study1234');await student.getByRole('link',{name:'预约',exact:true}).click();await text(student.locator('main'),'共 0 条');assert.equal(await student.locator('.booking-card').count(),0);
  await logout();await login('admin01','Admin1234','admin');await text(admin.locator('#main'),'V1');await shot('local-admin-rules');
  report('学生退出重登保留预约、学生 A/B 隔离、切换管理员登录通过');
 }
 if(phase==='rules'){
  await admin.locator('#rule-leave').fill('45');await ui.locator('#global-exit').click();await admin.getByRole('dialog',{name:'退出前有未保存内容',exact:true}).waitFor({state:'visible'});await button(admin,'继续编辑').click();assert.equal(await admin.locator('#rule-leave').evaluate(e=>e.value),'45');
  await button(admin,'保存修改').click();await button(admin,'确认保存').click();await text(admin.locator('#main'),'V2');await logout('admin');await login('admin01','Admin1234','admin');await text(admin.locator('#main'),'V2');assert.equal(await admin.locator('#rule-leave').evaluate(e=>e.value),'45');
  await admin.locator('nav [data-view="resources"]').click();await ui.locator('#global-back').waitFor({state:'visible'});
  report('管理端未保存退出保护、继续编辑、规则 V2 退出重登保留通过');
 }
 if(phase==='closure'){
  await admin.locator('[data-act="newClose"]').click();await admin.locator('#close-scope').selectOption('room');await admin.locator('#close-reason').fill('本地墨刀同步验收检修');await button(admin,'预览影响').click();await text(admin.locator('.metric'),'2');
  await ui.locator('#global-back').click();assert.equal(await admin.locator('#close-reason').evaluate(e=>e.value),'本地墨刀同步验收检修');await button(admin,'预览影响').click();await button(admin,'确认关闭').click();await text(admin.getByRole('dialog'),'取消预约：2 条');await shot('local-admin-closure');
  await button(admin,'查看受影响预约').click();await text(admin.locator('#main'),'关联关闭记录 #1');assert.equal(await admin.locator('.booking').count(),2);await ui.locator('#global-back').click();await admin.getByRole('dialog',{name:'关闭记录 #1',exact:true}).waitFor({state:'visible'});
  await button(admin,'查看通知预览（2）').click();await admin.getByRole('dialog',{name:'关闭通知内容预览',exact:true}).waitFor({state:'visible'});await ui.locator('#global-back').click();await admin.getByRole('dialog',{name:'关闭记录 #1',exact:true}).waitFor({state:'visible'});
  await button(admin,'重新开放').click();await button(admin,'确认重新开放').click();await admin.locator('#main [data-act="closeDetail"]').click();await text(admin.getByRole('dialog'),'重新开放：');await text(admin.getByRole('dialog'),'取消预约：2 条');await ui.locator('#global-back').click();
  await admin.locator('nav [data-view="records"]').click();await admin.locator('[data-tab="logs"]').click();await text(admin.locator('#main'),'重新开放');await shot('local-admin-logs');
  report('整间关闭影响预览、返回保留表单、取消两条、关联返回、通知返回、重新开放及日志通过');
 }
 if(phase==='attendance'){
  await logout('admin');await login();await student.getByRole('link',{name:'预约',exact:true}).click();await text(student.locator('.booking-card'),'待签到');assert.equal(await student.locator('.booking-card').count(),1);
  await student.locator('[data-action="CHECKIN"]').click();await student.locator('#checkinModal [onclick="completeCheckin()"]').click();await text(student.locator('.booking-card'),'使用中');await student.locator('[data-action="LEAVE"]').click();await text(student.locator('.booking-card'),'暂离中');await student.locator('[data-action="RETURN"]').click();await text(student.locator('.booking-card'),'使用中');await student.locator('[data-action="COMPLETE"]').click();await student.locator('#cancelModal [onclick="confirmCancel()"]').click();await text(student.locator('.booking-card'),'已结束');await shot('local-attendance');
  await student.getByRole('link',{name:'我的',exact:true}).click();await student.locator('#focusChart canvas').waitFor({state:'visible'});assert(await student.locator('#focusChart canvas').evaluate(e=>e.width>0&&e.height>0));await shot('local-profile');
  report('管理操作未改变学生预约；学生签到、暂离、返回、结束及个人中心图表通过');
 }
 if(phase==='refresh'){
  await tab.reload();await ui.locator('#entry').waitFor({state:'visible'});await login();await student.getByRole('link',{name:'预约',exact:true}).click();await text(student.locator('main'),'共 0 条');
  await logout();await login('admin01','Admin1234','admin');await text(admin.locator('#main'),'V1');assert.equal(await admin.locator('#rule-leave').evaluate(e=>e.value),'30');await admin.locator('nav [data-view="resources"]').click();await text(admin.locator('#main'),'暂无关闭记录');await logout('admin');
  for(const name of ['home','room','confirm','bookings','profile','rules','resources','records']){await tab.goto(new URL(name+'.html',base).href);await ui.getByRole('heading',{name:'Study Seat',exact:true}).waitFor({state:'visible'});}
  await shot('local-final-login');report('刷新恢复学生/管理初始场景、历史八个页面不能绕过统一登录通过');
 }
}
module.exports=verify;
if(require.main===module){(async()=>{
 const {createRequire}=require('node:module');let chromium;
 try{({chromium}=require('playwright'));}catch(_){const modules=process.env.STUDYSEAT_NODE_MODULES||path.resolve(path.dirname(process.execPath),'../node_modules');({chromium}=createRequire(path.join(modules,'_studyseat.cjs'))('playwright'));}
 const executablePath=process.env.STUDYSEAT_CHROME||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})}),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));const tab={playwright:page,goto:url=>page.goto(url),reload:()=>page.reload()};
 const directory=path.resolve(__dirname,'../docs/screenshots');fs.mkdirSync(directory,{recursive:true});
 try{for(const phase of ['student','sessions','rules','closure','attendance','refresh'])await verify({tab,base:process.env.STUDYSEAT_BASE_URL||'http://127.0.0.1:8765/deploy/',phase,report:s=>{checks.push(s);console.log('PASS '+s);},shot:name=>page.screenshot({path:path.join(directory,name+'.png')})});assert.deepEqual(errors,[]);fs.writeFileSync(path.resolve(__dirname,'../docs/prototype-browser-results.json'),JSON.stringify({checks,errors},null,2)+'\n');}finally{await browser.close();}
 })().catch(e=>{console.error(e);process.exitCode=1;});}
