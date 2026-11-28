# StudySeat API v1 契约

基础路径 `/api/v1`，前端与 API 同源。JSON 字段使用 snake_case。成功为 `{"data": ...}`，失败为 `{"error":{"code":"...","message":"..."}}`。时间使用 UTC ISO 8601 `Z` 字符串，页面显示 Asia/Shanghai。

账号、密码和验证文本须为有效 UTF-8 文本，不接受 NUL 字符或孤立代理码点；无效输入返回 400。非 ASCII CSRF 值返回 403，不产生服务端异常。健康接口同时检查当前支持的数据库版本和初始化版本记录，异常时返回 503。会话 Cookie 只在数据库事务成功提交后轮换，失败时保留原有效会话。

## 已实现接口

| 方法与路径 | 权限 | 输入 | 成功输出 |
| --- | --- | --- | --- |
| GET /health | 公开 | 无 | status、schema_version、server_time |
| GET /auth/session | 公开 | 无 | user（匿名为 null）、csrf_token；首次创建匿名会话 |
| POST /auth/login | 匿名或已登录会话 + CSRF | username、password 字符串 | user、轮换后的 csrf_token |
| POST /auth/logout | 登录 + CSRF | 无 | user=null、新匿名 csrf_token |
| GET /me | 登录 | 无 | id、username、display_name、role |
| GET /rooms | 登录 | 无 | 房间数组，包括开放分钟数、enabled、seat_count；不是可用性查询 |
| GET /rules | 登录 | 无 | version、settings；仅当前最新版本 |
| GET /persistence-notes | 登录 | 无 | 当前用户验证记录数组 |
| POST /persistence-notes | 登录 + CSRF | content，去首尾空格后 1—200 字符 | 201，id、owner_id、content、created_at |
| GET /persistence-notes/{id} | 登录且记录归本人 | 无 | 验证记录；他人或不存在均 404 |
| GET /admin/audit-events | 管理员 | 无 | 最近 100 条事件，按 id 倒序 |

FR-02 对应登录基础与账号安全，FR-12 对应规则读取基础；本阶段验证文本不对应预约需求，只用于工程验收。

## 阶段二预约接口 已实现

关联学生查询、预约主流程、FR-09 取消，以及权限、持久化与并发验收。以下接口均要求 student 会话；所有 POST 还要求 CSRF。管理员访问返回 403。JSON 的 student_id、role 等额外身份字段不影响服务端身份。

| 方法与路径 | 请求与约束 | 成功输出 |
| --- | --- | --- |
| GET /seats?room_id=&start_at=&end_at= | 房间 ID、带时区时间 | 200，{seats:[{id,room_id,label}],start_at,end_at,server_time}；无可用座位为 [] |
| POST /reservations | seat_id、start_at、end_at、idempotency_key | 首次 201；同键同规范化载荷重放为 200，同一预约的当前状态 |
| GET /reservations | 无参数；强制按会话身份过滤 | 200，本人全部预约，start_at 倒序（含取消记录） |
| GET /reservations/{id} | 本人预约 | 200，单个预约；他人或不存在均 404 |
| POST /reservations/{id}/cancel | 无需请求体；本人、PENDING_CHECKIN | 200，CANCELLED 预约；重复取消仍 200，不改首次 ended_at 或审计 |

预约输出含 id、student_id、seat_id、room_id、room_name、seat_label、start_at、end_at、status、rule_version_id、rule_snapshot、created_at、checked_in_at、leave_started_at、leave_deadline、ended_at。不输出幂等键，也不输出其他学生身份或冲突记录。状态操作时间字段按实际发生写入，尚未发生的保持 null；取消时 ended_at 为首次取消时间。

时间输入严格为 `YYYY-MM-DDTHH:mm:ss[.ffffff]Z` 或相同格式加 `±HH:mm`；拒绝无时区、非法日期、倒置和零长度区间。URL 参数中的 `+` 应编码为 `%2B`（使用 URLSearchParams/urlencode）。先规范化为 UTC 六位微秒 `Z` 再比较和保存。区间 `[start,end)`，两端相邻允许。规则版本和完整 settings 快照保存于预约，不随新规则修改。

