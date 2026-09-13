# AngleRead · 文档快读助手

纯前端（原生 ES Modules，无构建步骤）的深度阅读工具：上传文档 → 模型先猜你想从中读到什么并给出候选角度 → 你勾选后按自定义维度解读 → 结果可导出 Markdown，并支持基于已分析文档的多轮对话。

推荐角度的办法是先想清楚**这类文档为什么有人读**，再由这个动机反推读者必须知道什么。卖方分析师研报、量化交易策略报告、长篇新闻调查、财经论文四类备有现成的问题清单；没列到的题材（财报、电话会纪要、招股书、白皮书、政策报告……）由模型照同一套推理现推一份。

界面为英文；**模型产出的报告语言可在 Reading plan 页 Step 1 切换（English / 中文）**。

直接用浏览器打开 `index.html` 即可使用（建议通过本地静态服务器访问，例如 `python3 -m http.server`，以避免部分浏览器对 `file://` 加载 ES Module 的限制）。

## 工作流

**Upload → Reading plan → Results → Chat**，左侧导航栏即这条流水线的顺序：

1. **Upload**：把文档拖进来，点「Continue to reading plan」。**这一步不发任何请求**，只是进入下一页。
2. **Reading plan**：三步——Step 1 选报告语言，Step 2 点「Suggest focus angles」让模型猜候选角度并勾选（网站这时才把文档发给模型，让它判定文档类型，再按该类型的读者问题清单逐条落到这份文档上，返回的角度**按文档分组**列出），Step 3 调固定分析维度。

   猜过之后再添新文档，Step 2 的按钮会变成「Suggest focus angles for N new documents」，**只扫没扫过的那几份**——已经勾好的角度不会被清掉，也不会为重复扫描再付一次钱。想整批重来用右上角的 **Re-suggest**。
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

### 候选角度是怎么来的

猜角度的 prompt（[js/suggester.js](js/suggester.js) 的 `buildSuggestPrompt`）分四步：

1. **判定题材**。判据必须来自文档内部——结构、表格、免责声明、行文用语、引用格式、写给谁看——不许看文件名。四类常见题材（卖方研报 / 量化策略报告 / 长篇新闻调查 / 财经论文）在 prompt 里给了识别特征；**都不像时明确要求不要硬套**，用自己的话说出这是什么，交给第 2 步。
2. **想清楚这类文档为什么有人读**。模型要先用一两句话回答：什么人会打开这种文档，读完要拿去干什么——做决定、做东西、给人汇报、还是避免踩坑。四类常见题材的动机已经写在 prompt 里，例如量化策略报告是"想学会一个能判断真假、多半还要自己重建的策略"，研报是"要决定跟不跟这个投资建议"。没列到的题材就从头推。这句话会作为 `reader_goal` 返回，显示在 Reading plan 里文档摘要后面的 `Read for:`，**模型瞄没瞄准一眼就能看出来**，偏了就点 Re-suggest。
3. **由动机反推问题**。四类题材直接取现成清单（各 7 条，按通常的重要程度排好），按这份文档的实际内容重排、删掉没材料的；其他题材自己写一份。无论什么题材，最后都要过一遍五项覆盖检查——**主张**（它到底说了什么）、**机理**（怎么得出来的，细到能判断或重建）、**证据**（效果如何，用文档自己的数字）、**软肋**（压在什么假设上、什么会证伪）、**用处**（读者接下来能做什么、还差什么）。这五项是查漏用的，不是拿来当章节名的。
4. **落到这份文档上**。逐条换成文档自己的因子名、数据集、标的、公司、模型、时间区间和指标——光看标题就该知道是哪份文档；文档里没材料的直接跳过（宁可不给，也不给一条问出来是空的）。清单之外再补上这份文档独有、而上面那套推理没覆盖到的角度。

**给几条完全由模型自己定**，prompt 里既没有目标条数也没有上限，代码里也不再截断：篇幅厚、值得问的问题多，就给十几条；一页纸的短文只撑得起两条，就给两条。明写了两条禁令——不许为了显得周全拿弱角度凑数，也不许为了让列表短而砍掉读者想要的问题。

