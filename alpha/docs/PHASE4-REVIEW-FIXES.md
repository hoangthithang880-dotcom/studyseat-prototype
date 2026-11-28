# 第四阶段独立审查问题修复记录

## 范围和版本

审查与修复基线为 `71cabb929c98566db4f074c6dc8c6f70336c6969`。开始时 PR #8 未有后续提交，旧工作区干净；使用独立目录恢复同一提交与完整文件树后分批修改。当前复验的代码提交为 `969c62b32c73cecfb9340e03cd7b3c98fae67f22`。本轮继续更新 PR #8，不新建替代 PR，不合并。

## 修复内容

1. 导出副本 Word 链接。`prepare-github.py` 只对白名单中的 `docs/StudySeat-Alpha-Phase4-Blog.docx` 开放导出，未扩大其他 Word 或整个工作区的范围。回归检查导出文件存在、内容与源文件一致、清单摘要、全部文档链接、禁止覆盖和敏感文件排除。Windows 首次根目录测试还暴露原型生成器的平台默认换行导致重建摘要不同；生成文件现固定 UTF-8 与 LF，保留原摘要断言，未重生成或修改原型成品。
2. 性能证据目录。负载脚本读取 `STUDYSEAT_EVIDENCE_DIR`，未设置才回退至原默认目录。完整验证的 JSON、日志和其他结果归入同一新目录。新增绝对与相对目录的真实负载回归，在隔离副本中验证原默认报告和模拟日常数据库摘要不变。
3. 中文日志。阶段二、三收集器先继承环境再合并调用方配置，强制 Python 子进程按 UTF-8 输出，父进程严格解码，不替换乱码。新增未预设 UTF-8、继承 CP936、保留数据库/浏览器和父环境变量、中文失败日志与非零退出码回归。新增6项编码检查在修复前全部失败，修复后全部通过；记录保留。

## 文件范围

- `scripts/prepare-github.py` `scripts/build-prototype.py` `tests/submission.test.cjs`
- `alpha/scripts/phase4_load.py` `alpha/scripts/verify_phase2.py` `alpha/scripts/verify_phase3.py`
- `alpha/tests/test_delivery.py` `alpha/tests/test_performance_evidence.py`
- `alpha/docs/PHASE4.md` `alpha/docs/DELIVERY.md` `alpha/docs/PHASE4-MERGE-REVIEW.md` 及本文
- `alpha/evidence/phase4-review-fixes/` 为本轮新增诊断与完整证据

未修改 `alpha/studyseat` 下的业务、schema v3 迁移、状态版本、权限、事务、幂等与迟到响应防护。

## 完整复验

在 alpha 执行 `python scripts/verify_phase4.py`，在项目根目录执行 `npm test`。实际使用 bundled Python 3.12.14、SQLite 3.53.1、Flask 3.1.3、pytest 8.3.5、Ruff 0.17.6，Node v24.22.3，npm 12.2.3，Playwright 1.62.1 与本机 Edge。使用现有已配置依赖，不宣称已在干净机器验证首次安装。

| 检查 | 本次实际结果 |
| --- | --- |
| 完整后端 | 181 通过，0 失败，0 错误，0 跳过 |
| 七套浏览器 | 55 项检查全部通过 |
| 升级与进程 | 双进程恢复、v1-v3 升级、独立超时进程检查通过 |
| HTTP 负载 | 查询各档100次，20人竞争同座位仅1条生效，完整性检查通过 |
| Ruff 格式及JS语法 | 通过 |
| 根目录 npm test | 70 通过，0 失败，0 跳过 |

| 浏览器套件 | 实际检查数 | 实际浏览器版本 |
| --- | --- | --- |
| browser | 11 | 158.0.4370.45 |
| reservations-browser | 6 | 158.0.4370.45 |
| account-switch | 6 | 158.0.4370.45 |
| initialization-browser | 6 | 158.0.4370.45 |
| reservation-list-browser | 7 | 158.0.4370.45 |
| phase3-browser | 12 | 158.0.4370.45 |
| phase3-review-browser | 7 | 158.0.4370.45 |

完整结果见 [本轮证据目录](../evidence/phase4-review-fixes/full/)，专项和失败记录见 [本轮诊断目录](../evidence/phase4-review-fixes/)。历史证据的前后摘要保存在完整目录的 historical-evidence-before.json 与 historical-evidence-after.json。新性能 JSON 也位于完整目录；本轮不覆盖历史 performance.json。

## 失败与限制

保留首次根目录 npm 的69通过1失败记录，以及编码新增回归修复前6失败记录。最终结果以上表和原始报告为准，不沿用上一轮数量。无生产部署和已发布成品结论；自动化通过不代表独立复查、非作者批准或团队正式验收。本轮修复完成后仍需安排独立复查与团队实际验收，PR保持打开且不合并。
