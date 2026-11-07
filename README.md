# Signal Daily · 信号日报

个人使用的科技 / 金融 / AI 资讯站。每天自动抓取公开 RSS，去重、聚类、生成中文摘要，构建成静态站点发布到 GitHub Pages。

- 站点：<https://178124151.github.io/news-for-days/>
- 技术栈：Astro 5 + Tailwind 4 + TypeScript + Pagefind
- 内容：`content/articles/<年>/<月>/<id>.json`，日报索引在 `content/digests/`
- 采集：`content/sources.json`（20 个公开源），源健康记录在 `data/health/`

## 本地开发

```bash
npm ci
npm run pipeline   # 采集 + 去重 + 摘要（可选，已有内容可跳过）
npm run build      # 校验 + Astro 构建 + Pagefind 索引
npm run preview    # 预览 dist，站点路径 /news-for-days/
```

## 自动发布

`.github/workflows/daily.yml`：

- 每天 22:30 UTC（06:30 CST）采集、构建并部署到 GitHub Pages
- 推送 `main` 时只重新构建，不重新采集
- AI 免费接口不可用时跳过采集，继续发布上一版内容

可选 Secrets（缺省时自动降级为免费机翻 / 抽取式摘要）：

| Secret | 用途 |
| --- | --- |
| `NVIDIA_API_KEY` | NVIDIA NIM（主，`nemotron-3.5-lightning-30b-a3b`） |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | Cloudflare Workers AI |
| `OPENROUTER_API_KEY` | OpenRouter |

AI 加工按 `NVIDIA NIM → Cloudflare → OpenRouter → 免费机翻 → 抽取式` 顺序降级，任一环节可用即产出「AI 摘要」。

## 说明

内容版权归原作者与来源媒体所有，本站只提供标题、短摘要与原文链接，不转载全文、不镜像图片。摘要由程序自动生成，可能存在错误，请以原文为准。详见站点「关于」「免责声明」「隐私说明」页。
