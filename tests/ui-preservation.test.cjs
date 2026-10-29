const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const deploy=path.resolve(__dirname,'../deploy');
const html=name=>fs.readFileSync(path.resolve(deploy,'../prototype/student',name+'.html'),'utf8');
test('Original homepage keeps hero, four illustrated room cards, category tiles and icon navigation',()=>{
 const s=html('home');assert(s.includes('把今天的专注<br/>留在喜欢的座位'));assert(s.includes('按场景找座'));assert.equal((s.match(/class="room-card /g)||[]).length,4);assert.equal((s.match(/class="category-tile /g)||[]).length,4);assert(s.includes('hero-ring'));assert(s.includes('id="notifyOverlay"'));assert(s.match(/<nav[^>]*>[\s\S]*<svg/));assert(s.includes('<details class="ss-query-details'));
});
test('Original room illustration, six-column seat map and fixed checkout footer remain',()=>{
 const s=html('room');for(const landmark of ['<!-- 北窗 -->','<!-- 书架 -->','<!-- 书桌与座椅 -->','h-[174px]','id="dateRow"','id="slotGrid"','seat-map grid grid-cols-6','id="checkoutBtn"'])assert(s.includes(landmark),landmark);assert(s.includes('<footer'));
});
test('Original confirmation ticket, progress steps, agreement and success sheet remain',()=>{
 const s=html('confirm');for(const landmark of ['ticket-notch-left','ticket-notch-right','RESERVATION','把座位留给自己','id="agreement"','id="successOverlay"','id="confirmBtn"','id="modalCode"'])assert(s.includes(landmark),landmark);assert(s.includes('<footer'));
});
test('Original booking card template and personal chart, favorites and badges remain',()=>{
 const booking=html('bookings'),profile=html('profile');for(const landmark of ['id="booking-card-template"','bg-gradient-to-r from-[#2563EB]','data-role="seat"','data-role="actions"','id="checkinModal"','id="qrGrid"','id="cancelModal"'])assert(booking.includes(landmark),landmark);for(const landmark of ['id="focusChart"','我的常用自习室','我的专注徽章','function initChart()','vendor/echarts.min.js'])assert(profile.includes(landmark),landmark);
});
test('Shared additions do not replace original page shells with simplified navigation or hero components',()=>{
 for(const name of ['home','room','confirm','bookings','profile']){const s=html(name);assert(!/class="ss-(?:main|hero|nav|titlebar)/.test(s),name);assert(s.includes('max-w-[393px]'));}
 const css=fs.readFileSync(path.join(deploy,'assets/css/studyseat.css'),'utf8');assert(!/(?:^|})\s*(?:html\s*,\s*body|body|\*)\s*\{/.test(css),'avoid a global redesign through shared CSS');
});
test('Original student icon navigation keeps the default find-seat route',()=>{
 for(const name of ['home','profile','bookings']){const nav=html(name).match(/<nav[\s\S]*?<\/nav>/)[0];assert(nav.includes('href="room.html"'),name);assert(!nav.includes('room.html?roomId='),name);}
});
