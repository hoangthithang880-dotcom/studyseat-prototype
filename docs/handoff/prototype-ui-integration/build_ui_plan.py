"""Build the Word plan and a plain-text task for a new Codex conversation."""
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = '2c24361f0cd05f306ea9cc01c129fb0410638424'
OUT = HERE / 'StudySeat_原型界面接入与补充PR实施计划书.docx'
TASK = '''请直接完成 StudySeat 原型界面接入与补充 PR 开发，不能只给方案。

项目目录：/Users/zhouyiheng/Desktop/软件工程/studyseat-phase4-ui-fix
本地分支：codex/prototype-ui-integration
真实后端产品基线：2c24361f0cd05f306ea9cc01c129fb0410638424，来自已复查的 PR #8。
原型UI与交互基线：仓库最初原型提交 2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f（2026年10月29日），不是Alpha工作台。
正式墨刀入口：https://modao.cc/proto/jojnMZTptnm0v2RS5FJnT5/sharing?view_mode=device&screen=rbpVZKhPnl9bPObwP&canvasId=rcVZMWRghgfFFxdw
墨刀起始页为“00 正式入口｜Study Seat”，与该原型提交的定版HTML和静态成品对应。
该基线之后可能有计划材料提交，先核对真实 HEAD、分支、远端和 git status，不要重置已有改动。

先阅读本目录的 AGENTS.md，以及 docs/handoff/prototype-ui-integration 中的 Word 实施计划书。原始依据是 /Users/zhouyiheng/Downloads/StudySeat_代码规范与冲刺计划.docx；原型以 prototype/、modao/StudySeat_定版原型.html 和 docs/screenshots/ 为准。再读 alpha/README.md，以及 alpha/docs/ 下的 API-v1.md、RULES.md、PHASE3.md、PHASE4.md、PHASE4-REVIEW-FIXES.md。

目标：在原型材料和已验证后端基础上继续做，尽可能保留原型UI及原有交互逻辑，把原型核心界面和交互接入真实服务。学生端完成登录、房间首页、详情与日期时段、座位图、预约确认与回执、本人预约和签到/暂离/返回/结束、基本个人页；管理端按原型组织规则、开放时间、资源关闭预览/确认、重新开放及日志。保留原型的导航、返回草稿、状态和反馈，不用继续堆长表单替代产品页面。普通用户页面移除工程验证文本入口。

先实际打开原型逐页操作，形成原型页面—控件—交互—真实接口—完成状态对照表，再分批实现。原型原稿目录为 /Users/zhouyiheng/Desktop/软件工程/studyseat原型设计/studyseat-prototype-master；本项目中的五项关键原型材料已核对字节一致，见 prototype-material-manifest.json。不能以当前Alpha长表单为UI基准，不能另做简化页面取代原型。可用现有原生 HTML/CSS/JS；原型只复用视觉与交互，不复用模拟登录、内存预约、演示时钟或独立角色假数据。必要的座位目录等只读接口增量可以实现，但须向后兼容、保留权限和隐私、同步API文档并补测试。原型管理端还有按星期开放、全天/不开放模式及带开始结束的关闭时段，现接口仅每日统一与即时关闭：这些属于必须核对并保留的原型交互，不能静默删控件或改义。按计划书单列兼容扩展任务，必要时做增量迁移并补升级/回滚测试；若未实现必须列为原型接入未完成，不能标整体完成。禁止从学生页面调用管理员资源接口。对原型非核心装饰或现有模拟功能，尽可能保留UI位置与视觉；没有真实支持的内容明确为展示或禁用并说明原因，不能冒充可用交互、随意删除核心入口或伪造数据。

保留会话角色和归属、CSRF、UTC/北京时间、规则快照、幂等重试、事务和独立超时任务；暂离/返回携带观察到的 expected_version。保留身份隔离、座位查询版本、预约列表版本、管理读取版本与草稿/预览保护，不恢复所有操作共用一个全局代次。

先检查是否已有改动。按完整功能编写或更新测试并逐批 commit。现有浏览器选择器可随真实页面流程调整，但不能删除或弱化原有断言。新增原型逐页对照、完整业务、返回与刷新、键盘/触屏、375/390px移动端和桌面截图检查。必须执行AI逐控件交互自检，穷尽清单中的可见按钮、卡片、链接、页签、筛选、输入提交及弹窗；逐项记录实际操作、页面反馈、必要网络/业务结果和证据。点击事件存在或无控制台异常不算通过；发现点了没反应就修复并复测。生成AI-INTERACTION-AUDIT.json及对应可读报告，未完成自检不得标ready。使用独立库和新证据目录。保留历史报告；真实服务、页面和证据必须对应同一代码版本。

完整执行 python alpha/scripts/verify_phase4.py 以及根目录原型测试和适用的原型浏览器回归；新增 UI 用例接入验证器。当前基线的181项后端、70项原型单测和55个Alpha浏览器检查仅是历史参考，最终记录实际数量、浏览器、命令、失败及未执行项。本机无 npm 时可以执行 package.json 中 test 对应的 Node 命令，并明确实际执行方式。不得把失败、跳过或未执行写成通过。

当前 http://127.0.0.1:5068 是用户正在使用的旧版人工自测服务，不要重置其数据或自动替换。新开发服务使用其他端口和独立数据库；不要在代码或报告中泄露会话密钥。

复核 PR #8 与最新 main：若 PR #8 已合并，从本地产品基线核对新增主线改动并安全整合；未合并时可先开发并建立注明依赖的 Draft，避免重复描述或覆盖其修复。不重写同学历史、不强推。完成代码、验证、证据、文档和本地提交后，推送独立分支并创建补充 PR；若尚未通过验证只保留 Draft，明确失败和待办，不标为完成。不合并、不部署。

最终交付：原型对照表、逐页完成情况、真实测试结果、截图/证据位置、提交 SHA、PR 链接、可打开的本机验收入口及剩余问题。截止依据为2026年11月29日23:59；持续推进实际实现，若范围或时间不足，先完成核心闭环并如实报告缺口，不改写原计划来掩盖偏差。
'''
(HERE / '新对话启动指令.txt').write_text(TASK, encoding='utf-8')

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.top_margin, sec.bottom_margin = Inches(.7), Inches(.7)
sec.left_margin = sec.right_margin = Inches(.8)
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2']:
    s = doc.styles[name]
    s.font.name = 'Arial'
    s.font.color.rgb = RGBColor(0, 0, 0)
    s._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), 'Songti SC')
