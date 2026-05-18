# Notion Backup

![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

语言：[English](README.md) | 简体中文

Notion Backup 是一个自托管的 Notion 备份面板，用于选择页面和数据源，执行手动或定时备份，把备份元数据保存在本地 SQLite 中，并把备份内容恢复为新的 Notion 页面/数据源。

产品界面以中文为主。运行时是一个单体 Fastify 服务：它负责托管 React 面板、提供 API、运行备份 Worker，并把备份产物写入本地磁盘或 Docker 挂载目录。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [前置要求](#前置要求)
- [使用 Docker 快速启动](#使用-docker-快速启动)
- [已发布 Docker 镜像](#已发布-docker-镜像)
- [本地开发](#本地开发)
- [Notion 配置](#notion-配置)
- [环境变量](#环境变量)
- [备份数据](#备份数据)
- [恢复流程](#恢复流程)
- [恢复限制和后续工作](#恢复限制和后续工作)
- [可用脚本](#可用脚本)
- [项目结构](#项目结构)
- [质量检查](#质量检查)
- [安全说明](#安全说明)
- [许可证](#许可证)

## 功能特性

- 首次运行设置流程：创建初始管理员、确认加密密钥、配置 Notion token，并可选择创建第一个备份计划。
- 单管理员登录，使用密码哈希和 HTTP-only Cookie 会话。
- Notion token 校验、脱敏展示和本地加密存储。
- 通过 Notion 搜索自动发现内容，也支持通过 URL 或 ID 手动添加页面/数据源。
- 备份计划支持手动执行、每小时/每天/每周/每月定时、自定义 cron 表达式和时区。
- 备份选项支持子页面、评论、Notion 文件下载、外链文件镜像和单文件大小限制。
- 运行队列支持进度轮询、取消、历史筛选、manifest 下载和 zip 归档下载。
- 恢复流程支持预检、恢复任务入队、进度轮询、取消、恢复历史和恢复报告。
- 基于 JSON 产物恢复为新的 Notion 内容，支持页面、常见区块、子页面、数据源、条目页面、支持的属性和已下载文件资产。
- 支持可选的评论恢复和数据源视图恢复，均为 best-effort 行为。
- 使用本地 SQLite 元数据和文件系统产物，适合轻量自托管。

## 技术栈

- **运行时：** Node.js、TypeScript、Fastify
- **前端：** React、Vite、lucide-react
- **存储：** better-sqlite3、SQLite、本地文件系统产物
- **校验：** Zod
- **定时：** cron-parser
- **Notion：** `@notionhq/client`，API 版本为 `2026-03-11`
- **测试：** Vitest
- **部署：** Docker、Docker Compose

## 前置要求

选择一种运行方式：

- Docker Engine 和 Docker Compose
- Node.js 24.x 与 npm，用于本地开发

你还需要一个以 `ntn_` 开头的 Notion 内部集成 token，并且需要在 Notion 中把目标页面或数据源分享给该集成。

## 使用 Docker 快速启动

```bash
cp .env.example .env
docker compose up -d
```

打开 `http://localhost:3000` 并完成初始化流程：

1. 创建第一个管理员账号。
2. 如果没有配置 `APP_ENCRYPTION_KEY`，妥善保存系统生成的加密密钥。
3. 粘贴并校验 Notion 集成 token。
4. 创建备份计划，或跳过进入面板。

停止容器：

```bash
docker compose down
```

Compose 配置会把宿主机的 `./data` 挂载到容器内的 `/data`，应用数据会直接保存在本地 `data/` 目录下。

## 已发布 Docker 镜像

GitHub Actions 会通过 `.github/workflows/docker-publish.yml` 把 Docker 镜像发布到 GitHub Container Registry。

- 指向 `main` 的 pull request 会运行质量检查并构建 Docker 镜像，但不会推送镜像。
- 推送到 `main` 会发布 `ghcr.io/ppqy/notion-backup:main` 和 `sha-<short-sha>`。
- 匹配 `v*.*.*` 的 Git tag 会发布 tag 名称、语义化版本标签、`latest` 和 `sha-<short-sha>`。
- 已发布镜像支持 `linux/amd64` 和 `linux/arm64`。
- 也可以在 GitHub Actions 页面手动触发 workflow。

默认 Compose 文件会先使用 `main` 这个滚动镜像，等发布 tag 可用后再切换到版本标签或 `latest`：

```yaml
services:
  notion-backup:
    image: ghcr.io/ppqy/notion-backup:main
```

如果 GHCR package 仍然是私有的，拉取前需要先登录：

```bash
echo "<github-token>" | docker login ghcr.io -u ppqy --password-stdin
```

## 本地开发

安装依赖：

```bash
npm install
```

运行后端 API 和备份 Worker：

```bash
npm run dev
```

另开一个终端运行 Vite 开发服务器：

```bash
npm run dev:client
```

打开 `http://localhost:5173`。Vite 会把 `/api` 和 `/healthz` 代理到 `http://localhost:3000` 的后端服务。

本地开发默认使用：

- `DATA_DIR=./data`
- `DATABASE_PATH=./data/app.db`
- `BACKUP_ROOT=./data/backups`

Node 开发命令不会自动加载 `.env`；如需覆盖默认值，请在 shell 中导出对应环境变量。

## Notion 配置

1. 在 Notion 工作区创建一个内部集成。
2. 复制集成 token。应用会校验 token 是否以 `ntn_` 开头。
3. 在 Notion 中把目标页面或数据源分享给该集成。
4. 在初始化流程或 **Notion 设置** 中粘贴 token。
5. 刷新可备份内容；如果搜索没有发现目标，也可以手动添加 Notion URL 或 ID。

只有该集成有权限访问的内容才能被备份。

备份评论需要该集成具备 **Read comments** 能力；恢复已备份评论还需要 **Insert comments** 能力。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | 应用内默认为 `development`，`.env.example` 为 `production` | 运行环境。 |
| `HOST` | `0.0.0.0` | Fastify 服务监听地址。 |
| `PORT` | `3000` | HTTP 端口。Docker Compose 会把宿主机的 `${PORT:-3000}` 映射到容器内 `3000`。 |
| `DATA_DIR` | 本地为 `./data`，Docker 中为 `/data` | 持久化应用数据根目录。 |
| `DATABASE_PATH` | `${DATA_DIR}/app.db` | SQLite 数据库路径。 |
| `BACKUP_ROOT` | `${DATA_DIR}/backups` | 备份产物根目录。 |
| `APP_ENCRYPTION_KEY` | 未设置 | 用于加密 Notion token 的稳定密钥。支持 64 个字符的十六进制、base64 或普通口令。 |
| `SESSION_COOKIE_NAME` | `notion_backup_session` | 管理员会话 Cookie 名称。 |
| `SESSION_SECURE` | `false` | 通过 HTTPS 提供服务时应设置为 `true`。 |

## 备份数据

Docker Compose 会把这些文件存放在宿主机的 `./data` 目录，并挂载到容器内的 `/data`。本地开发默认使用相同结构的 `./data` 目录。

```text
data/
|-- app.db
|-- app-secret.json
`-- backups/
    `-- runs/
        `-- <run-key>/
            |-- manifest.json
            |-- logs.jsonl
            |-- pages/
            |-- data-sources/
            |-- markdown/
            |-- assets/
            `-- archive.zip        # 首次下载 zip 时创建
```

每次运行都会为选中的页面和数据源写入 JSON 产物。启用并且 Notion API 可用时，会同时采集 Markdown 和评论。文件资产会根据备份计划中的选项和大小限制下载。

数据源备份也可以包含 `data-sources/<data-source-id>/views.json` 视图产物。恢复任务会在源备份运行目录下写入报告，包括 `restore-latest.json` 和 `restores/<restore-id>/restore-manifest.json`。

## 恢复流程

恢复是 best-effort 的重建流程。它会在目标父页面下创建新的 Notion 内容；不会覆盖、移动、删除或回滚原来的 Notion 内容。

用户流程：

1. 在 **历史** 中打开一个已完成或部分失败的备份运行。
2. 输入目标 Notion 父页面 URL 或 ID。
3. 按需启用评论恢复和数据源视图恢复。
4. 先运行预检，验证目标父页面、备份 manifest、产物和预期警告。
5. 确认后创建恢复任务。HTTP 请求会立即返回，后台 Worker 继续执行。
6. 在顶层 **恢复** 页面查看进度、取消任务和最终报告。

已实现的恢复范围：

- 从 canonical 的 `pages/*.json` 产物恢复页面和常见区块树；如果子页面产物存在，也会递归恢复子页面。
- 把数据源恢复为新的 Notion database/data source 内容，包括支持的 schema 字段和条目页面。
- 恢复支持的页面属性，例如 title、rich text、number、checkbox、select、multi-select、status、date、URL、email、phone number、place、files，以及能映射到新页面的 relation。
- 对已下载的 Notion 托管/本地媒体和文件属性，使用 Notion 单文件上传恢复；前提是存在匹配的资产文件且文件不超过 20 MiB。
- 外部媒体/文件 URL 会继续作为 external 引用保留，除非后续实现显式的外链导入模式。
- 显式勾选后，可把已备份评论恢复到能映射的新页面/区块上。
- 显式勾选后，可在 manifest 声明支持视图且 `views.json` 可读取时恢复数据源视图。
- 恢复 manifest/report 会记录 old-to-new 映射、创建数量、逐项结果、警告、错误和本次选择的恢复选项。

## 恢复限制和后续工作

恢复无法保留原始 Notion 对象 ID、原始 Notion URL、编辑历史、权限、分享规则、作者身份或时间戳。Notion 会为重建内容分配新的 ID。

当前已知缺口：

- 外链导入模式尚未实现。外部 URL 只会作为 external 引用保留，不会被抓取并上传成 Notion 托管文件。
- multipart 文件上传尚未实现。超过 20 MiB 的已备份文件会跳过并记录警告。
- 文件型页面图标/封面、数据源名称行图标和视图图标尚未恢复。
- relation 修复策略仍是 `mapped_only`：只有同一次恢复任务中已恢复并存在 old-to-new 映射的相关页面，才能写回关系。
- 不支持或只读/计算型属性会跳过或降级并记录警告，例如 formula、rollup、部分 relation schema、verification、created/edited metadata，以及不支持的区块类型。
- 评论作者、时间戳、resolved 状态、精确讨论历史和评论附件不会保留。
- 当前自动化测试覆盖转换、校验、仓储、报告和 Worker 行为；真实 Notion 工作区的端到端集成测试仍是后续加固项。

## 可用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 使用 `tsx watch` 启动 Fastify 后端和备份 Worker。 |
| `npm run dev:client` | 在 `5173` 端口启动 Vite 开发服务器。 |
| `npm run build` | 构建服务端和前端到 `dist/`。 |
| `npm start` | 从 `dist/server/index.js` 启动生产服务。 |
| `npm run typecheck` | 执行 TypeScript 类型检查。 |
| `npm run lint` | TypeScript 类型检查的别名。 |
| `npm test` | 运行 Vitest 单元测试。 |

## 项目结构

```text
src/
|-- client/
|   |-- api.ts          # 类型化 API 帮助函数
|   |-- main.tsx        # React 应用、页面、初始化流程和面板视图
|   `-- styles.css      # 全局样式
|-- server/
|   |-- index.ts        # Fastify 启动、静态前端托管、Worker 生命周期
|   |-- routes.ts       # HTTP 路由
|   |-- db.ts           # SQLite 连接和迁移
|   |-- auth.ts         # 管理员认证和会话
|   |-- crypto.ts       # 加密、密码哈希、会话 token 哈希
|   |-- notionClient.ts # Notion API 封装、节流和重试
|   |-- backupWorker.ts # 队列处理和备份执行
|   `-- repositories/   # SQLite 映射模块
`-- shared/
    |-- constants.ts
    `-- types.ts        # 前后端共享 DTO
```

## 质量检查

发布构建或打开 PR 前建议运行：

```bash
npm run lint
npm run build
npm test
```

健康检查端点：

```text
GET /healthz
```

它会检查数据库连接，并返回当前服务器时间。

## 安全说明

- 请把 `APP_ENCRYPTION_KEY` 或 `data/app-secret.json` 与数据库备份一起保管。加密密钥丢失后，已存储的 Notion token 无法解密，需要重新输入。
- 请保护 `./data` 目录，或你自定义 bind mount 到 `/data` 的宿主机路径。它包含 SQLite 数据库、加密 token、运行元数据和备份产物。
- 通过 HTTPS 提供服务时，请设置 `SESSION_SECURE=true`。
- 本应用面向自托管单管理员场景。暴露到可信网络之外前，请放在你自己的反向代理、VPN 或访问控制之后。
- 备份范围仅限配置的 Notion 集成可访问的内容；它不是完整的工作区导出工具。

## 许可证

当前仓库未包含许可证文件。
