# 原型接入补充修复与验收记录

## 继续实施的材料和边界

继续使用 v1.3 实施计划、最初原型 `2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f` 及其墨刀对应材料，产品基线是 PR #8 的 `2c24361f0cd05f306ea9cc01c129fb0410638424`。本次承接独立副本交付提交 `111e64cf5409c85527596c84899dd0a242d48265`，保留此前完整提交，不覆盖或改写同学历史。

学生 U01/S01–S05、管理 A01–A05，以及座位目录 X01、每周开放 X02、时段关闭 X03 已接入真实服务。数据库为 v5。页面对照和没有业务支持的展示项目见 [PROTOTYPE-UI.md](PROTOTYPE-UI.md)。不把收藏、地图、评价、消息投递、学习趋势等禁用或展示项目写成已实现。

## 独立复查发现和修复

真实 Chrome 中延迟交付创建预约的真实 201 回执；等待期间返回房间，将新草稿改为 13:00–14:00 并选择 A02；释放旧回执后，再离开并进入房间。原实现无提示恢复到默认 08:00–09:00，丢失新草稿。仅比较草稿对象引用无法识别同一个对象中的后续编辑。

预约草稿现在有独立编辑版本。查询条件、座位及须知编辑推进草稿版本；创建时捕获版本，成功后仅清除尚未编辑的已提交草稿。保留身份、路由、座位和预约列表各自的保护，也保留网络失败后的同键重试。后端权限、事务与幂等契约没有变化。

旧账号隔离、列表乱序等历史浏览器套件访问 `/diagnostics`，继续保留其断言，但不再用其结果代表新版页面。新增 `prototype-async-browser.cjs` 直接访问 `/`，使用真实服务、独立数据库、受控 Promise 及应用消费响应后的完成信号。仅暂缓指定响应或制造指定请求的失败，不使用固定等待判断成功。

新增 16 个新版场景：新草稿保护；创建回执丢失后的幂等重试；座位新响应先到、旧响应先到、旧错误迟到；创建前列表迟到；取消列表两种顺序、旧错误晚到及新读取期间的旧错误；当前列表错误重试；旧账号成功与 CSRF 错误迟到；延迟会话恢复；初始化失败重试与控件就绪；手机管理重置、离开确认与宽度。逐控件清单加入规则重置、开放安排重置，由 85 项变为 87 项。

新增 4 个后端事务回归：周开放安排两个独立连接竞争、周安排审计失败回滚、时段关闭审计失败时预约与回执整体回滚、两个关闭确认竞争仅产生一条关闭及取消审计。修正升级报告的固定“v3”措辞，按实际 schema 版本输出。

## 验证记录

修复前新草稿用例已实测失败，错误为 `08:00 !== 13:00`。修复后新增 16 场景及 87 项逐控件自检在真实 Chrome 全部通过；4 项事务回归通过。完整验证由项目根目录执行 `python alpha/scripts/verify_phase4.py`，实际依赖使用 `alpha/requirements-dev.txt`，通过 `STUDYSEAT_BROWSER_CHANNEL=chrome` 选择本机安装的 Chrome；`STUDYSEAT_NODE` 和 `NODE_PATH` 指向现成 Node/Playwright。

`04e4200` 已完成完整验证：197 项后端、70 项静态原型单测、55 项旧工作台浏览器检查、87 项新版逐控件自检、16 项新版时序回归、6 条原型浏览器流程均通过；Ruff、JS 语法、真实 HTTP 重启、v1→v5 升级、独立超时进程和 HTTP 争抢检查通过。浏览器为 macOS 的 Chrome 158.0.8127.37，没有失败或跳过项。进一步加强换号和恢复会话后的断言：从页面完成新账号的真实 POST，而非由测试辅助 API 获取新的 CSRF 后创建。

