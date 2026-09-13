<div align="center">

# AngleRead

**先让模型想清楚你想从这份文档里读到什么，再替你读。**

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
![无需构建](https://img.shields.io/badge/build-none-black)
![浏览器直接运行](https://img.shields.io/badge/runtime-browser-black)
![本地优先](https://img.shields.io/badge/keys-local%20storage-black)

[English](README.md) · **简体中文**

</div>

---

把论文、卖方研报、策略报告或事故复盘丢进来。在动手分析之前，AngleRead 先问模型另一个问题：**什么人会打开这种文档，他读完要拿去干什么？**模型由此给出一份针对你这份文件的候选阅读角度——勾中哪几条，哪几条就会作为额外章节出现在最终的解读里。

它是一个没有构建步骤、没有服务端、不需要账号的单页应用。API Key 存在浏览器本机，文档只发往你自己配置的模型端点，不去别处。

![上传页](docs/screenshots/01-upload.png)

## 为什么要多这一步

多数「总结这份 PDF」的工具对所有文档套同一个模板。AngleRead 从读者出发：先判定手里是什么文档，用一句话说清楚为什么有人读它，再由这个动机反推出该问的问题。

四类题材备有现成的问题清单——卖方研报、量化策略报告、长篇新闻调查、财经论文。没列到的题材（财报、电话会纪要、招股书、白皮书、政策报告、事故复盘……）由模型照同一套推理现推一份。

这个判断在界面上是看得见的，瞄没瞄准一眼就知道。下图里模型把一份判成**量化交易策略报告**、另一份判成**技术白皮书**，`Read for:` 那行写明了它设想的读者是谁：

![候选阅读角度](docs/screenshots/03-plan-angles.png)

> 上面两份样例文档都是为这个演示虚构的。角度是本机 Ollama 上跑 `gemma4:e4b` 的真实输出，没有经过任何云端 API。

瞄偏了就点 **Re-suggest** 重来。给几条完全由模型自己定：内容厚、值得问的问题多就给十几条，一页纸的短文只撑得起两条就给两条。

## 开始使用

你需要一个静态文件服务器（应用用的是原生 ES Modules，多数浏览器不允许从 `file://` 加载）以及一个能用的模型。

```bash
git clone https://github.com/GavinLiu222/AngleRead.git
cd AngleRead
python3 -m http.server 4173
```

打开 <http://localhost:4173>，点左栏底部的 **Model & API** 指向一个服务商即可。任何静态托管都行——GitHub Pages、Netlify、`npx serve`、nginx。没有东西要构建，也没有依赖要装。

运行时从 CDN 加载三样东西：Geist 字体、渲染 Markdown 的 `marked` + `DOMPurify`、渲染公式的 KaTeX。`pdf.js` 与 `mammoth.js` 只在你第一次打开 PDF 或 `.docx` 时按需拉取。

## 工作流

左侧导航栏就是这条流水线的顺序。

### 1 · Upload（上传）

把文档拖进来，点 **Continue to reading plan**。**这一步不发任何请求**，按钮只是带你进入下一页。

| 格式 | 处理方式 | 是否需要视觉模型 |
| --- | --- | --- |
| PDF | `pdf.js` 逐页渲染成图片 | 需要 |
| 图片（png / jpg / webp / gif / bmp / avif） | 直接作为一页，长边超 2000px 时等比缩小 | 需要 |
| Word `.docx` | [mammoth.js](https://github.com/mwilliamson/mammoth.js) 提取正文文本 | 不需要 |
| Markdown / txt / csv / tsv / json / log / rst | 直接读成文本 | 不需要 |

旧版二进制 `.doc`、幻灯片、表格文件会被拒绝，并提示另存为 `.docx` / PDF / CSV 后重试。

### 2 · Reading plan（阅读计划）

同一页上的三步。

**Step 1 — 报告语言。** English 或中文。它控制模型**产出**的语言，界面本身始终是英文。它被刻意排在最前面，好让第一次猜角度就用上你要的语言。

![扫描之前的阅读计划页](docs/screenshots/02-plan-before-scan.png)

**Step 2 — 候选角度。**点 **Suggest focus angles**。**这才是第一个离开浏览器的请求。**结果按文档分组，每组带上判定出的题材、一段摘要，以及那行 `Read for:`。

之后再添新文档，按钮会变成 **Suggest focus angles for N new documents**——**只扫没扫过的那几份**，已经勾好的不会被清掉，也不会为重复扫描再付一次钱。

**Step 3 — 分析维度。**模型对每份文档都会产出的八个固定章节。可以改、可以停用、可以自己加，也可以一键恢复默认。还有一个可选开关，允许模型在写作时自行追加章节，在结果里标为 **AI added**。

![分析维度](docs/screenshots/04-plan-sections.png)

### 3 · Results（结果）

每份文档一张卡片。你勾选的角度作为额外章节出现，标记 **Your focus**；模型自己追加的标记 **AI added**。公式经 KaTeX 渲染，表格就渲染成表格。每张卡片都可导出 Markdown。

![结果](docs/screenshots/05-results.png)

勾中的角度和固定维度写得一样细——下面是那份事故复盘上勾中的两条：

![Your focus 章节](docs/screenshots/06-your-focus.png)

### 4 · Chat（追问）

基于已经分析过的文档继续追问，不必重新上传、也不会重新读一遍。可以勾选带上哪几份文档；「附上原始文档」是可选项，token 开销大得多。

![追问](docs/screenshots/07-chat.png)

## 配置模型

所有配置都存在浏览器本机 `localStorage`，键名统一以 `angleRead.` 开头，不会上传。

![模型配置](docs/screenshots/08-model.png)

| 接口格式 | 端点 | API Key |
| --- | --- | --- |
| OpenAI 兼容 | `/v1/chat/completions` | 必填 |
| Anthropic | `/v1/messages` | 必填 |
| Ollama 本地 | `/v1/chat/completions`（兼容层） | 不需要 |

**API URL** 自带下拉菜单，列出 OpenAI、Anthropic、Google Gemini、xAI、Mistral、DeepSeek、通义千问、智谱、Kimi、阶跃、OpenRouter、SiliconFlow、Together、Groq、Ollama、LM Studio 的基地址；选中任一项会同时把**接口格式**切成对应值。输入框仍是自由文本，清单之外的地址照常可用。填「版本号之前」的基地址即可，端点路径由程序补全；地址本身已含版本号段（Gemini 的 `/v1beta/openai`、智谱的 `/api/paas/v4`，或你手滑把 `/v1` 一起粘了进来）会被识别，不再重复补。

**模型名称**也有按服务商分组的下拉菜单，**以支持视觉输入的多模态模型为主**——PDF 与图片是逐页喂图给模型的。纯文本模型一并收录并标注 `no vision`：读 Word / Markdown / 纯文本没问题，读 PDF 与图片会返回空章节。当前端点所属的分组自动置顶。**Fetch models** 按钮可以拉取端点的真实模型列表。

确定当前模型读不了图时，Model & API 页会出现黄色提示；上传队列里含 PDF 或图片时，Upload 页也会再提示一次。**只提醒，不拦截**。

### 上下文上限与输出上限

两者互不相干：一个管进，一个管出。

**Context limit (tokens)** 是发送前的本地预检：估算出的输入超过它就直接报错，不会白白打一次接口。**留空表示不设上限**，适合 1M 上下文这类模型，或者你根本不想被前端拦着。默认 128000。

**Max output tokens** 默认 **32768**。整份阅读报告是一次调用写完的——八个维度加上自选角度，还要带公式和表格；推理模型还得先在这份额度里想一遍。额度花光时正文会直接是空的。它只是上限不是目标，用不到的部分一分钱不花。

端点如果不接受这么大的值，客户端会自动修一次，并把结论记在该端点上：

| 端点的拒绝方式 | 自愈动作 |
| --- | --- |
| 报错写明上限（`at most 8192 completion tokens`） | 按报错里的数字重发 |
| 明说「太大了」但没给数字 | 对半砍（32768 → 8192 → 4096），最多修两次 |
| `max_tokens` 需改名成 `max_completion_tokens` | 换参数名重发 |
| 不认 `response_format` | 去掉该参数重发 |

说的是**输入**窗口或**限流**的报错，刻意不当成「输出额度太大」——那些句子里的数字是上下文窗口和每分钟配额，拿它们当上限记下来会把端点永久锁在一个荒唐的小值上。

### 配置档案

每次点 **Save configuration**，当前这套（接口格式 + URL + Key + 模型 + 上下文上限 + 输出上限）都会记为一个**配置档案**，以「接口格式 + URL + 模型」去重。页面顶部的 **Saved profiles** 下拉框可一键切回任意历史配置。关闭「记住 API Key」时，写入档案的 Key 同样会被清空。

## 调用本机 Ollama

```bash
ollama pull llama3.2-vision      # 或 qwen2.5vl / minicpm-v / llava
```

读 PDF 与图片依赖把每页渲染成图片喂给模型，**这两类必须选支持视觉（多模态）的模型**；只读 Word / Markdown / 纯文本则不必。

在 API URL 下拉里选 **Ollama**，URL 会填为 `http://localhost:11434`，接口格式自动切换，API Key 留空即可。**Fetch models** 会调用 Ollama 的 `/api/tags` 列出本机已下载的模型。

**允许浏览器访问 Ollama（重要）**：浏览器跨源请求默认会被 Ollama 拒绝，启动时需要：

```bash
OLLAMA_ORIGINS=* ollama serve
```

若用桌面版 App，请在系统环境变量里设置 `OLLAMA_ORIGINS=*` 后重启 Ollama。否则 **Fetch models** 与分析都会报连接 / CORS 失败。

## 猜角度要花多少钱

猜角度是正式分析之前**额外的一次调用**，默认只送抽样：PDF / 图片取**前 6 页 + 末 2 页**，文本取**开头 6000 字符 + 结尾 2000 字符**。几十页的研报也只多花一点点。Upload 页的 **Use the full document** 勾上则整份送过去，更贴合细节但成本明显更高。

抽样阶段渲染过的 PDF 页会缓存下来给正式分析复用，**不会重复渲染、也不会重复解析**。

## 容错说明

我们要求模型返回 JSON，而阅读报告里满是 LaTeX——这两件事天生打架。请求侧尽量让模型只吐 JSON（OpenAI 兼容端点带 `response_format: json_object`，Anthropic 端点用 assistant 预填 `{`），解析侧则在 [js/analyzer.js](js/analyzer.js) 里尽量把已经吐坏的 JSON 救回来：

- LaTeX 反斜杠不是合法 JSON 转义；更阴险的是那些**恰好合法**的（`\text`、`\times`、`\tau`、`\top`……），JSON 能解析成功，公式却被悄悄换成制表符或换行。规则写成通用的——数学环境里 `\` 后面跟字母就当 LaTeX 命令——因为任何固定的命令清单早晚都会漏。货币金额不会被错当成公式。
- 被 `max_tokens` 截断：半截字符串、没闭合的数组逐字符补齐，能救回多少留多少。服务商明说截断时，黄色提示会一路带到**三处**——结果卡片、角度列表、对话气泡。
- JSON 前面挂的自言自语（`Let me work through the document carefully…`）、`<think>` 块、没闭合的代码围栏。

一次也没拿到可用结果会自动重问一次，第二次的 prompt 里会说明上一次为什么不可用。两次都失败时，报错会写明是哪一环没对上，而不是把一张空白卡片当成成功。

## 界面

控制台式布局：**左侧固定导航栏**（品牌 → Upload / Reading plan / Results / Chat → Model & API、文档链接、快捷键、当前连接状态）+ **右侧独立滚动的文档列**，正文宽度限制在 1024px。窄屏（≤900px）下导航栏收成抽屉，由汉堡按钮唤出。

**全站只用一套无衬线字体**（macOS 上是系统 SF Pro，其他平台回落到 Geist）；等宽字体只留给真正的代码与快捷键 `<kbd>`。强调色只用低饱和的淡蓝 / 淡红 / 淡绿 / 淡黄 / 淡紫。跟随系统深浅色。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| [index.html](index.html) | 页面骨架：提示条、左侧导航栏与五个视图 |
| [js/config.js](js/config.js) | 配置、配置档案与默认分析维度的 `localStorage` 存取；报告语言指令 |
| [js/presets.js](js/presets.js) | 主流服务商 API 地址与多模态模型的预置清单 |
| [js/llmClient.js](js/llmClient.js) | 模型调用（OpenAI / Anthropic / Ollama）、端点解析、模型列表拉取、token 估算 |
| [js/docProcessor.js](js/docProcessor.js) | 各格式文档 → 模型可读内容块：PDF 渲染、图片缩放、docx 提取、抽样与渲染缓存 |
| [js/suggester.js](js/suggester.js) | 判定文档题材、生成候选阅读角度 |
| [js/analyzer.js](js/analyzer.js) | 组装 prompt、并发分析、解析模型 JSON 输出 |
| [js/ui.js](js/ui.js) | 各视图渲染、事件绑定与预置下拉框 |
| [js/motion.js](js/motion.js) | 纯表现层：滚动入场、窄屏抽屉、提示条关闭与记忆 |
| [js/main.js](js/main.js) | 启动与模块装配，上传 → 建议 → 分析的流程编排 |

要加一类现成的问题清单，就在 [js/suggester.js](js/suggester.js) 的 `GENRES` 里加一项：`tells`（怎么认出来）、`motive`（为什么有人读）、`questions`（读者因此想知道什么），prompt 会自动把它排进去。

## 许可证

[MIT](LICENSE)
