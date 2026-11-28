# StudySeat Alpha 使用与管理阶段

当前已完成阶段一服务基础、阶段二预约与并发控制，并在已合并 PR #3 的主线基础上开发 11 月 25—26 日第三阶段。真实业务由 Flask 同源首页与 API 提供，SQLite 持久化；保留原型蓝白视觉和独立静态原型，不将原型模拟流程计作真实业务。

首页提供学生预约和管理员工作区，按原型组织导航，以真实 API 读取和更新共享数据。学生可查座、预约、取消、签到、暂离、返回和结束。管理员可设置每周开放安排，预览并确认关闭区间，重新开放并查看审计。已提交记录由服务持久化。原型对照、复验和准备工作见 [原型接入记录](docs/PROTOTYPE-UI.md)。

运行和验收见 [PHASE3.md](docs/PHASE3.md)，契约见 [API-v1.md](docs/API-v1.md)，规则见 [RULES.md](docs/RULES.md)；历史结果保存在 [PHASE2.md](docs/PHASE2.md)。

## Windows 启动

需要 Python 3.10 或更新版本。打开 PowerShell，进入本文件所在的 `alpha` 目录：

```powershell
./start.ps1 -Python 'C:/你的Python目录/python.exe'
```

如果 Python 已正确配置在 PATH 中，可直接执行 `./start.ps1`。脚本创建 `.venv`、安装运行依赖、初始化数据库并启动 [本机首页](http://127.0.0.1:5000)。如果执行策略阻止脚本，可以在当前进程运行 `Set-ExecutionPolicy -Scope Process Bypass` 后重试，或使用下面的手动方式。

首次安装需要网络。如果默认 PyPI 无法访问，可先创建虚拟环境并执行 `./.venv/Scripts/python.exe -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`，再运行启动脚本。

脚本在 `instance/.secret-key` 保存随机本机密钥并通过环境变量注入服务。保留该文件和数据库，重启后会话可继续使用；若已经设置 `STUDYSEAT_SECRET_KEY`，优先使用环境配置。运行数据、密钥和虚拟环境均被 Git 忽略。初始化命令不会清空或重置已有用户、规则和验证记录。

## 手动启动与 Linux macOS

PowerShell 手动方式：

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
$env:STUDYSEAT_SECRET_KEY = '替换为至少32字符的随机密钥并在重启时使用相同值'
./.venv/Scripts/python.exe -m flask --app studyseat init-db --demo
./.venv/Scripts/python.exe -m flask --app studyseat run --host 127.0.0.1 --port 5000
```

Linux/macOS：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export STUDYSEAT_SECRET_KEY='replace-with-a-stable-random-secret-of-32-or-more-characters'
.venv/bin/python -m flask --app studyseat init-db --demo
.venv/bin/python -m flask --app studyseat run --host 127.0.0.1 --port 5000
```

默认数据库为 `alpha/instance/studyseat.sqlite3`。可用 `STUDYSEAT_DATABASE` 指定绝对路径；修改路径前需重新初始化对应文件。`.env.example` 列出环境配置，应用不自动读取 `.env`。HTTPS 环境设 `STUDYSEAT_HTTPS=1`，本地 HTTP 保持为 0。无密钥或密钥少于 32 个字符时服务拒绝启动。

## 公开测试账号

| 身份 | 账号 | 密码 |
| --- | --- | --- |
| 学生 A | 832402116 | 123456 |
| 学生 B | student02 | Study1234 |
| 管理员 | admin01 | Admin1234 |

身份由数据库决定，登录表单不接受角色参数。`--demo` 才会安装公开账号和 4 间房、312 个座位、规则 v1；不带该选项只创建结构。本阶段不提供注册、重置密码或校园认证。

## 验收步骤

1. 访问首页与 `/api/v1/health`，学生 A 登录，选择 A101、明日北京时间 09:00—10:00 查询并预约 A01。
2. 刷新、退出重登，预约仍在；用同样数据库和密钥重启服务后仍可恢复。
3. 学生 B 登录，本人列表没有 A 的预约，不能读取或取消 A 的记录，同座位重叠时段不能预约。
4. A 取消，B 重新查询后能预约该座位原时段。管理员可查看同库的预约创建和取消审计。
5. 使用后端并发用例复现两个独立连接的竞争；不以页面按钮禁用作为并发保障。

资源目录数量不表示任意时段余量，查询结果也需创建时事务内复核。所有页面时间按北京时间显示，API 和数据库统一 UTC `Z`。提前 7 天按北京时间日历日计算，包含第七日；仅待签到预约可取消。详见 [规则](docs/RULES.md)。

## 自动化验证

在 `alpha/` 运行：

```powershell
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
./.venv/Scripts/python.exe -m pytest -q --junitxml=evidence/pytest.xml
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m ruff format --check .
./.venv/Scripts/python.exe scripts/process_smoke.py
```

`process_smoke.py` 使用临时数据库、随机端口和两个真实子进程；验证预约、文本和会话跨进程恢复、重登恢复、创建重放、重复取消、B 预约释放时段与唯一审计。

浏览器用例使用仓库根目录的 Playwright 开发依赖和本机 Edge。在根目录安装依赖后，以 `STUDYSEAT_DIAGNOSTICS_UI=1` 启动一个使用**独立空数据库**的测试服务（5057 端口），执行 `node alpha/tests/browser.cjs`。旧验证工作台位于 `/diagnostics`，默认关闭。新版首页回归使用 `node alpha/tests/prototype-integration-browser.cjs`。可用 `STUDYSEAT_TEST_URL` 更改地址。浏览器测试会写入公开测试账号的验证记录，仅用于测试数据库。截图及结果位于 [evidence/](evidence/)。

阶段二完整验证（在 alpha 下）：

```bash
python -m pip install -r requirements-dev.txt
# macOS 示例；Windows 如使用 Edge 可省略此变量
export STUDYSEAT_BROWSER_CHANNEL=chrome
python scripts/verify_phase2.py
```

先安装根目录 package.json 的 Playwright 开发依赖（`pnpm install --frozen-lockfile`）。如果使用 bundled runtime，可通过 NODE_PATH 指定其 node_modules，通过 STUDYSEAT_NODE 指定 Node 可执行文件。验证器为每套浏览器用例新建独立数据库，运行全部后端、格式、原型、进程重启和浏览器检查，结果位于 evidence/phase2；不会修改日常数据库和历史原型截图。Windows 用 PowerShell 的 `$env:STUDYSEAT_BROWSER_CHANNEL='msedge'` 设置环境变量。运行依赖包含 tzdata，以支持 Windows 的 Asia/Shanghai 时区。

## 代码与交接

账号切换失败与延迟响应的补充回归：在独立测试数据库启动服务，设置 `STUDYSEAT_TEST_URL` 后从仓库根目录运行 `node alpha/tests/account-switch.cjs`。默认 Edge，可用 `STUDYSEAT_BROWSER_CHANNEL` 选择实际安装的浏览器；结果保存到 `alpha/evidence/account-switch/`。原浏览器脚本和进程重启脚本支持 `STUDYSEAT_EVIDENCE_DIR` 将本轮结果另存，保留历史报告。修复与实际验证见 [账号切换复核报告](docs/ACCOUNT-SWITCH-REVIEW.md)。

`studyseat/api.py` 处理 HTTP；`auth.py` 处理认证、会话和权限；`db.py` 管理每请求独立连接与统一写事务；`schema.sql` 定义 v1 数据结构；`seed.py` 管理公开初始化数据；`reservations.py` 集中处理时间、规则、冲突及预约事务。所有写入口使用 `BEGIN IMMEDIATE`，失败回滚，锁等待上限 5 秒，锁忙返回 503 和重试提示。数据库新增版本需新迁移，不能仅修改旧表声明。

接口契约见 [docs/API-v1.md](docs/API-v1.md)，规则口径见 [docs/RULES.md](docs/RULES.md)，阶段任务、实测和限制见 [docs/DAY1.md](docs/DAY1.md)。

当前为本地开发与课程验收服务。阶段三已实现签到、暂离、返回、结束、独立超时任务、管理员规则写入、开放安排及资源关闭。公开部署前还需完成登录限速、生产 WSGI/HTTPS 配置和剩余业务验证。

任务和代码已发布至 GitHub：[D1-001 Issue #1](https://github.com/hoangthithang880-dotcom/studyseat-prototype/issues/1)、[功能提交 fd335ba](https://github.com/832402123wuyiming/studyseat-prototype/commit/fd335bafa329659a2b9cd91e1f048b75910e2677)、[PR #2](https://github.com/hoangthithang880-dotcom/studyseat-prototype/pull/2)。阶段一作者通过个人 Fork 提交 PR。AI 技术复核已修复 4 类问题，34 项后端测试和浏览器、重启回归通过，详情见 [技术复核报告](docs/REVIEW-D1-001.md)。阶段一 PR #2、阶段二 PR #3 均已合并。第三阶段目前为本地开发与验证，非作者审查与正式验收待团队完成。

P2 独立审查修复了初始化期间编辑查询条件导致房间列表永久为空的问题。工作台加载期间查询控件禁用，失败时可点击“重新加载工作台”；条件编辑仅使旧余量查询失效。新增 `alpha/tests/initialization-browser.cjs` 已接入完整验证。复核时通过 `STUDYSEAT_EVIDENCE_DIR` 指定新证据目录，保留历史结果。缺陷与本轮证据见 [阶段二复核记录](docs/PHASE2.md#p2-独立审查前端初始化修复)。

预约列表独立复查增加了同一身份下的列表请求版本保护。创建、取消成功后旧读取失效；手动刷新保留现有记录并显示加载提示，旧错误或按钮清理不干扰最新操作。新增 `alpha/tests/reservation-list-browser.cjs` 已纳入完整验证；本轮复现、修复和结果见 [列表乱序复查记录](docs/PHASE2.md#p2-预约列表乱序修复)。


## 阶段三 使用与管理联动

阶段二合并主线之后，在 `codex/phase3-attendance-admin` 开发。功能与验收见 [PHASE3](docs/PHASE3.md)，状态和接口见 [API](docs/API-v1.md)。原型目录仍是模拟演示；真实业务从本 Alpha 服务首页进入。

已有阶段二数据库：先停服务并保留数据库与稳定密钥，备份数据库后使用原环境运行 `python -m flask --app studyseat init-db`，将 v1/v2 原子迁移到 v3，再启动服务。不要删库重建。首次使用仍按上文 `init-db --demo` 初始化。`schema.sql` 保留 v1 原声明，保留 `studyseat/migrations/002_phase3.sql` 并新增 `003_state_version.sql`；同一升级命令可重复执行，不重复生成数据。该段为第三阶段历史说明，当前版本和回退步骤见 [原型接入记录](docs/PROTOTYPE-UI.md)。

另一个终端使用相同 DATABASE 和 SECRET_KEY 环境启动独立超时进程：

```sh
python -m flask --app studyseat expire-reservations --watch --interval 30
```

单次补处理省略 `--watch`。任务不依赖浏览器；应用读取也补处理，因此任务暂停后重新运行可恢复。两个工作进程同时处理不会重复释放和记审计。实际状态以服务端为准，最多存在任务轮询间隔带来的处理延迟。

完整验证（独立数据库，不接触日常实例）：

```sh
python scripts/verify_phase3.py
```

Node 与 Playwright 依赖及浏览器选择沿用阶段二。macOS 可设 `STUDYSEAT_BROWSER_CHANNEL=chrome`，Windows 默认 msedge。证据默认存放 `evidence/phase3/`，可用 `STUDYSEAT_EVIDENCE_DIR` 指向一个新的目录，历史阶段二报告不覆盖。验证包括全部后端、格式、原型测试、原有五组浏览器、阶段三跨端浏览器、真实 v1 升级/重启及两个独立超时进程。Windows/Edge 必须实际执行才能计为通过。

本次独立审查修复：暂离/返回使用预约状态版本防止首次迟到请求作用于后续轮次；超时 watch 在临时锁竞争后由同一进程退避恢复；管理员保存验证文本只刷新验证记录和管理读取，保留等待期间的新规则草稿。升级前同时停止 HTTP 服务和任务进程，备份数据库；升级后刷新浏览器以读取新状态前提。不可恢复任务故障仍需操作者或外部进程监管恢复，本轮没有部署监管服务。完整验证已加入 phase3-review-browser.cjs 及真实锁恢复测试，运行时用 STUDYSEAT_EVIDENCE_DIR 指向新目录以保留历史证据。详情见 [独立审查修复记录](docs/PHASE3.md#独立审查修复)。

## 第四阶段集成与合并前验证

第四阶段基于已合并 PR #6 后的 main 328a3b3，保留本文件中全部 v3 升级和后台超时说明。执行 `python scripts/verify_phase4.py` 可复跑后端、七套浏览器、升级与真实进程恢复及 HTTP 实测，结果另存 evidence/phase4-integration。见 [阶段记录](docs/PHASE4.md)、[合并前审查](docs/PHASE4-MERGE-REVIEW.md) 和 [交付说明](docs/DELIVERY.md)。任务为 Issue #7，合并请求为 PR #8。历史 phase4 证据和 Word 博客是初次候选快照，不代表本次 main 集成结果。
