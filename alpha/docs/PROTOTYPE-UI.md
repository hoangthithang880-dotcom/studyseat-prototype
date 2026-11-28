# 原型界面接入

原型基线是 `2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f`，接入计划使用 v1.3。视觉和交互来自 `modao/StudySeat_定版原型.html`、`prototype/student/` 和 `prototype/admin-ui.js`。后端基线为 `2c24361f0cd05f306ea9cc01c129fb0410638424`。Alpha 首页由同源 API 提供和保存业务数据。原来的工程验证工作台仅在显式设置 `STUDYSEAT_DIAGNOSTICS_UI=1` 时从 `/diagnostics` 访问。

2026-11-28 按用户确认更新书本＋座位标识，并补充学生/管理员示例账号，见[登录与标识更新](LOGIN-BRAND-UPDATE.md)。此为原型基线之后明确授权的展示调整，历史截图保留。

| 页面 | 原型交互 | 真实接口 | 实施核对 |
| --- | --- | --- | --- |
| U01 登录 | 账号密码、身份选项、退出 | auth/session、auth/login、auth/logout、me | 身份由服务端决定 |
| S01 首页 | 搜索、房间卡片、立即选座、导航 | rooms、rules | 容量与指定时段可用数量分别显示 |
| S02 房间 | 日期快捷项、时段、分区、座位、继续 | rooms、seats | X01 补全座位状态，网格是示意 |
| S03 确认 | 返回修改、勾选、提交、回执 | reservations POST | 同载荷使用同一幂等键 |
| S04 预约 | 分组、刷新、确认、签到及状态操作 | reservations GET、状态操作 POST | 暂离与返回携带观察版本 |
| S05 我的 | 本人信息、记录摘要、退出 | me、reservations | 摘要来自本人真实记录 |
| A01 规则 | 五项编辑、确认、离开保护 | rules、admin/rules | 保存携带规则前提 |
| A02 开放 | 房间、星期、多选、全天、关闭、自定义 | rooms、admin/rooms/{id}/weekly-hours | X02 追加周规则与版本，旧每日接口继承关系保留 |
| A03 关闭 | 单座或整间、开始结束、原因、预览、确认 | admin/resources、admin/closures | X03 追加半开区间及签名绑定，保留即时关闭 |
| A04 重开 | 关闭详情、影响关联、重新开放 | admin/closures/{id}/reopen、admin/audit-events | 历史取消保留 |
| A05 日志 | 预约筛选、日志详情、关联返回 | admin/reservations、admin/audit-events | 通知交付无真实来源 |

X01 追加只读座位目录，同一个查询快照返回旧 seats 和新 seat_catalog。仅包含座位字段及可预约标记。X02 追加每周覆盖表，未配置的星期继承旧每日时段。X03 在关闭记录上增加可空的开始结束字段，旧关闭记录维持即时到手动重开，预约查询和写入使用相同的重叠边界。迁移保留旧数据并与初始化处于同一事务。


## 页面与原型差异

| 页面 | 已接入 | 展示取舍及当前边界 |
| --- | --- | --- |
| 登录 | 蓝白入口卡、角色选项、密码可见性、真实退出 | 角色选项仅改变表单提示，服务端会话决定权限 |
| 首页 | 房间卡、搜索、清空与恢复、时段余量与全天开放筛选 | 静音、研讨和电脑工位分类保留为禁用展示，暂无真实目录字段 |
| 房间与选座 | 插画、开放数据、日期与时段选择、座位分区、余量和确认区 | 网格为示意。收藏、地图和评价暂无支持。座位不可选时合并显示，避免揭示其他学生的预约 |
| 预约确认 | 确认详情、返回修改、真实凭证 | 签到提醒为禁用态 |
| 我的预约与个人 | 真实列表分组、状态操作、时间线、本人摘要和退出 | 学习趋势与收藏暂无数据。签到采用本人到场的页面确认 |
| 管理 | 规则保存、按星期开放、关闭回退与重预览、重开、预约筛选、日志关联 | 规则时长使用分钟。关闭通知详情表示生成的内容预览，系统未投递 |

## 独立实例验收

使用新的数据库和端口启动，不要复用 5068 对应配置。以下从项目根目录开始，`python` 使用已经装好 `alpha/requirements-dev.txt` 的解释器。

```sh
studyseat_ui_dir="$(mktemp -d /tmp/studyseat-ui-manual.XXXXXX)"
export STUDYSEAT_DATABASE="$studyseat_ui_dir/acceptance.sqlite3"
export STUDYSEAT_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
cd alpha
python -m flask --app studyseat init-db --demo
python -m flask --app studyseat run --host 127.0.0.1 --port 5071
```

启动成功后用 [5071 新版首页](http://127.0.0.1:5071) 验收。进程重启时使用相同环境。
真实机器的完整回归从项目根目录执行 `python alpha/scripts/verify_phase4.py`。
macOS 可设 `STUDYSEAT_BROWSER_CHANNEL=chrome`。设置 `STUDYSEAT_NODE`、`NODE_PATH` 可使用现成 Node 和 Playwright。验证器为每套用例使用独立库，默认创建新证据目录。可以设置 `STUDYSEAT_EVIDENCE_DIR` 为另一个新的绝对路径。浏览器报告记录真实响应、可见反馈、桌面和 375/390px 截图。
原型浏览器回归在临时导出副本运行，保留仓库内基线截图和报告。

## v5 升级和回退

先停止 HTTP 和独立超时任务。使用 `alpha/scripts/backup_db.py` 按交付说明备份原库，并保留现有配置。使用新版执行 `python -m flask --app studyseat init-db`。确认 `/api/v1/health` 返回 `schema_version: 5` 后再启动超时任务。旧版本回退需要同时恢复升级前数据库备份及旧代码，当前库版本应和服务代码匹配。升级不需要重新播种演示数据。

## PR 依赖

[PR #8](https://github.com/hoangthithang880-dotcom/studyseat-prototype/pull/8) 在 2026-11-28 核对时仍为 Open，main 为 `328a3b3d9784d33832094610610498ae14d30935`。补充 PR 应说明该依赖。此前提交 `111e64cf` 的执行限制及报告属于历史记录；本轮已在可以运行 HTTP 与 Chrome 的环境补做验收，见[补充修复和验收记录](PROTOTYPE-UI-COMPLETION.md)。测试通过表示本轮技术检查通过，不替代团队合并批准。
