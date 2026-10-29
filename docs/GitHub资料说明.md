# GitHub 提交资料说明

本仓库内容以当前 Study Seat 原型作业为范围。参考同学仓库以 README、静态站点和文档组织材料的方式，使用当前确认的原型内容；旧仓库在线地址不代表已发布本轮版本。

## 可提交结构

```text
README.md / index.html / .gitignore / .nojekyll
package.json / pnpm-lock.yaml
deploy/                 最终静态网页及本地依赖
prototype/              学生、管理、会话与导航的维护源文件
scripts/                生成、版本、预览和资料提取脚本
tests/                  当前业务、会话、构建及浏览器验收
modao/                  定版代码组件独立 HTML 备份
docs/                   当前设计、搭建、演示及验收说明与截图
SUBMISSION_MANIFEST.json 精简副本的源版本和文件校验清单
```

上传时将这些内容放到目标仓库根目录。是否覆盖已有远端文件、采用哪个仓库和分支，由上传时实际确认；本次没有执行推送或部署。

## 提取规则

`prepare-github.py` 采用明确名单复制当前所需内容，避免把整份开发工作区混入提交。它会排除 `.git`、运行依赖、缓存、历史版本目录、旧测试/截图、上次作业提取稿和旧调试脚本。名单见生成脚本。

```sh
python3 scripts/prepare-github.py --output /你选择的位置/StudySeat_GitHub提交资料
```

目标应为项目之外的新文件夹。脚本不会覆盖已有非空文件夹。生成后可在副本中运行 `python3 scripts/build-prototype.py` 和 `node --test tests/*.test.cjs`，证明资料能够独立维护。

## 当前文档

- [墨刀原型搭建与维护说明](墨刀原型搭建与维护说明.md)
- [原型设计说明](原型设计说明.md)
- [演示与提交说明](演示与提交说明.md)
- [同步和浏览器验收记录](墨刀同步记录.md)

旧搭建指南、旧提示词、旧博客稿和旧导入脚本已从本地当前版本删除，需要追溯时使用开发仓库 Git 历史；不把这些旧文件放回精简提交文件夹。