服务端当前时间判断：开始不能在过去，最长 240 分钟（含边界），开始日期至多为北京时间今天 +7 日（含第七日，按日历日而非 168 小时）；结束可跨日但整个区间须处于房间每日开放范围内，00:00—24:00 房间允许跨午夜。房间与座位均须启用，已有未重开关闭记录也阻止预约。规则参数从当前最新 rule_versions 集中读取；查询同样使用此校验。取消仅允许经过超时补处理后仍为 PENDING_CHECKIN 的预约；不额外设置开始前截止时间。已取消的重放始终返回原取消结果。

查询结果为即时参考，排除未启用座位、关闭座位、与有效预约重叠的座位；本人已有跨座位重叠预约时返回空列表。有效占用状态为 PENDING_CHECKIN、IN_USE、ON_LEAVE；终态不占用。

创建在同一个 BEGIN IMMEDIATE 中依次读取同人幂等键、读取规则与资源、校验时间与启用状态、检查座位及本人重叠、插入预约和关联审计；任一步失败整体回滚。幂等键为 1—100 个有效 UTF-8 字符，按学生隔离。语义载荷为 seat_id、规范化 start_at/end_at，同一时刻的不同偏移表示视为同载荷；异载荷返回 409 IDEMPOTENCY_CONFLICT。重放优先于当前规则/时间校验，返回原记录当前状态，即使已取消也不复活。取消的归属、状态检查、更新与审计同样在一个写事务内完成。

新增错误：400 TIME_INVALID；409 RESOURCE_UNAVAILABLE、RESERVATION_CONFLICT、IDEMPOTENCY_CONFLICT、STATE_NOT_ALLOWED；503 RULES_UNAVAILABLE（当前规则损坏）。现有 401、403、404、DATABASE_BUSY 和事务回滚策略保持有效。

## 会话和错误

与旧 SRS 的登录 token 返回字段不同，当前采用 HttpOnly、SameSite=Lax Cookie `studyseat_alpha`，Cookie 中只携带签名的随机会话标识，数据库保存其 SHA-256 摘要、用户标识、CSRF 和到期时间。用户与角色从数据库逐请求读取，角色变更或禁用立即作用于后续请求。会话有效 8 小时，登录和退出轮换标识并使旧标识失效。HTTPS 模式启用 Secure。

先 GET `/auth/session` 获取 Cookie 和 csrf_token；所有 POST 需 `X-CSRF-Token`。登录前也必须获取 CSRF。浏览器 fetch 使用同源凭据，角色不接受客户端指定。持久化与审计在同一事务提交。禁止把密码、Cookie 或 CSRF 写入日志。

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | INVALID_INPUT | 参数类型、长度或 JSON 对象无效 |
| 401 | AUTH_REQUIRED | 未登录、失效、过期或账号禁用 |
| 401 | INVALID_CREDENTIALS | 账号或密码错误，统一提示 |
| 403 | FORBIDDEN | 角色无权限 |
| 403 | CSRF_INVALID | CSRF 缺失或不匹配 |
| 404 | NOT_FOUND | 记录不存在或不归本人；未知路径也返回 JSON 404 |
| 413 | REQUEST_ENTITY_TOO_LARGE | 请求体超过 8 KiB |
| 503 | DATABASE_BUSY | 锁等待超过 5 秒，Retry-After: 1；写入未成功 |
| 503 | DATABASE_UNAVAILABLE / NOT_INITIALIZED | 数据库未就绪或缺少初始化数据 |

## 阶段三状态与管理接口 已实现

数据库版本为 2，首次升级执行 `flask --app studyseat init-db`（演示数据可加 `--demo`）。v1 表声明保持不变，新增迁移保留原数据。

除只读 GET 外，下列接口均要求会话、相应角色和 CSRF。状态操作强制本人归属，他人和不存在均 404。所有写操作（仅预览除外）提交 `idempotency_key`：1—100 字符，按执行者隔离，绑定操作类型与载荷，同键异操作/异载荷 409。已有取消接口仍允许无请求体。

