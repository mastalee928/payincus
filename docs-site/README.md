# PayIncus 文档站

这是 PayIncus 的 VitePress 双语文档站源码，发布地址为 `https://mastalee928.github.io/payincus/`。

- 中文默认路径：`/payincus/`
- 英文路径：`/payincus/en/`

## 本地运行

```bash
cd docs-site
pnpm install
pnpm dev
```

或从仓库根目录运行：

```bash
pnpm docs:install
pnpm docs:dev
```

## 构建

```bash
pnpm build
```

构建前会自动从 Git tag 和 commit 生成中英文系统版本更新日志：

```text
docs/release/version-log.md
docs/en/release/version-log.md
```

输出目录：

```text
docs/.vitepress/dist
```

## GitHub Pages

文档站通过 GitHub Actions 发布到 GitHub Pages：

```text
.github/workflows/docs-pages.yml
```

仓库 Pages 使用 GitHub Actions 部署，基路径为 `/payincus/`；不使用上游自定义域名或 CNAME。

GitHub 仓库需要在 `Settings -> Pages` 中选择 GitHub Actions 作为发布源，Custom domain 保持为空。

文档站保持为独立 package，不纳入主业务 workspace，避免影响主项目 `pnpm install --frozen-lockfile` 和生产构建。只有执行 `pnpm docs:build` 或 GitHub Pages workflow 时才会生成文档站静态产物。