normal = doc.styles['Normal']
normal.font.size = Pt(10.5)
normal.paragraph_format.line_spacing = Pt(16)
normal.paragraph_format.space_after = Pt(5)
normal.paragraph_format.widow_control = True
for name, size in [('Title', 22), ('Subtitle', 10), ('Heading 1', 15), ('Heading 2', 11.5)]:
    s = doc.styles[name]
    s.font.size = Pt(size)
    s.paragraph_format.line_spacing = Pt(size * 1.35)
    s.paragraph_format.space_before = Pt(8 if name.startswith('Heading') else 0)
    s.paragraph_format.space_after = Pt(6)
    s.paragraph_format.keep_with_next = name != 'Subtitle'
    if name.startswith('Heading'): s.font.bold = True
    borders = s._element.get_or_add_pPr().find(qn('w:pBdr'))
    if borders is not None: s._element.get_or_add_pPr().remove(borders)
doc.core_properties.title = 'StudySeat 原型界面接入与补充 PR 实施计划书'
doc.core_properties.author = 'StudySeat 项目计划资料'
doc.core_properties.subject = '新对话开发交接与原型核心交互验收'

def p(text='', bold=False, size=None):
    paragraph = doc.add_paragraph()
    r = paragraph.add_run(text); r.bold = bold
    if size: r.font.size = Pt(size)
    return paragraph

def h(text, newpage=True):
    paragraph = doc.add_heading(text, 1)
    paragraph.paragraph_format.page_break_before = newpage
    return paragraph

def sub(text): return doc.add_heading(text, 2)
def bullet(text):
    paragraph = p('• ' + text)
    paragraph.paragraph_format.left_indent = Pt(11)
    paragraph.paragraph_format.first_line_indent = Pt(-11)
    return paragraph

def link(label, url):
    paragraph = doc.add_paragraph()
    el = OxmlElement('w:hyperlink');el.set(qn('r:id'), paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True))
    run = OxmlElement('w:r');props = OxmlElement('w:rPr')
    fonts = OxmlElement('w:rFonts');fonts.set(qn('w:ascii'), 'Arial');fonts.set(qn('w:hAnsi'), 'Arial');fonts.set(qn('w:eastAsia'), 'Songti SC');props.append(fonts)
    color = OxmlElement('w:color');color.set(qn('w:val'), '1F4E79');props.append(color)
    underline = OxmlElement('w:u');underline.set(qn('w:val'), 'single');props.append(underline)
    run.append(props);t = OxmlElement('w:t');t.text = label;run.append(t);el.append(run);paragraph._p.append(el)

