# ThesisReader · 文档快读助手

纯前端（原生 ES Modules，无构建步骤）的深度阅读工具：上传文档 → 模型先猜你想从中读到什么并给出候选角度 → 你勾选后按自定义维度解读 → 结果可导出 Markdown，并支持基于已分析文档的多轮对话。

不止于论文：卖方研报、量化策略报告、长篇新闻调查、技术白皮书、财报与公告都适用。

界面为英文；**模型产出的报告语言可在 Reading plan 页切换（English / 中文）**。

直接用浏览器打开 `index.html` 即可使用（建议通过本地静态服务器访问，例如 `python3 -m http.server`，以避免部分浏览器对 `file://` 加载 ES Module 的限制）。

## 工作流

**Upload → Reading plan → Results → Chat**，左侧导航栏即这条流水线的顺序：

1. **Upload**：把文档拖进来，点「Scan & suggest focus」。
2. **Reading plan**：网站把文档发给模型，让它判断这是什么类型的文档、猜你最可能想学到什么、这份文档里有哪些值得了解而粗读容易漏掉的方面，返回候选角度**按文档分组**列出，你勾选需要的；下半部分是一直沿用的固定分析维度。
3. **Results**：每份文档一张卡片，勾选的角度会作为额外章节出现（紫色标题 + `Your focus` 标记），可导出 Markdown。
4. **Chat**：基于已分析文档追问。

模型连接配置不属于这条流水线，放在左栏底部的 **Model & API** 按钮里（侧栏底部的连接状态块点开也是它）。

## 支持的文件格式

