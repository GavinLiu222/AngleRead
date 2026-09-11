# ThesisReader · 学术论文快读助手

纯前端（原生 ES Modules，无构建步骤）的论文阅读工具：上传 PDF → 调用多模态大模型按自定义维度解读 → 结果可导出 Markdown，并支持基于已分析论文的多轮对话。

界面为英文；**模型产出的报告语言可在设置页切换（English / 中文）**。

直接用浏览器打开 `index.html` 即可使用（建议通过本地静态服务器访问，例如 `python3 -m http.server`，以避免部分浏览器对 `file://` 加载 ES Module 的限制）。

## 界面布局

控制台式布局：**左侧固定导航栏**（品牌 → Upload / Results / Chat / Settings → 文档链接、快捷键、当前模型连接状态）+ **右侧独立滚动的文档列**，正文宽度限制在 1024px。窄屏（≤900px）下导航栏收成抽屉，由顶栏的汉堡按钮唤出。

页面最顶部是一条**彩色提示条**，同时通过 `<meta name="theme-color">` 把浏览器地址栏染成同色（浅色 `#DCEEFB` / 深色 `#13283A`）。提示条与设置页的蓝色提示卡都可以点掉，关闭状态记在 `localStorage` 的 `thesisReader.dismissedNotices`。

视觉上是暖色单色调：**全站只用一套无衬线字体**（macOS 上是系统的 SF Pro，其他平台回落到 Geist），标题、数字、标签、徽章一视同仁；等宽字体（Geist Mono）只留给真正的代码——`<code>` / `<pre>` / 快捷键 `<kbd>`。分隔线统一 1px，强调色只用低饱和的淡蓝 / 淡红 / 淡绿 / 淡黄 / 淡紫。跟随系统深浅色。

## 大模型配置

所有配置都保存在浏览器本机 `localStorage`，不会上传。设置页支持三种接口格式：

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

**模型名称**同样带下拉菜单，按服务商分组列出**支持视觉输入的多模态模型**——本工具把 PDF 逐页渲染成图片喂给模型，纯文本模型无法解读图表与公式截图，因此清单只收录多模态模型。

当前 API 地址所属的服务商分组会自动置顶，并标注 `matches your endpoint`。同样支持手输任意模型名，或用旁边的**「Fetch models」**按钮拉取端点的真实模型列表。

### 报告输出语言

设置页的 **Report language** 用于控制模型产出的语言（English / 中文），界面语言不受影响。它会写进分析 prompt 与对话的 system prompt，同时决定导出 Markdown 的页眉与页码引用格式。切换后立即生效并落盘，无需点「Save configuration」。

## 调用本地 Ollama 模型

1. 先在本机安装并启动 [Ollama](https://ollama.com)，拉取需要的模型，例如支持视觉的：
   ```bash
   ollama pull llama3.2-vision      # 或 qwen2.5vl / minicpm-v / llava
   ```
   > 论文分析依赖把每页 PDF 渲染成图片喂给模型，**必须选用支持视觉（多模态）的模型**。
2. 在 API URL 下拉里选 **Ollama**，URL 会填为 `http://localhost:11434`，接口格式自动切到 Ollama，**API Key 留空即可**。
3. 点**「Fetch models」**会调用 Ollama 的 `/api/tags` 列出本机已下载的模型；点击任一模型标签即可填入。

**允许浏览器访问 Ollama（重要）**：浏览器跨源请求默认会被 Ollama 拒绝。启动 Ollama 前需设置环境变量允许跨源：
```bash
OLLAMA_ORIGINS=* ollama serve
```
若用桌面版 App，请在系统环境变量里设置 `OLLAMA_ORIGINS=*` 后重启 Ollama。否则「Fetch models」与分析会报连接 / CORS 失败。

## 切换之前用过的模型配置

每次点「Save configuration」时，当前这套（接口格式 + URL + Key + 模型 + 上下文上限）会自动记录为一个**配置档案**，以「接口格式 + URL + 模型」去重。

- 设置页顶部的「**Saved profiles**」下拉框可一键切换到任意历史配置。
- 选中后点「Delete」可移除该档案。
- 关闭「记住 API Key」时，写入档案的 Key 同样会被清空，仅保留连接信息。

档案存于 `localStorage` 的 `thesisReader.profiles`，点设置页底部「Clear all storage」会一并清空。

> 升级说明：默认分析维度已改为英文。**已经保存过自定义维度的浏览器仍会沿用旧的中文维度**，需要新默认值的话点一次「Restore defaults」。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| [index.html](index.html) | 页面骨架：彩色提示条、左侧导航栏与各视图（Settings / Upload / Results / Chat） |
| [js/config.js](js/config.js) | 配置、配置档案与默认分析维度的 `localStorage` 存取；报告语言指令 |
| [js/presets.js](js/presets.js) | 主流服务商 API 地址与多模态模型的预置清单 |
| [js/llmClient.js](js/llmClient.js) | LLM 调用（OpenAI / Anthropic / Ollama）、端点解析、模型列表拉取、token 估算 |
| [js/pdfProcessor.js](js/pdfProcessor.js) | 用 pdf.js 把 PDF 渲染为逐页图片 |
| [js/analyzer.js](js/analyzer.js) | 组装 prompt、并发分析、解析模型 JSON 输出 |
| [js/ui.js](js/ui.js) | 各视图渲染、事件绑定与预置下拉框 |
| [js/motion.js](js/motion.js) | 纯表现层：滚动入场编排、窄屏导航抽屉、提示条关闭与记忆（移除不影响功能） |
| [js/main.js](js/main.js) | 启动与模块装配 |