def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers));t.alignment = WD_TABLE_ALIGNMENT.CENTER;t.autofit = False
    for col, width in zip(t.columns, widths): col.width = Inches(width)
    for i, text in enumerate(headers): t.rows[0].cells[i].text = text
    header = OxmlElement('w:tblHeader');t.rows[0]._tr.get_or_add_trPr().append(header)
    for row in rows:
        for cell, text in zip(t.add_row().cells, row): cell.text = text
    for ri, row in enumerate(t.rows):
        row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
        for ci, cell in enumerate(row.cells):
            cell.width = Inches(widths[ci]);cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            pr = cell._tc.get_or_add_tcPr()
            shade = OxmlElement('w:shd');shade.set(qn('w:fill'), 'E8EFF5' if ri == 0 else ('F6F8FA' if ri % 2 == 0 else 'FFFFFF'));pr.append(shade)
            mar = OxmlElement('w:tcMar')
            for side in ['top', 'bottom', 'left', 'right']:
                el = OxmlElement('w:' + side);el.set(qn('w:w'), '85');el.set(qn('w:type'), 'dxa');mar.append(el)
            pr.append(mar)
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.line_spacing = Pt(14)
                paragraph.paragraph_format.space_before = Pt(1)
                paragraph.paragraph_format.space_after = Pt(2)
                for r in paragraph.runs: r.font.size = Pt(10);r.bold = ri == 0
    borders = OxmlElement('w:tblBorders')
    for side in ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']:
        el = OxmlElement('w:' + side);el.set(qn('w:val'), 'single');el.set(qn('w:sz'), '6');el.set(qn('w:color'), 'D9D9D9');borders.append(el)
    t._tbl.tblPr.append(borders)
    p().paragraph_format.space_after = Pt(0)
    return t

# 1
p('StudySeat 原型界面接入\n与补充 PR 实施计划书').style = doc.styles['Title']
p('新对话开发交接用    2026年11月28日    计划版本 1.3', size=10)
p('目标是在已确认原型和已验证真实后端的基础上继续开发，尽可能保留原型 UI、页面结构和已有交互逻辑，形成学生和管理员均可实际操作的 Alpha 版本。本计划供新的开发对话直接执行；本次只制作计划与交接材料，尚未完成界面改造。')
sub('开发位置与基线')
table(['项目','约定'],[
('独立项目目录', '/Users/zhouyiheng/Desktop/软件工程/studyseat-phase4-ui-fix'),
('本地分支', 'codex/prototype-ui-integration'),
('原型UI与交互基线', '2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f；2026年10月29日仓库首次原型提交。'),
('真实后端产品基线', BASE),
('上游依赖', 'PR #8；复查时 open、未合并。执行时重新获取最新状态，不把该状态当作永久事实。'),
('当前本地情况', '已建立独立目录；除本计划材料外没有 UI 修改。后续计划提交会改变 HEAD，不能重置回产品基线。'),
], [1.25, 5.65])
sub('完成后应该看到的产品')
p('房间卡片可进入详情；日期、时段与座位选择连续；确认后得到真实预约；本人列表可进行合法状态操作。管理端按原型分区操作，规则、资源和预约与学生端共用服务端数据。返回、刷新和重登不导致误提交或丢失已保存结果。')
sub('依据与时间边界')
p('冲刺计划明确要求“在保留现有交互设计的基础上”实现共享数据、服务端权限和持久化。课堂作业要求展示预期与实际进度、运行证据及测试成果；截止为2026年11月29日23:59。此时间是安排依据，不是对全部细节完成时间的保证。')
p('核心验收门槛：原型对应页面可操作、真实数据贯通、既有保护保留、新旧回归通过、文档与证据对应当前代码。单独修复房间按钮不能代表整体接入完成。', bold=True)

# Source basis
h('一 材料基线与继承关系')
p('本任务是在现有材料上继续开发，不重新设计一套简化产品。原型固定为仓库首次提交 2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f，正式墨刀起始页为“00 正式入口｜Study Seat”。视觉与交互按这套最初原型，真实数据与安全一致性按已复查后端；Alpha长表单不是原型基准。')
p('原型原稿目录：/Users/zhouyiheng/Desktop/软件工程/studyseat原型设计/studyseat-prototype-master。开发目录与其分离；未经授权不修改原稿。下面的仓库内路径均相对本计划首页的开发目录。', size=10)
table(['材料层级','具体材料','在本任务中的用途'],[
('用户本次要求', '保留原型已有交互逻辑，UI尽可能保留；任务明确、边界清楚；AI逐控件自检。', '作为本次新增验收门槛，不能用功能测试通过代替UI与交互验收。'),
('原型定版与源码', 'modao/StudySeat_定版原型.html；prototype/student/五页；student-app.js、admin-ui.js、admin.css及桥接文件。', '页面结构、卡片、日期时段、座位网格、导航、回执、弹窗、返回与草稿逻辑的直接依据。'),
('原型截图与成品', 'docs/screenshots/下local系列；deploy/login.html及其资源。', '学生和管理端视觉对照；确认图标、层级、配色、尺寸与布局。deploy是生成成品，不能仅改成品而遗漏源码。'),
('已复查真实版本', '产品提交2c24361；alpha/studyseat及现有测试、迁移、API-v1契约。', '复用登录、权限、持久化、事务、版本与旧响应保护。仅为原型接入做必要兼容增量。'),
('冲刺与作业依据', '下载目录中的原始冲刺计划；课堂作业620611106；alpha/README及阶段记录。', '明确业务约束、阶段范围、证据、真实进度和截止；不能倒改历史计划掩盖缺口。'),
], [1.05, 2.85, 3.0])
sub('已经核实的原型一致性')
p('仓库首次原型提交、原稿目录与本项目的定版HTML、student-app.js、admin-ui.js、local-room.png、prototype-release.json五项关键材料字节一致；首次提交与后端基线之间，prototype、modao、deploy、docs/screenshots四个目录没有内容差异。摘要及两侧路径见同目录 prototype-material-manifest.json。新对话先确认材料仍在，再实际打开原型走流程。')
sub('冲突处理原则')
p('原型模拟数据必须换成真实数据，安全与服务端判定不能退化；原型已有核心交互缺接口时，列出差距并实现最小兼容支持。确实未完成的差异保留在清单中，不能悄悄删入口、换语义或宣称已经还原。')

