# ThesisReader · 学术论文快读助手

纯前端（原生 ES Modules，无构建步骤）的论文阅读工具：上传 PDF → 调用多模态大模型按自定义维度解读 → 结果可导出 Markdown，并支持基于已分析论文的多轮对话。

直接用浏览器打开 `index.html` 即可使用（建议通过本地静态服务器访问，例如 `python3 -m http.server`，以避免部分浏览器对 `file://` 加载 ES Module 的限制）。

## 大模型配置

所有配置都保存在浏览器本机 `localStorage`，不会上传。设置页支持三种接口格式：

| 接口格式 | 端点 | API Key |
| --- | --- | --- |
| OpenAI 兼容 | `/v1/chat/completions` | 必填 |
| Anthropic | `/v1/messages` | 必填 |
| **Ollama 本地** | `/v1/chat/completions`（兼容层） | **不需要** |

## 新功能：本地 Ollama 模型 + 配置切换

### 1. 调用本地 Ollama 模型

1. 先在本机安装并启动 [Ollama](https://ollama.com)，拉取需要的模型，例如支持视觉的：
   ```bash
   ollama pull llava            # 或 llama3.2-vision 等多模态模型
   ```
   > 论文分析依赖把每页 PDF 渲染成图片喂给模型，**必须选用支持视觉（多模态）的模型**，纯文本模型无法解读图表/公式截图。
2. 在「设置」页把**接口格式**选为 `Ollama 本地`。URL 会自动填为 `http://localhost:11434`，**API Key 留空即可**。
3. 点模型名称旁的**「获取模型」**按钮，会调用 Ollama 的 `/api/tags` 列出本机已下载的模型；点击任一模型标签即可填入。
4. 保存配置后即可像云端模型一样使用。

**允许浏览器访问 Ollama（重要）**：浏览器跨源请求默认会被 Ollama 拒绝。启动 Ollama 前需设置环境变量允许跨源：
```bash
# macOS / Linux
OLLAMA_ORIGINS=* ollama serve
```
若用桌面版 App，请在系统环境变量里设置 `OLLAMA_ORIGINS=*` 后重启 Ollama。否则「获取模型」与分析会报连接/CORS 失败。

### 2. 切换之前用过的模型配置

每次点「保存配置」时，当前这套（接口格式 + URL + Key + 模型 + 上下文上限）会自动记录为一个**配置档案**，以「接口格式 + URL + 模型」去重。

- 设置页顶部的「**已保存配置**」下拉框可一键切换到任意历史配置（例如在 GPT-4o、Claude、本地 llava 之间来回切）。
- 选中后点「删除」可移除该档案。
- 关闭「记住 API Key」时，写入档案的 Key 同样会被清空，仅保留连接信息。

档案存于 `localStorage` 的 `thesisReader.profiles`，点设置页底部「清除全部存储」会一并清空。

## 代码结构

| 文件 | 职责 |
| --- | --- |
| [index.html](index.html) | 页面骨架与各视图（设置 / 上传 / 结果 / 对话） |
| [js/config.js](js/config.js) | 配置与配置档案的 `localStorage` 存取、默认分析维度 |
| [js/llmClient.js](js/llmClient.js) | LLM 调用（OpenAI / Anthropic / Ollama）、模型列表拉取、token 估算 |
| [js/pdfProcessor.js](js/pdfProcessor.js) | 用 pdf.js 把 PDF 渲染为逐页图片 |
| [js/analyzer.js](js/analyzer.js) | 组装 prompt、并发分析、解析模型 JSON 输出 |
| [js/ui.js](js/ui.js) | 各视图渲染与事件绑定 |
| [js/main.js](js/main.js) | 启动与模块装配 |