唯一的失败条件是**一条可用的都没有**——`suggestions` 缺失、不是数组、空数组、每条都没有标题，**或者整段回复根本没能解析成 JSON**（模型先讲了一通思路、或者被截断得太狠）。这几种情况 [js/suggester.js](js/suggester.js) 都会自动重问一次，第二次的 prompt 里会说明上一次为什么不可用；两次都空才报错，报错里写明是哪一环没对上。

解析失败这一路尤其要收进重试里：它恰恰是最常见的一种空手而归，如果让解析异常直接抛出去，重试就永远轮不到它。

关键是一句话：**问题可以是套路的，答案不许套路**。早期版本让模型"不要给任何能套在同类文档上的通用角度"，结果恰恰把"因子怎么构建""表现如何"这类读者最想要的问题挡在了外面。现在反过来要求：核心问题一条都别因为"太显然"而跳过，但每条角度的 `title` / `why` / `prompt` 都必须写得换一份同类文档就不成立。

同理，已启用的固定分析维度（`Core argument`、`Method`…）只是提示模型别原样重复，**不再阻止**它提出比这些维度更深、更具体的角度。

要加一类现成清单，就在 [js/suggester.js](js/suggester.js) 的 `GENRES` 里加一项：`tells`（怎么认出来）、`motive`（为什么有人读）、`questions`（读者因此想知道什么），prompt 会自动把它排进去。

### 建议角度要花多少钱

猜角度是正式分析之前**额外的一次调用**，默认只送抽样：PDF / 图片取**前 6 页 + 末 2 页**，文本取**开头 6000 字符 + 结尾 2000 字符**，几十页的研报也只多花一点点。Upload 页的「Use the full document」勾上则整份送过去，更贴合细节但成本明显更高。

抽样阶段渲染过的 PDF 页会缓存下来，正式分析直接复用，**不会重复渲染、也不会重复解析**。

## 模型 JSON 输出的容错

两道闸门：先在请求侧尽量让模型只吐 JSON，再在解析侧尽量把已经吐坏的 JSON 救回来。

请求侧（[js/llmClient.js](js/llmClient.js)）：OpenAI 兼容端点带上 `response_format: {type:'json_object'}`，Anthropic 端点改用 assistant 预填 `{` 让模型从左花括号续写——两种做法都是为了堵住「先讲一段思路、再给 JSON」这条路。自建网关不认 `response_format` 时会收到 4xx，此时自动去掉该参数重发一次，并记住这个端点，之后不再尝试。

请求侧还有一条更省事的：两份 prompt 都明写**「JSON 字符串里的反斜杠要写成 `\\alpha` 而不是 `\alpha`」**（[js/analyzer.js](js/analyzer.js) 的 `JSON_BACKSLASH_RULE`，分析与猜角度共用一份，免得改了一边忘了另一边）。请求侧少坏一次，解析侧就少救一次。

预填的 `{` 只在**正文非空**时补回去。额度全烧在 thinking 块里、正文是空的时候不能补——补出来的 `{` 会被修复器整成 `{}`，越过「模型什么都没返回」这道检查，最后渲染成一张没有任何提示的空白报告。

解析侧（[js/analyzer.js](js/analyzer.js) 的 `parseJsonLoose`）：我们要求公式写成 LaTeX，这和 JSON 天生打架，专门处理四类翻车。

解析不出**可用对象**就报错，绝不返回 `{}` / `null` / 数组顶替：那些值只会让界面渲染出一张标着 done 的空白卡片，或者在调用方 `parsed.suggestions` 处抛一个没头没脑的 TypeError——两者都比一条写清楚了原因的报错难排查得多。

四类翻车：