# 2
h('二 学生端原型对照与范围')
p('以 prototype/student/ 下五个页面及原型登录入口为视觉与交互基准。保留主要信息层级、房间卡片、日期时段选择、座位网格、操作回执与返回方式；适配真实数据和不同屏幕，不要求逐像素复制。')
table(['页面或流程','必须实现','真实接口与验收'],[
('U01 登录与身份', '延续原型登录视觉与退出；显示真实用户信息。角色由服务端决定，不能按登录表单选项授予权限。', 'GET auth/session、POST auth/login/logout、GET me。失效会话回登录；切换账号清空私有视图。'),
('S01 首页 home', '房间卡片可点击并进入对应房间详情；有明确加载、空数据与失败重试。', 'GET rooms、rules。容量是目录数量，未选有效时间前不冒充可用余量。'),
('S02 详情与选座 room', '展示真实房间、开放时间、日期及时段；座位可选与不可选状态清楚，保留选座条件。', 'GET seats，必要时补只读目录字段。参数含明确时区；更换条件使旧查询失效。'),
('S03 确认与回执 confirm', '核对房间、座位、日期和时段；返回可修改并保留条件，成功回执关闭后进入本人列表；失败可恢复。', 'POST reservations。只在真实成功后展示回执；重试保留同一载荷的幂等键。'),
('S04 我的预约 bookings', '保留原型列表分组/筛选、状态标签与合法操作；取消、签到、暂离、返回和结束反馈明确。', 'GET reservations 与状态写接口。提交后刷新最新列表；旧读取不能覆盖新结果。'),
('S05 个人页 profile', '展示服务端用户、退出入口与真实本人记录摘要；返回路径连续。', 'GET me、本人预约。未实现的设置、统计或历史信息不得伪造。'),
], [1.05, 2.85, 3.0])
sub('原型内容取舍')
p('房间插画、主要配色、字号层级、卡片、日期快捷项、时段控件、座位网格、底部确认区、状态标签及导航尽可能保留。评分、收藏、地图、排序及无接口统计不新增真实业务范围；可保留为明确展示或禁用态并说明原因，不能伪造数据或做弹“敬请期待”就算功能完成。核心入口不得以简化为由删除。现有工程验证文本入口移出普通用户主流程。')
p('座位网格若没有真实坐标，只能标注为座位示意；不能把示意布局描述成现场精确位置。不得用原型固定日期、模拟余量或假预约填充真实页面。', size=10)

# 3
h('三 管理端对照与共享数据')
p('参考 prototype/admin-ui.js、admin.css 及原型管理端导航，组织规则、资源、记录等视图。普通学生不能显示或请求管理员私有数据。')
table(['管理视图','接入要求','验收结果'],[
('A01 规则配置', '读取当前规则并完整保存五项设置，携带 base_version；保留未保存提醒与保存期间新草稿。', '新规则服务端可读取；旧预约保留快照；旧回执不清除新草稿。'),
('A02 开放安排', '保留房间、星期与开放模式选择、时分输入、保存确认及已保存安排；按兼容扩展任务补齐真实支持。', '真实按指定星期生效；影响有效预约或前提过期时拒绝。不能用每日统一冒充周安排。'),
('A03 关闭预览', '保留单座/整间、开始结束时段、原因、预览、返回修改与确认；按兼容扩展任务补齐时段支持。', '预览无副作用；条件变化使旧预览失效；确认由服务端复核，超期可重新预览。'),
('A04 重新开放', '显示真实关闭记录，可查看影响和重新开放；保留详情返回来源。', '关闭后学生刷新见取消；重开允许新预约，旧取消记录不复活。'),
('A05 记录日志', '真实共享预约、执行者、时间及原因；支持原型中的关联查看与返回。', '与学生端同一记录和状态；站内审计不能表述为通知已送达。'),
], [1.15, 2.85, 2.9])
sub('用户导航与草稿')
bullet('用明确导航区分功能，保留返回、退出、确认、取消及重新预览；避免把全部业务继续堆在单页长表单。')
bullet('返回保留必要筛选、时段和选择；草稿归属当前身份。切换身份必须清空，不能带到另一个账号。')
bullet('初始化未完成时禁用依赖数据的控件；失败有明确提示和重试入口；管理员卡片不得跳入学生查询。')
bullet('已保存记录以服务端为准；未保存草稿不能被无关读取、验证文本回执或旧保存响应悄悄清除。')
sub('可暂缓内容')
p('真实通知、校园统一认证、门禁、地图、评分、收藏与生产部署继续不在本次范围。管理统计图表优先级低于核心流程，不用模拟数据装饰成真实统计。')