| 格式 | 处理方式 | 是否需要视觉模型 |
| --- | --- | --- |
| PDF | pdf.js 逐页渲染成图片 | 需要 |
| 图片（png / jpg / webp / gif / bmp / avif） | 直接作为一页，长边超 2000px 时等比缩小 | 需要 |
| Word `.docx` | [mammoth.js](https://github.com/mwilliamson/mammoth.js) 提取正文文本 | 不需要 |
| Markdown / txt / csv / tsv / json / log / rst | 直接读成文本 | 不需要 |

旧版二进制 `.doc`、幻灯片、表格文件会被拒绝，并提示另存为 `.docx` / PDF / CSV 后重试。

### 建议角度要花多少钱

猜角度是正式分析之前**额外的一次调用**，默认只送抽样：PDF / 图片取**前 6 页 + 末 2 页**，文本取**开头 6000 字符 + 结尾 2000 字符**，几十页的研报也只多花一点点。Upload 页的「Use the full document」勾上则整份送过去，更贴合细节但成本明显更高。

抽样阶段渲染过的 PDF 页会缓存下来，正式分析直接复用，**不会重复渲染、也不会重复解析**。

## 界面布局

控制台式布局：**左侧固定导航栏**（品牌 → Upload / Reading plan / Results / Chat → Model & API、文档链接、快捷键、当前模型连接状态）+ **右侧独立滚动的文档列**，正文宽度限制在 1024px。窄屏（≤900px）下导航栏收成抽屉，由顶栏的汉堡按钮唤出。

页面最顶部是一条**彩色提示条**，同时通过 `<meta name="theme-color">` 把浏览器地址栏染成同色（浅色 `#DCEEFB` / 深色 `#13283A`）。提示条与 Model & API 页的蓝色提示卡都可以点掉，关闭状态记在 `localStorage` 的 `thesisReader.dismissedNotices`。

视觉上是暖色单色调：**全站只用一套无衬线字体**（macOS 上是系统的 SF Pro，其他平台回落到 Geist），标题、数字、标签、徽章一视同仁；等宽字体（Geist Mono）只留给真正的代码——`<code>` / `<pre>` / 快捷键 `<kbd>`。分隔线统一 1px，强调色只用低饱和的淡蓝 / 淡红 / 淡绿 / 淡黄 / 淡紫。跟随系统深浅色。

## 大模型配置（Model & API）

所有配置都保存在浏览器本机 `localStorage`，不会上传。支持三种接口格式：

| 接口格式 | 端点 | API Key |
| --- | --- | --- |
| OpenAI 兼容 | `/v1/chat/completions` | 必填 |
| Anthropic | `/v1/messages` | 必填 |
| **Ollama 本地** | `/v1/chat/completions`（兼容层） | **不需要** |

### API URL 下拉预置

**API URL** 输入框自带下拉菜单，列出主流服务商的基地址（OpenAI、Anthropic、Google Gemini、xAI、Mistral、通义千问、智谱、Kimi、阶跃、OpenRouter、SiliconFlow、Together、Groq、Ollama、LM Studio）。选中任一项会同时把**接口格式**切成对应值。

输入框仍是自由文本，清单之外的地址照常可用；输入任意关键字即可过滤。

填的是「版本号之前」的基地址，端点路径由程序自动补全。若地址本身已含版本号段（如 Gemini 的 `/v1beta/openai`、智谱的 `/api/paas/v4`，或你手滑把 `/v1` 一起粘了进来），程序会识别并**不再重复补 `/v1`**。

### 模型名称下拉预置

**模型名称**同样带下拉菜单，按服务商分组列出**支持视觉输入的多模态模型**——PDF 与图片是逐页喂图给模型的，纯文本模型无法解读图表与公式截图。Word / Markdown / 纯文本文档走文本通道，任何模型都能读。

当前 API 地址所属的服务商分组会自动置顶，并标注 `matches your endpoint`。同样支持手输任意模型名，或用旁边的**「Fetch models」**按钮拉取端点的真实模型列表。

### 报告输出语言

Reading plan 页的 **Report language** 用于控制模型产出的语言（English / 中文），界面语言不受影响。它会写进猜角度的 prompt、分析 prompt 与对话的 system prompt，同时决定导出 Markdown 的页眉与页码引用格式。切换后立即生效并落盘。同一块里的 **Max pages** 也是改即存。

## 调用本地 Ollama 模型

1. 先在本机安装并启动 [Ollama](https://ollama.com)，拉取需要的模型，例如支持视觉的：
   ```bash
   ollama pull llama3.2-vision      # 或 qwen2.5vl / minicpm-v / llava
   ```
   > 读 PDF 与图片依赖把每页渲染成图片喂给模型，**必须选用支持视觉（多模态）的模型**；只读 Word / Markdown / 纯文本则不必。
2. 在 API URL 下拉里选 **Ollama**，URL 会填为 `http://localhost:11434`，接口格式自动切到 Ollama，**API Key 留空即可**。
3. 点**「Fetch models」**会调用 Ollama 的 `/api/tags` 列出本机已下载的模型；点击任一模型标签即可填入。

**允许浏览器访问 Ollama（重要）**：浏览器跨源请求默认会被 Ollama 拒绝。启动 Ollama 前需设置环境变量允许跨源：
```bash
OLLAMA_ORIGINS=* ollama serve
```
若用桌面版 App，请在系统环境变量里设置 `OLLAMA_ORIGINS=*` 后重启 Ollama。否则「Fetch models」与分析会报连接 / CORS 失败。

## 切换之前用过的模型配置

每次点「Save configuration」时，当前这套（接口格式 + URL + Key + 模型 + 上下文上限）会自动记录为一个**配置档案**，以「接口格式 + URL + 模型」去重。

- Model & API 页顶部的「**Saved profiles**」下拉框可一键切换到任意历史配置。
- 选中后点「Delete」可移除该档案。
- 关闭「记住 API Key」时，写入档案的 Key 同样会被清空，仅保留连接信息。

档案存于 `localStorage` 的 `thesisReader.profiles`，点页面底部「Clear all storage」会一并清空。

> 升级说明：默认分析维度已改为英文。**已经保存过自定义维度的浏览器仍会沿用旧的中文维度**，需要新默认值的话点一次「Restore defaults」。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| [index.html](index.html) | 页面骨架：彩色提示条、左侧导航栏与各视图（Upload / Reading plan / Results / Chat / Model & API） |
| [js/config.js](js/config.js) | 配置、配置档案与默认分析维度的 `localStorage` 存取；报告语言指令 |
| [js/presets.js](js/presets.js) | 主流服务商 API 地址与多模态模型的预置清单 |
| [js/llmClient.js](js/llmClient.js) | LLM 调用（OpenAI / Anthropic / Ollama）、端点解析、模型列表拉取、token 估算 |
| [js/docProcessor.js](js/docProcessor.js) | 各格式文档 → 模型可读内容块（PDF 渲染、图片缩放、docx 提取、文本读取）、抽样与渲染缓存 |
| [js/suggester.js](js/suggester.js) | 猜「读者想读什么」：判定文档类型、生成候选阅读角度 |
| [js/analyzer.js](js/analyzer.js) | 组装 prompt、并发分析、解析模型 JSON 输出 |
| [js/ui.js](js/ui.js) | 各视图渲染、事件绑定与预置下拉框 |
| [js/motion.js](js/motion.js) | 纯表现层：滚动入场编排、窄屏导航抽屉、提示条关闭与记忆（移除不影响功能） |
| [js/main.js](js/main.js) | 启动与模块装配、上传 → 建议 → 分析的流程编排 |