| 方法与路径 | 请求与约束 | 输出 |
| --- | --- | --- |
| POST /reservations/{id}/check-in | student；操作键；快照签到窗口两端包含 | 当前预约；首次签到时间不被重放覆盖 |
| POST /reservations/{id}/leave | student；操作键、expected_version；仅使用中，新一轮暂离使用新键 | 暂离中，leave_started_at、leave_deadline |
| POST /reservations/{id}/return | student；操作键、expected_version；仅暂离中，截止包含且尚未到 end | 使用中；旧轮次相同键重放不改变新轮次 |
| POST /reservations/{id}/finish | student；操作键；使用中或暂离中 | 已结束；重复结束保留首次 ended_at |
| GET /admin/reservations | admin | 所有学生的同一份真实预约，含终态 |
| GET /admin/resources | admin | seats 和 closures（包括已重新开放记录） |
| POST /admin/rules | admin；settings 完整五项、base_version、操作键 | version、settings；旧版本冲突 409，内容相同不新增版本 |
| POST /admin/rooms/{room_id}/hours | admin；opens_minute、closes_minute、base_hours:[旧开始,旧结束]、操作键 | 房间；若影响有效预约则 409，旧开放时间不匹配则 409 |
| POST /admin/closures/preview | admin；room_id 或 seat_id 二选一、reason | affected、blockers、target、fingerprint、preview_token、300 秒有效期、server_time；只读无副作用 |
| POST /admin/closures | admin；preview_token、操作键 | 关闭记录；锁内复核影响，变化 409 PREVIEW_STALE；存在使用中/暂离中为 409 RESOURCE_IN_USE |
| POST /admin/closures/{id}/reopen | admin；操作键 | 关闭记录，首次 reopened_at 不被重复请求覆盖，不恢复预约 |

完整设置的范围：max_duration_minutes 1—1440，max_advance_days 1—30，check_in_early_minutes 和 check_in_late_minutes 0—240，leave_limit_minutes 1—240。全部必须为整数，布尔值、缺项、额外项和越界均 400。损坏的当前规则或预约快照返回 503 RULES_UNAVAILABLE。

规则写入需提交读取到的 base_version；只有配置发生变化才新增不可变版本与审计。预约继续使用自身 rule_snapshot。管理端开放时间修改需覆盖当前全部有效预约，否则要求先处理预约；参数是每日北京时间 00:00 起分钟，允许结束为 1440。

签到按 `[start-early,start+late]` 判断，严格超过迟到截止才过期，预约区间到 end 即不再使用。暂离 deadline 为 min(首次暂离时间+快照上限,end)，恰好在 deadline 且尚未到 end 时允许返回。暂离截止先于 end 且严格超时为 EXPIRED；end 先到或二者相等时自然 COMPLETED。待签到记录无论多晚补处理仍是 EXPIRED，不会当作正常完成。ended_at 保存实际生效边界，审计 occurred_at 保存任务实际处理时刻。

签到、返回、结束重放返回预约当前状态；不会使终态复活。已签到后的签到重试不会从暂离返回；新一轮暂离/返回必须使用新操作键。操作键凭据和预约变更、审计在一个 BEGIN IMMEDIATE 中提交。超时判定在取得锁后取服务端时间；迟到请求返回状态错误前保留已完成的超时转换，审计失败则整体回滚。

`flask --app studyseat expire-reservations` 单次执行补偿；加 `--watch --interval 30` 作为独立工作进程，不依赖网页打开。并行执行或重启后重跑不重复迁移和记审计。本人列表、预约详情、查询、创建和管理员预约列表也做服务端补处理。查询结果仍只是即时参考，创建时重新校验。

关闭是立即生效、持续到手动重新开放的最小实现，不提供未来定时关闭。预览签名绑定管理员、资源、原因及当时影响摘要，300 秒失效；确认不接受替换范围。确认锁内校验原始影响摘要、资源和关闭记录，新增预约、取消或签到都会令旧预览失效。预览本身不执行超时或审计写入；数据已到期需刷新管理数据补处理后重新预览。使用中与暂离中阻断关闭，沿用当前原型，和旧 SRS 差异仍待团队确认。关闭记录、取消的待签到预约及对应审计整体提交；重新开放不复活已取消记录。通知仅为站内操作记录，没有真实投递。