# Contract gaps
h('四 原型交互与接口差距任务')
p('已发现下面三项真实能力差距。它们必须写入首批对照表，不能把缺接口当作删除原型交互的理由。本轮只补原型接入所必需的能力，不扩展到新的校园业务。')
table(['任务','现有基础与目标','允许边界与验证'],[
('X01 完整座位目录', '现GET /seats只返回可预约座位，原型需要完整网格及不可选状态。追加安全的只读目录/可用标记并保留旧字段。', '学生权限、不泄露他人记录；不能用容量差推断占用。停用/关闭/本人冲突、空数据及旧调用兼容均有测试。'),
('X02 按星期开放安排', '原型有星期选择、指定时段/全天/不开放和已保存周安排；现接口仅每日统一。保留这些原交互并增加兼容支持。', '旧每日接口语义继续有效；新周安排有版本前提，按北京时间验证预约，影响有效预约时拒绝。新增结构用增量迁移，保留旧数据。'),
('X03 带时段的资源关闭', '原型填写关闭开始与结束，支持预览后返回修改；现接口只即时关闭到重开。需支持原型时段并保留原即时调用。', '按[start,end)计算影响与阻断，签名预览绑定时段，确认事务内复核；查询/创建/重开/超时均一致，不复活旧取消。'),
], [1.2, 2.85, 2.85])
sub('兼容扩展的操作门槛')
bullet('先写接口与数据影响说明，再增加边界、权限、并发和迁移测试；独立commit。保持已有请求和返回字段兼容，旧前端和自动化覆盖仍有明确行为。')
bullet('如需新schema版本，使用追加迁移，验证v1/v2/v3数据无损升级、重复初始化及失败回滚；不得删库或改旧迁移来绕过。')
bullet('开放安排、关闭时段和座位目录的真实返回必须驱动UI；不能只保存表单文本就显示“已生效”。')
bullet('不改签到/暂离规则口径、身份权限、操作回执或终态保护；原有边界与冲突断言必须保留。')
sub('范围不足时如何记录')
p('X02/X03未完成时，学生端与已接入管理流程仍可作为阶段成果，但必须列为原型交互未完整接入，补充PR保持Draft并说明真实缺口。不能隐藏这些任务、删掉原型控件或用当前简化语义标记整体完成。')

# 4
h('五 真实接入与后端保护')
sub('复用视觉和交互 更换模拟数据链路')
p('原型中的内存数据库、模拟登录、独立角色数据、演示时钟和本地伪状态转换必须退出真实业务链路。优先复用现有 Alpha 请求、状态和错误处理，再组织页面及导航；按需要拆分原生 JS，不要求引入新框架。')
sub('允许必要的只读接口增量')
p('现有 GET /seats 只返回可预约座位，GET /rooms 的 seat_count 只是容量。完整座位图可能需要目录字段：先核对真实响应，再按需向 GET /seats 追加 seat_catalog 等向后兼容字段，或提供有权限的只读目录接口。旧 seats 字段和现有错误契约须保留。')
p('目录只返回展示所需的座位编号、标签、启用及可预约信息，禁止泄露其他学生身份或预约详情。学生端不能调用 /admin/resources。不能用“总座位减可用座位”推断他人占用，也不能把本人冲突导致的空结果全部标为被别人占用。新增字段需契约、权限、边界和回归测试，不增加数据库版本来存装饰数据。')
sub('必须保留的安全与一致性')
bullet('身份、角色和归属由服务端会话获取；所有写操作保留 CSRF。同源请求不把密码、Cookie 或令牌放进日志。')
bullet('时间由服务端判断，UTC 持久化与接口，北京时间显示。保留 [start,end)、4小时/7天等集中规则、版本与预约快照。')
bullet('创建事务、同座位/同学生冲突、操作回执和审计继续整体提交；幂等重试不生成重复记录。')
bullet('暂离/返回提交界面观察到的 expected_version；409 后读取新状态并恢复，不自动替换版本重放旧操作。')
sub('前端请求与页面生命周期')
p('分别保留身份、余量查询、预约列表和管理读取的版本隔离；路由变化须避免对已卸载节点写入。输入变化仅使余量查询失效。旧账号、旧列表、旧错误及旧按钮清理均不得覆盖新状态；加载反馈不能永久卡住。关闭预览、规则草稿另保留自己的前提和版本。')
p('除X01—X03所需兼容增量外，不扩大业务或顺手重构核心契约、超时归因和终态保护。接口和迁移变更必须有理由、影响及测试，不能删断言解决失败。', bold=True)