1. **LaTeX 反斜杠不是合法的 JSON 转义**：`$\Delta$`、`$\sum$` 会让 `JSON.parse` 直接报 *Bad escaped character*。
2. **更阴险的一类**：`\text` `\times` `\tau` `\nabla` `\beta` `\bar` `\frac` `\rho` `\right` 的首字母恰好是合法转义符，JSON **能解析成功**，只是公式被悄悄换成了制表符 / 换行 / 退格。解析前会先在 `$...$`、`$$...$$` 范围内把这些反斜杠补成字面量——限定在数学环境内，避免把散文里真正的 `\n` 换行误伤。

   规则写成**通用**的而不是一张命令清单：数学环境里 `\` 后面跟字母就当 LaTeX 命令。早先版本列了 22 个命令名，于是 `\to` `\tanh` `\nu` `\bullet` `\ne` `\big` `\rm` 这些没列到的照样被悄悄毁掉，而且**不报错**——`$w^\top x$` 直接变成 `$w^<TAB>op x$`。这种清单永远数不全，`\top` 在量化策略报告里又几乎必然出现。

   反过来，也不能把货币符号错当成公式。`$` 开头紧跟数字的（`$42.…$`）一律算金额不算公式；落单的 `$` 只有在同一段字符串里还能找到配对的 `$` 时才开数学环境。否则 “Price target $42.\n…implies $55 of upside.” 里那个**真正的换行**会被当成 `\neq` 双写掉，在界面上显示成字面的 `\n`。
3. **输出被 max_tokens 截断**：半截字符串、没闭合的数组会被逐字符扫描补齐，能救回几条角度就保留几条。服务商在 `finish_reason` / `stop_reason` 里明说截断时，这个信号会一路带到界面上，**三处都带**：分析结果卡片、Reading plan 的角度列表、Chat 的回答气泡，各自多一条黄色提示说明后面可能还有没写完的东西。救回来的半份东西照常显示，但不能让它看着像模型的完整答案。
4. **JSON 前面挂了一段自言自语**：「Let me work through the document carefully…」这类开场白之后才是正文。只认「第一个 `{`」是不够的——开场白里一个 `$\frac{a}{b}$` 就能把真正的 JSON 挡在外面，所以改成扫出所有 `{"` 位置逐个试；`<think>…</think>` 块和没闭合的 ``` 围栏也一并处理。

模型如果干脆没给出 JSON 开头（拒答、或者把输出额度全写成了大白话），错误信息会直说「narrated its reasoning instead of returning JSON」并附上原文与下一步该调哪个设置。

候选角度这一侧还多一层兜底：截断往往正好落在某条角度的 `prompt` 里，只要 `title` 还在就不整条丢掉，用 `title` 与 `why` 现编一条指令顶上（[js/suggester.js](js/suggester.js) 的 `fallbackPrompt`）。真的一条都没留下时，报错会说明是哪一环没对上——没有 `suggestions` 键、它不是数组、数组是空的，还是每条都缺标题——而不是笼统一句「no usable suggestions」。

这里有个容易写反的地方：**外层循环必须是候选切片、内层才是解析方式**。反过来的话，一份被截断的回复会被它内部某条 `suggestions` 子对象抢先严格解析成功，最外层的 `doc_type` 与整个角度列表全部丢失——「整段修一修能读」永远优于「里面某个子对象恰好合法」。

## 界面布局

控制台式布局：**左侧固定导航栏**（品牌 → Upload / Reading plan / Results / Chat → Model & API、文档链接、快捷键、当前模型连接状态）+ **右侧独立滚动的文档列**，正文宽度限制在 1024px。窄屏（≤900px）下导航栏收成抽屉，由顶栏的汉堡按钮唤出。

页面最顶部是一条**彩色提示条**，同时通过 `<meta name="theme-color">` 把浏览器地址栏染成同色（浅色 `#DCEEFB` / 深色 `#13283A`）。提示条与 Model & API 页的蓝色提示卡都可以点掉，关闭状态记在 `localStorage` 的 `angleRead.dismissedNotices`。

视觉上是暖色单色调：**全站只用一套无衬线字体**（macOS 上是系统的 SF Pro，其他平台回落到 Geist），标题、数字、标签、徽章一视同仁；等宽字体（Geist Mono）只留给真正的代码——`<code>` / `<pre>` / 快捷键 `<kbd>`。分隔线统一 1px，强调色只用低饱和的淡蓝 / 淡红 / 淡绿 / 淡黄 / 淡紫。跟随系统深浅色。

## 大模型配置（Model & API）

所有配置都保存在浏览器本机 `localStorage`，键名统一以 `angleRead.` 开头，不会上传。支持三种接口格式：

| 接口格式 | 端点 | API Key |
| --- | --- | --- |
| OpenAI 兼容 | `/v1/chat/completions` | 必填 |
| Anthropic | `/v1/messages` | 必填 |
| **Ollama 本地** | `/v1/chat/completions`（兼容层） | **不需要** |

### API URL 下拉预置

**API URL** 输入框自带下拉菜单，列出主流服务商的基地址（OpenAI、Anthropic、Google Gemini、xAI、Mistral、DeepSeek、通义千问、智谱、Kimi、阶跃、OpenRouter、SiliconFlow、Together、Groq、Ollama、LM Studio）。选中任一项会同时把**接口格式**切成对应值。

输入框仍是自由文本，清单之外的地址照常可用；输入任意关键字即可过滤。

填的是「版本号之前」的基地址，端点路径由程序自动补全。若地址本身已含版本号段（如 Gemini 的 `/v1beta/openai`、智谱的 `/api/paas/v4`，或你手滑把 `/v1` 一起粘了进来），程序会识别并**不再重复补 `/v1`**。

### 模型名称下拉预置

**模型名称**同样带下拉菜单，按服务商分组列出**以支持视觉输入的多模态模型为主**——PDF 与图片是逐页喂图给模型的，纯文本模型无法解读图表与公式截图。

纯文本模型也一并收录，条目上标注 `no vision`：它们读 Word / Markdown / 纯文本没问题，**读不了 PDF 与图片**（会返回空章节）。

DeepSeek 目前对外两个模型，一个读图一个不读，下拉里都列了：

| 模型 id | 对应模型 | 视觉 | 上下文 |
| --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek-V4.1-Flash | 支持 | 1M |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 不支持 | 1M |


当前 API 地址所属的服务商分组会自动置顶，并标注 `matches your endpoint`。同样支持手输任意模型名，或用旁边的**「Fetch models」**按钮拉取端点的真实模型列表。

### 上下文上限（Context limit）

Model & API 页的 **Context limit (tokens)** 是发送前的本地预检：估算出的输入超过它就直接报错，不会白白打一次接口。

**留空表示不设上限，交给模型自己**——适合 1M 上下文这类模型，或者你根本不想被前端拦着。留空后：

- 分析与猜角度阶段不再做超限预检，真超了由模型端返回错误
- Chat 侧栏的「Context limit」显示 `Model maximum`，占比条隐藏，也不会因为估算值过大而禁用发送按钮

填了数字则按数字来（小于 1000 会被抬到 1000）。默认值仍是 128000，想改成不限就把框清空再保存。

### 输出上限（Max output tokens）

**Context limit 管进、Max output tokens 管出**，两者互不相干。整份阅读报告是一次调用写完的：八个默认维度、加上自选角度和 `ai_suggested`，还要带公式和表格，本来就写得长。

**推理模型还要在这份额度里先想一遍。** 思考链同样计入输出，而且这类模型常常会在思考里把每个章节先草拟一稿——额度花光时正文是空的，`content` 为空、只有 `reasoning_content`，界面会直说「sent back only its chain of thought」。这是 8192 这个老默认值最典型的翻车方式。

所以默认给到 **32768**。`max_tokens` 只是上限不是目标，用不到的部分一分钱不花，对普通模型没有任何代价。端点如果不接受这么大的值，[js/llmClient.js](js/llmClient.js) 的 `postChat` 会自动修一次并把结论记在该端点上，后续请求直接照新规矩发：

| 端点的拒绝方式 | 自愈动作 |
| --- | --- |
| 报错写明上限（`at most 8192 completion tokens`） | 按报错里的数字重发 |
| 明说「太大了」但没给数字 | 对半砍（32768 → 8192 → 4096），最多修两次 |
| `max_tokens` 改名成 `max_completion_tokens` | 换参数名重发 |
| 不认 `response_format` | 去掉该参数重发 |

OpenAI 格式与 Anthropic 格式**都**走这套自愈。Anthropic 各代模型的输出上限差得很远（Claude 3.5 Sonnet 是 8192、Claude 3 Haiku 是 4096），32768 会被直接 400 拒掉，所以这条路必须和 OpenAI 一样能自己降档。

有两类报错**不会**被当成「输出额度太大」：

- **说的是输入**——`input length and max_tokens exceed context limit`、`the prompt already uses 6000 of the 128000 token context window`。这类句子里的数字是上下文窗口和提示词长度，不是这个模型的输出上限；拿它们当上限记下来，会把端点永久锁在一个荒唐的小值上，而且界面上怎么调都不起作用。
- **说的是限流**——`must be <= 4096 … on tier 20000 TPM` 里的 20000 是每分钟配额。宁可把原始报错原样抛给用户，也不猜。

改名与降额是**分开判**的：一条报错可能两件事都要求（`max_completion_tokens is too large: 32768…`），改过名之后再收到「还是太大」时，降额这一支仍然要能生效。

判定顺序上**额度先于 JSON 模式**：`Unsupported parameter: 'max_tokens'` 这类报错两边的特征都沾，先判额度才不会白发一次请求。反过来，光看见 `unsupported` 也不算 JSON 模式被拒——`Unsupported value: 'temperature'`、`Unsupported image media type`、`unsupported model` 都含这个词，误判的代价是白发一次整份文档（连页面图片一起），还会把一个其实支持 JSON 模式的端点整场记成不支持。所以优先看错误体里结构化的 `error.param`，其次才要求措辞明确点到 JSON。

输入框留空即回落到 32768；填的数小于 512 抬到 512，大于 200000 压到 200000，**夹过界的值会回填进输入框**——框里显示的就是真正会发出去的那个数。这一项同时作用于分析、猜角度和 Chat 三处调用，并随配置档案一起保存。

### 选到纯文本模型时的提醒

程序会判断当前模型是否支持视觉：**以模型清单里人工标注的 `vision: false` 为准**，清单外只认 `deepseek-v4-pro` 和 `gpt-3.5` 这两条确有把握的规则，其余一律算「拿不准」，不提示。

这里刻意不按家族名整片地猜。早先的版本写过 `mistral` / `qwen`（非 `-vl-`）/ `glm-4`（非 `4v`）/ 非 vision 的 `llama` / `gemma` / `phi` 这类规则，但这些家族后来陆续出了多模态版本，规则就成了反的——`glm-4.5v`、`llama-4-scout`、`gemma-3`、`phi-4-multimodal`、`mistral-small-3.2`、`qwen3-omni` 全被判成读不了图，于是用户会在三个地方被告知「你的 PDF 会是空的」，而实际上人家读得好好的。按名字猜家族这条路走不通：每出一代模型就得回来改一次，改慢了就是误报，而误报比不提示更糟。

确定读不了图时分两处提醒：

- **Model & API 页**：模型输入框下方出现黄色提示条，说明它能读 Word / Markdown / 纯文本，但 PDF 与图片会返回空章节。
- **Upload 页**：排队文件里含 PDF 或图片时，文件列表下方出现同样的提示，并点名有几份读不了；点 **Suggest focus angles** 或 **Start analysis** 时再弹一次 toast。

提醒只是提醒，不拦截——想照跑随时可以跑。

### 报告输出语言

**Report language** 控制模型产出的语言（English / 中文），界面语言不受影响。它会写进猜角度的 prompt、分析 prompt 与对话的 system prompt，同时决定导出 Markdown 的页眉与页码引用格式。切换后立即生效并落盘。

它排在 Reading plan 的 **Step 1**，在候选角度与固定维度之前——语言是这一页最先要定的事。

改语言只影响**之后发出的**调用，而 Step 1 排在 Step 2 前面就是为了让这件事不会出错：上传后进入 Reading plan 时什么都还没发出去，选完语言再点 **Suggest focus angles**，第一次猜角度用的就是新语言。已经猜过之后再改语言，点 **Re-suggest** 重跑即可。语言是持久化偏好，设过一次之后每次都会带上它。

Reading plan Step 3 里的 **Max pages** 同样是改即存。

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

每次点「Save configuration」时，当前这套（接口格式 + URL + Key + 模型 + 上下文上限 + 输出上限）会自动记录为一个**配置档案**，以「接口格式 + URL + 模型」去重。

- Model & API 页顶部的「**Saved profiles**」下拉框可一键切换到任意历史配置。
- 选中后点「Delete」可移除该档案。
- 关闭「记住 API Key」时，写入档案的 Key 同样会被清空，仅保留连接信息。

档案存于 `localStorage` 的 `angleRead.profiles`，点页面底部「Clear all storage」会一并清空。

> 项目原名 **ThesisReader**，本机存储的键名当时是 `thesisReader.*`。改名之后 [js/config.js](js/config.js) 会在启动时把残留的老键搬到 `angleRead.*` 再删掉，已经存好的 API 配置、分析维度与配置档案不会因为改名丢失。这段迁移只在老键存在时做一次事，确认没人再带着老键回来之后可以删掉。

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