新增错误：409 RULE_VERSION_CONFLICT、RESOURCE_CHANGED、RESERVATIONS_AFFECTED、PREVIEW_STALE、RESOURCE_IN_USE；保留既有 AUTH_REQUIRED、FORBIDDEN、CSRF_INVALID、NOT_FOUND、DATABASE_BUSY 等契约。验证步骤与本轮结果见 [PHASE3.md](PHASE3.md)。

## 阶段三独立审查补充契约

数据库 v3 新增预约 state_version（非负整数，旧记录从 0 开始）。创建初始为 0，签到、暂离、返回、结束、取消、资源关闭取消与超时实际改变状态时加 1；无副作用的重复操作不递增。列表、详情及写入返回均含该字段。

leave/return 必须发送 `{idempotency_key, expected_version}`，expected_version 取自该次操作观察到的预约快照；缺失、布尔、负数或非整数为 400 INVALID_INPUT。服务端在 BEGIN IMMEDIATE 内先补处理超时、核对原操作回执，再比较预期版本与当前版本。首次迟到/并发旧版本为 409 STALE_RESERVATION，不改当前轮次、暂离截止或新增回执/操作审计；若已超时，合法超时结果仍提交。相同操作键必须绑定同一 expected_version、操作及预约，异前提返回 409 IDEMPOTENCY_CONFLICT。已记录的同键同前提重放返回当前预约，不重新执行旧暂离/返回。签到和结束无循环风险，既有幂等输入保持有效。

v1/v2 数据与历史回执升级时保留；历史 leave/return 回执不补造缺失的轮次前提。升级后刷新客户端，新的界面读取 state_version 并生成新操作键；旧客户端缺少前提会被拒绝，不能静默按最新版本替换旧请求。

expire-reservations --watch 遇到 SQLITE_BUSY/SQLITE_LOCKED 会回滚、输出重试信息并有界指数退避（首次为 min(interval,30) 秒、最多 30 秒），成功后恢复正常间隔。单次模式锁忙与不可恢复数据库错误仍非零退出；不吞掉数据库损坏或审计完整性错误。

## 原型座位目录

GET /seats 保留旧 `seats` 字段及房间、时段、权限校验。新增
`seat_catalog`，每项含 `id`、`room_id`、`label`、布尔值
`enabled` 和 `available`。`available=false` 可能由停用、关闭、
座位时段冲突或本人时段冲突导致。返回不包含其他预约或用户身份。
空房间返回两个空数组。

## 每周开放安排

数据库 v4 新增按房间、星期存储的开放安排覆盖项。GET /rooms 追加
`weekly_version` 与从星期一开始的七项 `weekly_hours`。每项为
北京时间开关分钟数组，`[null,null]` 代表不开放，`[0,1440]` 代表全天。
未设置的星期继续继承 `opens_minute` 和 `closes_minute`。

管理员 POST /admin/rooms/{id}/weekly-hours 提交 `weekdays`（0 至 6，
不可重复）、`mode`（`custom`、`all_day`、`closed`）、`base_version`
与 `idempotency_key`。自定义另需 `opens_minute`、`closes_minute`。
成功返回 `version` 与七日 `weekly_hours`。修改影响有效预约时返回
RESERVATIONS_AFFECTED，版本过期时返回 RESOURCE_CHANGED。旧 /hours
继续修改每日默认值，保留周覆盖，并在实际修改时递增周版本。

## 指定时段的资源关闭

数据库 v5 给关闭记录追加可空的 `start_at`、`end_at`。旧请求可以继续省略两个字段，关闭立即生效且持续到重新开放。也可以在预览同时提交两个带明确时区的时间，关闭只影响与 `[start_at,end_at)` 重叠的预约。触及边界的相邻预约不受影响。结束必须晚于当前服务端时间，已开始的区间可以关闭其剩余时间。

预览返回 `mode=scheduled`，签名绑定标准化时段、管理员、资源和影响快照。确认时再次校验结束时间、数据库影响和当前状态，不允许强制取消使用中或暂离中的预约。待签到预约在确认时取消。已到期的限制不阻挡新预约，主动重新开放仍允许提前结束有效限制。已取消的预约保留。管理资源、关闭回执与审计返回真实时段。