# 5
h('六 实施顺序与本地提交')
p('每个完整改动按 AGENTS.md 编写或更新相关测试、验证后单独提交。先保护已有文件，不重置、不强推、不夹带他人改动。以下为执行顺序，不代表已经完成。')
table(['批次','实施与提交建议','通过门槛'],[
('0 基线核对', '读 AGENTS、取最新 PR #8/main、核对 HEAD 与工作区；建立页面—接口—状态对照表。', '原型入口和截图可查看；基线能启动；明确接口差距、兼容增量和未实现内容。'),
('1 入口与导航', '恢复登录、学生/管理员页面组织及路由；复用请求层、身份切换与加载处理。', '真实登录/退出、错误重试、返回和身份隔离通过，普通页无工程验证入口。'),
('2 学生预约主线', '完成首页、房间详情、日期时段、座位图、确认、成功回执与本人列表。', '点击房间可进入；真实查询创建取消；返回保留条件；刷新重登与重启可恢复。'),
('3 使用与管理', '接入签到/暂离/返回/结束、A01—A05；按X01—X03补齐原型必需的兼容能力及独立测试。', '两端真实共享；状态版本、草稿保护、预览过期、非法状态和错误提示全部保留。'),
('4 对照与回归', '完成AI逐控件自检、移动端/桌面对照、延迟响应、完整验证、证据与运行文档，修复实际失败。', '新旧回归实际通过；截图对应当前服务，数量、浏览器与失败记录如实保存。'),
('5 补充 PR', '核对依赖与最终差异，提交标题、说明、证据及限制，推送独立分支并建补充 PR。', '完整通过再标 ready；未通过仅 Draft 并列失败，不合并、不部署。'),
], [1.0, 3.0, 2.9])
sub('建议时间检查点')
p('11月28日先完成学生可用闭环，再完成管理端核心接入；11月29日上午集中真实回归与修复，下午冻结范围并整理交付，建议21:00前完成提交检查，为23:59截止预留余量。若未达到门槛，明确缺口，不用旧截图或旧数字宣称完成。')
sub('持续同步文档')
p('更新运行说明、API增量、原型对应表、阶段补充记录、测试证据及已知限制。历史冲刺计划和原报告保留，新增偏差说明与实际修复结果，不倒改原始承诺或虚构成员工时。')

# 6
h('七 测试矩阵与证据要求')
table(['验证组','必须覆盖','证据'],[
('页面与交互', '原型核心页面逐项对照；卡片可点、键盘可选；返回保留条件；无死控件。', '逐页状态表、桌面/手机截图与操作记录。'),
('预约闭环', '真实查询、创建、回执、本人列表、取消；刷新重登和真实服务重启恢复。', '浏览器及HTTP/进程报告。'),
('共享与权限', 'B看不到A记录；取消后B能预约；管理员同库读取；学生不能访问管理数据。', '独立账号上下文、相关后端断言。'),
('状态与规则', '签到、暂离、返回、结束；规则快照、非法转换、短预约结束和超时。', '既有边界与版本回归保留，实际页面走通。'),
('异步隔离', '延迟初始化、账号切换/CSRF、余量乱序、列表乱序、管理旧响应、保存期间新草稿。', '受控Promise、交付完成信号；不只靠固定sleep。'),
('管理流程', '规则前提、开放时间、只读预览、过期重预览、确认关闭、关联返回与重开。', '真实服务和跨端状态一致截图。'),
('兼容接口增量', 'X01—X03：目录隐私、周安排、关闭时段、旧调用兼容、事务及无损升级。', '新增后端测试、迁移/回滚报告及API契约。'),
('展示与恢复', '375×812、390×844及桌面；无横溢、遮挡、缺字；失败能重试，点击可触达。', '实际查看全部关键截图，不能仅断言脚本无异常。'),
('旧工程保护', '原型导出、链接/摘要、防覆盖、中文日志、历史性能报告及测试库隔离。', '完整原型单测、适用原型浏览器与历史摘要。'),
], [1.05, 3.8, 2.05])
sub('完整验证入口')
p('在项目根目录执行 python alpha/scripts/verify_phase4.py；原型单测执行 npm test，若本机无npm，可执行 package.json 中 test 对应的 node --test tests/*.test.cjs 并注明方式。新增 UI 回归接入验证器；适用的原型浏览器也需实际执行。', size=10)
p('所有检查使用独立数据库和新的绝对证据目录。原基线181项后端、70项原型单测、55个Alpha浏览器检查仅为历史参考；新验收按实际收集和执行数量报告。失败、跳过、未执行、环境阻碍分别说明，不写成通过。', bold=True, size=10)