最终整套复验在计划指定目录 `/Users/zhouyiheng/Desktop/软件工程/studyseat-phase4-ui-fix` 执行，测试提交为 `519d2021fe80313c5b3e5ca560c6a2d385ef2439`，完成于北京时间 2026-11-28 10:40。结果仍为全部通过。此前独立复查的完整运行针对 `111e64cf`，不冒充本次修复提交的完整结果。

| 检查 | 最终实际结果 |
| --- | --- |
| pytest | 197 passed，0 failed / errors / skipped；86.85 秒 |
| 静态原型单测 | 70 passed，0 failed / skipped |
| 新版逐控件自检 | 87 passed，0 failed / not_run |
| 新版时序与恢复 | 16 passed，页面未捕获异常为 0；换号后从页面成功创建预约 |
| 历史工作台浏览器 | 55 项通过，访问 `/diagnostics`，与新版分开计数 |
| 静态原型浏览器 | 6 条流程通过 |
| Ruff、JS 语法 | 全部通过 |
| 真实 HTTP 重启、v1→v5 升级、独立超时进程 | 通过；双超时进程仅处理一次、仅一条超时审计 |
| HTTP 并发 | 同座位 20 请求：1×201、19×409，数据库 1 条预约，完整性检查 ok |

[本轮证据目录](../evidence/prototype-ui-completion/20261128-final) 新增保存，不覆盖历史报告。其中 [summary.json](../evidence/prototype-ui-completion/20261128-final/summary.json) 记录命令和数量，[完整验证器结果](../evidence/prototype-ui-completion/20261128-final/full/verification.json) 对应最终测试提交；[87 项控件清单](../evidence/prototype-ui-completion/20261128-final/full/prototype-integration-browser/AI-INTERACTION-AUDIT.md)、[16 项时序结果](../evidence/prototype-ui-completion/20261128-final/full/prototype-async-browser/results.json)、修复前失败记录、原始日志及新版 17 张截图一并保存。`final-source.json` 固定 48 个源文件及测试摘要，后续证据文档提交不改变这些文件。

本次完整命令如下，运行目录为上述项目根目录：

```sh
STUDYSEAT_EVIDENCE_DIR=/tmp/studyseat-ui-completion-evidence/final-full \
STUDYSEAT_BROWSER_CHANNEL=chrome \
STUDYSEAT_NODE=/Users/zhouyiheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
NODE_PATH=/Users/zhouyiheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
/tmp/studyseat-phase3-venv/bin/python alpha/scripts/verify_phase4.py
```

## 本机验收及 PR

当前 [5071 验收入口](http://127.0.0.1:5071/) 来自计划指定项目，使用独立持久化数据库 `alpha/instance/prototype-ui-5071.sqlite3`，会话配置位于被 Git 忽略的本机私有文件，未进入证据或提交。已同时启动独立超时轮询。原 [5068](http://127.0.0.1:5068/) 仍返回 schema v3，新实例返回 v5，新页面脚本与交付源文件摘要一致。

学生 `832402116 / 123456`，另一学生 `student02 / Study1234`，管理员 `admin01 / Admin1234`。依次操作房间卡片、日期/时间、查询、选择座位、确认须知与预约、本人记录、取消；在临近开始的有效签到窗口操作签到、暂离、返回与结束。管理员可验证规则、星期开放、关闭预览与回退、确认后取消同一预约、重开保留取消状态、日志关联返回。刷新、重登和服务重启后的持久化由完整验证中的真实 HTTP 进程检查覆盖。

补充分支为 `codex/prototype-ui-integration`。PR #8 来自同学的 fork `832402123wuyiming/studyseat-prototype`，在本轮核实时尚未合并；补充 PR 目标为 main，注明依赖并保持 Draft。当前比较会包含 #8 的既有变更，先合并 #8 后再复核差异；本次不合并、不部署。

## 交付限制

测试使用独立数据库，不操作旧 5068 服务和数据。不将 AI 自检写成团队非作者批准。Windows/Edge 未执行；本轮只记录实际运行的 macOS/Chrome。原型页面的样式和主要交互已恢复，但座位图仍为空间示意，禁用项目边界保留。
