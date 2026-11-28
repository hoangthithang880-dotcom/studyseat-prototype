# 原型界面接入

原稿为 `modao/StudySeat_定版原型.html`、`prototype/student/` 和 `prototype/admin-ui.js`。Alpha 的旧工作台用于保留工程回归。所有真实写入由同源 API 校验和持久化。

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