# AI interaction gate
h('八 AI逐控件交互自检门槛')
p('AI自检必须在真实服务、独立数据库和实际安装的浏览器上执行。范围覆盖本计划页面与主要状态中所有可见交互控件；目标是消除“点了没反应”、错误跳转、假成功、草稿丢失和永久加载。它不代表对所有输入组合或所有设备作出绝对无缺陷保证。')
table(['自检步骤','必须执行','通过证据'],[
('建立控件清单', '按U01、S01—S05、A01—A05及弹窗扫描按钮、卡片、链接、页签、筛选、日期/时段、座位及输入提交。', '每项有控件ID、页面、角色、前置状态、触发方式与预期结果；未测不填通过。'),
('实际逐项操作', '鼠标/触屏主路径、键盘Tab/Enter/Space；展开菜单、返回、取消、保存、关闭弹窗等也检查。', '页面位置或状态正确变化；业务写操作核对真实响应与记录，不能仅证明click事件执行。'),
('恢复与异常', '检查空数据、无余量、非法状态、慢响应、请求失败、重试、过期预览、重复提交及切换账号。', '明确可理解反馈，可继续操作；无旧结果覆盖、死按钮或永久加载。'),
('原型对照', '学生和管理端逐页截图对照：布局、信息层级、卡片、座位图、导航、弹窗、底部操作区。', '所有UI/交互差异写明理由与状态；核心交互缺失即未完成，不用“风格类似”代替。'),
('修复与复测', '发现问题先记录并修复，再复测问题路径及受影响回归，最后完整跑验证器。', '问题有复现、修复提交及复验结果；报告不能手工把失败改成通过。'),
], [1.1, 3.2, 2.6])
sub('每个控件合格的最低条件')
p('启用控件可操作且有符合预期的结果；依赖未加载或条件不满足时禁用并说明原因，条件满足后恢复。纯展示元素不能呈现可点击外观。范围外功能可明确展示/禁用，不以“敬请期待”、空处理函数或吞错返回成功冒充已实现功能。')
sub('固定交付文件')
p('在新证据目录输出 AI-INTERACTION-AUDIT.json 及可读报告，字段至少包括control_id、page、role、state、action、expected、actual、result、evidence、commit。另交原型差异表与375/390px及桌面关键截图；网络记录脱敏，仅保留方法、路径、状态码和必要业务编号。')
p('任何清单内未解释的无反应、假成功或核心功能未测，均阻止PR标为ready。AI自检要如实署名，不冒称其他同学测试、非作者批准或团队正式签收。', bold=True)

# 7
h('九 完成标准与补充 PR')
sub('逐项确认后再宣布完成')
for text in [
'原型核心页面、UI与已有交互均有对照记录；房间卡片、日期时段、座位网格、回执、筛选、返回和管理导航形成连续流程。',
'每个成功反馈均有真实服务端结果；无内存假预约、固定演示时间或两套独立角色数据。',
'角色、归属、CSRF、规则快照、状态版本、幂等及异步隔离的原有测试保持有效。',
'已提交记录刷新、重登、真实重启后恢复；超时任务继续独立工作。',
'手机和桌面关键页面实际查看；明确未实现内容，普通用户不会误入工程验证工具。',
'AI逐控件自检、新增与既有检查实际完成；报告与截图对应同一代码，无未解释死交互，历史证据保持不变。',
'代码、接口说明、运行说明、原型对照表、阶段记录及证据位置同步，最终Git状态可核对。',
]: bullet(text)
sub('补充 PR 的依赖与说明')
p('上游仓库为 hoangthithang880-dotcom/studyseat-prototype。执行时先查 PR #8 和 main；若尚未合并，可先本地开发或建注明依赖的 Draft，避免重复宣称其改动。合并后安全整合新主线，使补充 PR 展示本轮界面接入差异。冲突以保留已验证业务保护为前提，不覆盖同学历史。')
p('建议标题：feat: 接入原型核心界面与真实预约管理流程。说明应包含原问题、页面变化、必要接口兼容增量、验证命令与实际结果、截图、证据目录、依赖和剩余限制。不得将未通过的工作标为可合并。本任务不授权合并、强推或发布服务。')
sub('最终交接清单')
p('提供原型逐页/逐控件完成表、AI交互自检报告、原型差异清单、真实验收入口及其代码SHA/端口、独立库说明、截图与测试证据、提交SHA、PR链接和最终git status。材料据实标注AI技术复查、自测与团队签收范围；课程与团队已有非作者审查要求另行落实。')

