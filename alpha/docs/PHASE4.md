# StudySeat Alpha 第四阶段集成记录

2026-11-28 原型界面接入的补充修复、真实浏览器验证和证据说明见[原型接入补充验收记录](PROTOTYPE-UI-COMPLETION.md)。旧工作台检查与新版页面检查分别记录，不能将旧工作台的通过数量套用于新版界面。

本轮针对 `71cabb9` 的独立审查问题修复见 [修复与完整复验记录](PHASE4-REVIEW-FIXES.md)，证据位于 `alpha/evidence/phase4-review-fixes/full/`。下文保留上一轮候选与主线集成上下文；本轮实际数量以新记录及原始报告为准。

任务 [Issue #7](https://github.com/hoangthithang880-dotcom/studyseat-prototype/issues/7)，合并请求 [PR #8](https://github.com/hoangthithang880-dotcom/studyseat-prototype/pull/8)。

初次候选基于第三阶段旧 PR #4，代码与证据提交 9e5233d，Word 博客及链接提交 6dbddb6。随后合并前检查发现，main 已通过 PR #6 合入另一版第三阶段及复查修复，故以 main 328a3b3 重新整理第四阶段。

本次保留当前 main 的全部业务模块、接口、schema v3 迁移、状态版本防护、后台超时与恢复用例。第四阶段增量为备份工具、HTTP 实测、统一验证、中文日志收集修正及交付用例。没有合并或覆盖已被主线替代的旧 PR #4。

当前验证证据在 [phase4-integration](../evidence/phase4-integration)，具体审查结论见 [合并前审查](PHASE4-MERGE-REVIEW.md)，运行见 [DELIVERY.md](DELIVERY.md)。

原 [Word 博客](StudySeat-Alpha-Phase4-Blog.docx)记录初次候选的 114 项检查和六套浏览器结果；它是初始候选的历史快照。当前主线集成结果以本次审查记录为准。未把初始候选的测试结果套用于集成版本。

该 Word 文件通过导出工具的指定文件白名单随 Alpha 资料导出；未放开其他 Word 文件。导出回归同时检查链接、文件内容和摘要、敏感文件排除与禁止覆盖。原型生成文件固定使用 UTF-8 和 LF，使 Windows 导出副本重建后的摘要保持一致。