# 8
h('十 新对话启动与现场环境')
sub('最快启动方式')
p('在新对话选择本项目目录，附上本Word计划书，并粘贴同目录“新对话启动指令.txt”的全部内容。该指令自包含目标、基线、范围、保护和PR交付要求；新对话仍须重新读取现场状态，不依赖旧聊天记忆。')
sub('本机可复用的测试运行时')
table(['组件','已核实位置与注意事项'],[
('开发依赖Python', '/tmp/studyseat-phase3-venv/bin/python；已含Flask、pytest、Ruff。路径在/tmp，执行前检查是否仍存在；失效则按requirements-dev.txt建立新环境。'),
('Node与Playwright', '/Users/zhouyiheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node；NODE_PATH指向同级node/node_modules。'),
('浏览器', '本轮独立复查实际使用Chrome 158.0.8127.37；STUDYSEAT_BROWSER_CHANNEL=chrome。需检查实际安装版本。'),
('证据目录', '建议alpha/evidence/prototype-ui-integration/<本轮唯一编号>/，用绝对STUDYSEAT_EVIDENCE_DIR；不得覆盖历史目录。'),
('当前人工自测', 'http://127.0.0.1:5068 使用旧复查版。数据在/tmp/studyseat-manual-20261128-9hg454ur/manual.sqlite3；不要重置。新服务选其他空闲端口及新库。'),
], [1.15, 5.75])
sub('公开演示账号 仅用于独立测试')
table(['身份','账号','密码'],[
('学生A', '832402116', '123456'),
('学生B', 'student02', 'Study1234'),
('管理员', 'admin01', 'Admin1234'),
], [1.3, 2.8, 2.8])
p('自测服务保留原稳定密钥才能验证会话跨重启；密钥从本机配置读取，禁止复制到PR、截图或测试报告。不同标签页可能共享Cookie，测试多账号使用独立浏览器上下文。', size=10)

# 9
h('十一 原型资料与执行核对')
sub('按以下顺序读取')
for text in [
'AGENTS.md：每项完整改动提交、相关测试通过、不夹带他人文件。',
'prototype/student/home.html、room.html、confirm.html、bookings.html、profile.html，以及 prototype/student-app.js：学生端结构与交互。',
'prototype/admin-ui.js、admin.css、unified-admin-bridge.js 与 unified-student-runtime.js：管理端和导航行为。',
'modao/StudySeat_定版原型.html 与 docs/screenshots/local-final-login.png、local-room.png、local-booking.png、local-admin-rules.png、local-admin-closure.png、local-admin-logs.png：视觉对照。',
'alpha/README.md，以及 alpha/docs/ 下的 API-v1.md、RULES.md、PHASE3.md、PHASE4.md、PHASE4-REVIEW-FIXES.md：接口、状态、数据升级、旧回归与实际限制。',
]: bullet(text)
p('上述仓库内相对路径以本计划首页项目目录为根。原始冲刺计划在 /Users/zhouyiheng/Downloads/StudySeat_代码规范与冲刺计划.docx；本计划补充前端交付门槛，不覆盖原始文件。API文档若存在历史版本说明，应以当前schema v3补充契约和实际代码核对后同步消除歧义。', size=10)
sub('外部依据与固定产品基线')
link('课堂作业原文 与截止和材料要求', 'https://bbs.csdn.net/topics/620611106')
link('正式墨刀原型 00 正式入口 Study Seat', 'https://modao.cc/proto/jojnMZTptnm0v2RS5FJnT5/sharing?view_mode=device&screen=rbpVZKhPnl9bPObwP&canvasId=rcVZMWRghgfFFxdw')
link('仓库最初原型提交 固定UI与交互依据', 'https://github.com/hoangthithang880-dotcom/studyseat-prototype/tree/2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f')
link('PR #8 最新状态 执行前重新核实', 'https://github.com/hoangthithang880-dotcom/studyseat-prototype/pull/8')
link('固定产品基线 源码与修复记录', f'https://github.com/832402123wuyiming/studyseat-prototype/tree/{BASE}')
sub('新对话首次回复应报告的内容')
p('实际项目根、分支、HEAD、git status、PR #8/main状态；已读取的指引；原型与接口差距；下一批将实现的页面与验证方式。随后持续实现，不停在方案。若遇真实阻碍，保留已完成成果并说明需要的具体信息。')
sub('本次计划交付的实际边界')
p('已经核对产品基线与本地目录，建立 codex/prototype-ui-integration，消除Git对象对临时副本的依赖，并把origin指向正式仓库。本次只提交计划书、启动指令、生成与验证材料；没有实现页面改造，没有推送、建PR、合并或部署。实际界面修改由新对话执行。')

footer = sec.footer.paragraphs[0];footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = footer.add_run('StudySeat 原型接入实施计划  ·  ');r.font.size = Pt(9);r.font.color.rgb = RGBColor.from_string('777777')
field = OxmlElement('w:fldSimple');field.set(qn('w:instr'), 'PAGE');footer._p.append(field)
doc.save(OUT)
print(OUT)
