# 🗓️ AniHub —— Anime · Blog · Wiki

全栈多页面网站：**Anime**（当前档期放送时间表，精确到分钟）+ **Blog**（追番笔记）+ **Wiki**（动漫知识库）+ **Tools**（工具箱）。登录后即可写作，Markdown 编辑，深浅主题按时间自动切换。

数据来源为 [AniList](https://anilist.co) 公开 GraphQL API，无需注册或 API Key。

## 功能

### 🗓️ Anime（`/anime`）

- **周历视图（默认）**：一次显示一周，7 个等宽大格子，当天所有放送**全部直接显示**（海报 + 标题 + 第 N 话 + 精确时间），不折叠不省略；今天高亮，可前后翻周（范围限制在当前档期覆盖的周内）
- **月历视图**：整月总览，不同番剧用不同颜色区分，所有条目同样完整显示，带小封面
- **列表视图**：按日期分组展示当月全部放送（海报 + 完整标题 + 时间 + 星期）
- **档期切换**：上一档 / 下一档 / 一键回到当前档期（如 2026 夏季 → 2026 春季），回到当前档期时自动跳到本周
- **语言选择**：动画名支持 中文（默认）/ 日本語 / English / 罗马音 四种显示；语言为中文时详情简介也显示中文（类型标签同步中文化），选择会记住（localStorage）
- **主题切换**：浅色 / 深色 / 自动（按时间，6:00–18:00 浅色、其余深色），右上角切换，选择会记住
- **二次元背景**：浅透明二次元美少女图垫底，**自动扫描壁纸目录随机展示**——把任意数量的图片放进 `public/wallpapers/` 即可（PNG / JPG / WebP / GIF），每次进入为下次访问随机预选一张并记住，刷新时首帧直接显示壁纸（不闪纯色背景）、访问中不换图，加载失败自动换下一张，新增图片无需任何登记；也可用环境变量 `WALLPAPER_DIR` 指向其他目录（绝对路径）。无可用图片时自动回退到档期动画的横版高清横幅图（约 1900px）
- **动漫详情**：点击任意条目弹出详情——封面、多语言标题（中文模式下只显示中文标题，不显示英日副标题）、连载状态、类型（中文模式译为中文）、集数、评分、制作公司、中文简介（未收录时回退英文），以及按日期分组的完整放送时间表
- **悬浮提示**：鼠标悬停日历标签显示完整标题 + **大封面预览**（72×102）+ 精确时间
- **当日弹层**：月历视图点击日期格弹出当天完整放送列表（大封面 + 完整标题）
- **数据缓存**：档期数据缓存 12 小时（localStorage），重复打开/切换档期不再请求 API，秒开

### 📝 博客（`/blog`）与 📚 Wiki（`/wiki`）

- 登录后即可发布、编辑、删除文章；未登录只读（个人站，不开放注册）
- **双模式编辑**：编辑页可切换 Markdown（工具栏 + 源码 + 实时预览）与 所见即所得（TipTap）两种模式，模式选择会记住；两种模式相互转换（Markdown 中的字号/颜色等行内 HTML 样式在富文本↔Markdown 切换中可保留）
- **编辑工具栏**：Markdown 与富文本模式均提供工具栏，支持对选中文本设置 加粗/斜体/下划线/删除线/标题/行内代码/代码块/引用/列表/链接/字号/颜色 等样式，并可一键清除格式
- **插图**：编辑正文时可上传本地图片（PNG / JPG / WebP / GIF，≤ 8MB），Markdown 模式自动插入图片语法、富文本模式直接插入图片；两种模式都支持 **Ctrl+V 直接粘贴剪贴板中的图片**（复制的图片 / 截图），图片存于 `server/uploads/`
- **游客隐藏（三档可见性）**：编辑页可为每篇文章选择 公开（游客可见）/ 仅内部人员（游客不可见，内部人员可读）/ 仅管理员（私有）三档；权限不足时列表不出现、详情按不存在处理（404），有权限时列表与详情会显示「仅内部可见」「仅管理员可见」标识
- **置顶公告**：登录后在博客列表可对任意文章「置顶」（全局仅一篇），置顶文章排在最前并带 📌 公告 标识，同时作为主页公告展示；再次点击「取消置顶」即可恢复
- 标题自动生成中文 URL 别名（slug），冲突自动加 `-2`
- 支持按关键词搜索标题 / 摘要 / 正文 / 标签，分页浏览
- 正文经 DOMPurify 消毒渲染，防 XSS
- 博客与 Wiki 共用一套编辑系统，`category` 区分

### 🔍 站内搜索（`/search`）

- 导航栏右侧搜索框（或直接访问 `/search`）输入关键词回车，一次搜索博客 / Wiki 文章与动漫
- **文章**：按标题 / 摘要 / 正文 / 标签匹配（复用文章搜索，按身份过滤可见性），结果按 博客 / Wiki 分组展示，置顶公告带 📌 标识
- **动漫**：在已缓存的各档期数据中按标题匹配（罗马音 / 日文 / 英文 / 中文译名），显示封面与所属档期；未访问过动漫页（无缓存）时该部分为空
- 搜索结果按当前身份过滤：游客看不到无权限的文章与动漫（与各页面可见性设置一致）

### 🧰 工具箱（`/tools`，子工具为二级页面）

- **JSON 格式化**（`/tools/json`）：粘贴标准 JSON 一键格式化（缩进美化）或压缩为单行，出错提示定位，结果可一键复制；也能识别**类 JSON 文本**并转换为 JSON——支持 `key = value`、`0x` 十六进制、嵌套 `{}` 的结构体转储（如 DPDK mbuf 调试输出）、`//`、`/* */`、`#` 注释、行尾逗号、匿名块成员提升、裸值数组块（如 `dynfield1 = { 0x0, 0x0 }`），标量值保留原样字符串避免进制/精度丢失
- **二维码解析**（`/tools/qr`）：点击选择 / 拖拽 / Ctrl+V 粘贴二维码图片，自动解析出其中的链接或文本；结果是链接时可一键打开或复制（纯前端解析，图片不会上传）
- **图片裁切**（`/tools/crop`）：上传版图（多格图 / 精灵图），拖动网格线（竖线/横线可**加减**：＋ － 按钮、拖线调整、悬停 ✕ 删除）划分格子，一键裁切成一张张小图；等分预设支持 2×2~5×5 与**自定义列×行**、透明底 PNG 输出、单张下载或打包 zip（纯前端处理，图片不会上传）

### 🏠 主页（`/`）

- 顶部显示**公告**：置顶的博客文章会展示在主页（标题 + 摘要，点击进入正文）；未设置置顶时公告自动隐藏
- 站名 + 导航卡片，点击跳转到日历 / 博客 / Wiki / 工具箱（卡片按游客可见设置自动隐藏）
- **回到顶部**：任意页面滚动超过一屏后，右下角出现圆形「回到顶部」按钮，点击平滑回到页首
- **桌宠（大肥鱼）**：网页左下角的动画小宠物（素材参考 [dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)），会眨眼/张望/思考/扫地、偶尔沿底部走动，点击触发摸头/戳/尾巴互动，按住可拖动；**默认对内部人员可见、游客不可见**，是否对游客 / 内部人员显示由 设置 → 页面访问权限 中的「桌宠」控制

### ⚙️ 设置（`/settings`，登录后）

- **页面访问权限**：按身份（游客 < 内部人员 < 管理员）配置可见页面。勾选哪些页面允许游客查看；未勾选的页面游客直接访问会被送回主页，导航栏与主页卡片同步隐藏。另可单独授权「内部人员可见页面」（游客不可见但内部人员可看），管理员不受限、全部可见
- **内部人员身份**：只读的中间身份。在页面任意位置依次敲击键盘「inside」即获取（口令见 `server/.env` 的 `INSIDER_KEYWORD`，默认 `inside`），导航栏出现「🔑 内部模式」徽标，可点 ✕ 退出；内部人员能看到游客看不到的页面与文章，但不能编辑、不能进设置页；**进入内部模式后全站页面都显示壁纸背景**（与 Anime 页共用同一套壁纸与缓存）
- **隐藏登录入口**：界面不显示任何登录按钮，在页面任意位置依次敲击键盘「login」四个字母弹出登录框（Esc 或点击遮罩关闭）；已登录右上角显示固定欢迎语 **Ciallo ～(∠・ω< )⌒★!** 以及 设置 / 退出 按钮

## 环境要求

- [Node.js](https://nodejs.org) ≥ 20.19（推荐最新 LTS 或 v24，本仓库在 Node 24 上开发验证）
- npm（随 Node.js 一起安装）

## 快速开始（开发模式，双进程）

```bash
# 1. 安装依赖
npm install

# 2. 终端 A：启动后端 API（端口 3001，--watch 自动重启）
npm run dev:server

# 3. 终端 B：启动前端开发服务器
npm run dev
```

打开终端 B 显示的地址（默认 <http://localhost:5173>）。开发模式下 Vite 会把 `/api` 请求代理到后端（见 `vite.config.js`）。

首次启动后端会自动创建 `server/anihub.db`（SQLite）并建表，同时按 `server/.env` 中的配置自动创建站点账号（不存在则新建，已存在则同步为当前密码）。

**站点账号**（个人站，不开放注册）：编辑 `server/.env` 设置 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，改完重启即生效；未设置时默认 `admin` / `anihub-dev-password`（生产环境务必修改）。

**内部人员口令**：`server/.env` 的 `INSIDER_KEYWORD`（默认 `inside`）为键盘热键口令，改完重启生效；若修改，需同步更新 `src/App.vue` 顶部的 `KEY_SEQ_INSIDE` 常量，保持一致。

## 生产部署（单端口）

```bash
# 1. 构建前端
npm run build

# 2. 启动服务（Express 同时托管 API 与 dist/ 静态文件）
npm start
```

访问 <http://localhost:3001> 即可，全部功能同一端口。

> 生产环境建议设置环境变量 `JWT_SECRET`（登录令牌签名密钥）与登录密码 `ADMIN_PASSWORD`；不设置则用默认开发值。

### 云端部署（推荐：轻量云服务器 / VPS）

本项目使用 Node 内置 `node:sqlite` 与本地磁盘（SQLite 数据库 + 上传图片），**必须运行在带持久磁盘的常驻服务器上**（轻量服务器 / VPS / 容器平台均可；纯静态托管与 Serverless 不适合，函数环境的文件系统不持久）。

`deploy/` 目录已备好全套部署文件，适用于 Ubuntu 22.04 / 24.04 的国内轻量服务器（阿里云 / 腾讯云轻量应用服务器，2C2G 即可）：

| 文件 | 作用 |
|---|---|
| `deploy/setup.sh` | 一键部署：装 Node 24 → 拉代码 → 构建 → 生成 `.env`（随机密钥）→ systemd 守护 → Nginx + HTTPS → 定时备份 |
| `deploy/anihub.service` | systemd 服务单元（开机自启、崩溃自动重启、最小权限加固） |
| `deploy/anihub.nginx.conf` | Nginx 反向代理 + Let's Encrypt HTTPS |
| `deploy/backup.sh` | 数据备份（SQLite + 上传图片，保留最近 14 份，每日 03:00） |
| `deploy/crontab.example` | 定时备份任务示例 |

快速上手（服务器上执行）：

```bash
# 方式一：脚本自动部署（从仓库拉取代码）
sudo DOMAIN=anime.example.com CERT_EMAIL=you@example.com \
  REPO_URL=https://github.com/CONSISTROL/anihub.git \
  ADMIN_USERNAME=admin ADMIN_PASSWORD=你的密码 \
  bash deploy/setup.sh

# 方式二：代码已上传到服务器（如 scp 到 /opt/anihub）后执行
sudo DOMAIN=anime.example.com CERT_EMAIL=you@example.com bash /opt/anihub/deploy/setup.sh
```

部署完成后访问 `https://你的域名`，页面敲键盘 `login` 输入管理员账号登录。日常更新代码：

```bash
cd /opt/anihub && git pull && npm ci && npm run build && sudo systemctl restart anihub
```

**安全提醒**：首次部署请务必在 `server/.env` 中设置强随机 `JWT_SECRET`（部署脚本已自动生成）、修改 `ADMIN_PASSWORD`；如需修改内部人员口令 `INSIDER_KEYWORD`，同步改 `src/App.vue` 顶部的 `KEY_SEQ_INSIDE` 后重新构建。

## 项目结构

```
├── index.html                    # 入口页面
├── package.json
├── vite.config.js                # dev proxy: /api → :3001；生产分包（editor/markdown）
├── deploy/                       # 云端部署（轻量服务器）：setup.sh / systemd / nginx / 备份
├── server/                       # Node + Express + SQLite 后端
│   ├── index.js                  # 装配：JSON → API 路由 → 静态托管 dist/ → SPA fallback
│   ├── db.js                     # node:sqlite 连接 + users/posts 建表（WAL，含 visibility / content_html / format 迁移）
│   ├── config.js                 # PORT / JWT_SECRET / INSIDER_KEYWORD（读环境变量）
│   ├── routes/auth.js            # 登录 / 内部人员口令 / 获取当前用户
│   ├── routes/posts.js           # 文章 CRUD（列表/详情/新建/编辑/删除，作者校验，md/html 双格式，三档可见性，置顶公告）
│   ├── routes/settings.js        # 站点设置（游客 / 内部人员可见页面）
│   ├── routes/upload.js          # 图片上传（PNG/JPG/WebP/GIF → server/uploads/）
│   ├── routes/wallpapers.js      # 壁纸目录扫描（GET /api/wallpapers → 图片 URL 列表）
│   ├── uploads/                  # 上传的图片（gitignore，运行时生成）
│   ├── middleware/auth.js        # JWT 鉴权：authRequired（仅管理员）/ optionalAuth（游客/内部/管理员）
│   └── lib/                      # slugify（保留中文）、validate
└── src/
    ├── main.js                   # 应用入口（挂载 router）
    ├── App.vue                   # 布局壳：NavBar + router-view
    ├── style.css                 # 全局样式与深浅主题 CSS 变量
    ├── router/index.js           # 路由表 + 登录守卫
    ├── api/
    │   ├── http.js               # fetch 封装（/api 前缀、Bearer、401 自动登出）
    │   ├── posts.js              # 文章接口（含置顶 / 公告）
    │   ├── settings.js           # 设置接口
    │   └── anilist.js            # AniList GraphQL 封装与缓存
    ├── composables/
    │   ├── useAuth.js            # 登录状态（管理员 token + 内部人员 token，localStorage 持久化）
    │   ├── useSeason.js          # 档期状态：加载数据、切档、翻月
    │   ├── useLanguage.js        # 显示语言状态（默认中文，持久化）
    │   ├── useTheme.js           # 主题状态：浅色/深色/按时间自动
    │   ├── useSettings.js        # 站点设置状态（游客/内部人员可见页面，全局单例）
    │   └── useWallpaper.js       # 壁纸管理器（Anime 页与内部模式全局背景共用）
    ├── utils/
    │   ├── date.js               # 档期映射、日历网格、时间格式化
    │   ├── titles.js             # 按语言解析标题（titleFor）
    │   └── jsonLike.js           # 类 JSON 解析（C 结构体转储 → JSON）
    ├── data/
    │   ├── zhTitles.js           # 中文标题映射表（AniList id → 译名）
    │   └── zhDescriptions.js     # 中文简介映射表
    ├── views/
    │   ├── HomeView.vue          # /           导航卡片主页（含公告）
    │   ├── CalendarView.vue      # /anime      Anime 日历
    │   ├── BlogListView.vue      # /blog       博客列表
    │   ├── BlogPostView.vue      # /blog/:slug 博客详情
    │   ├── WikiListView.vue      # /wiki       Wiki 列表
    │   ├── WikiPostView.vue      # /wiki/:slug Wiki 详情
    │   ├── EditView.vue          # 新建/编辑（博客与 Wiki 共用，Markdown/富文本双模式）
    │   ├── LoginView.vue         # 登录
    │   ├── SettingsView.vue      # /settings 设置（页面访问权限）
    │   ├── SearchView.vue        # /search 站内搜索（文章 + 动漫）
    │   ├── ToolsView.vue         # /tools 工具箱首页（子工具入口）
    │   ├── JsonToolView.vue      # /tools/json JSON 格式化（含类 JSON 解析）
    │   ├── QrToolView.vue        # /tools/qr 二维码解析
    │   └── CropToolView.vue      # /tools/crop 图片裁切（网格线切图）
    └── components/
        ├── NavBar.vue            # 全站导航栏（含登录态与内部模式徽标）
        ├── BackToTop.vue         # 一键回到顶部按钮（全站右下角）
        ├── Mascot.vue            # 桌宠（大肥鱼）：左下角动画小宠物（帧动画/互动/拖动）
        ├── MarkdownView.vue      # Markdown 渲染（marked + DOMPurify）
        ├── RichTextView.vue      # 富文本 HTML 渲染（DOMPurify）
        ├── RichTextEditor.vue    # 所见即所得编辑器（TipTap，含样式工具栏）
        ├── MdToolbar.vue         # Markdown 模式编辑工具栏
        ├── PostList.vue          # 文章列表（搜索/分页，博客/Wiki 共用；博客支持置顶公告）
        ├── PostDetail.vue        # 文章详情（作者操作，按格式渲染）
        ├── WeekView.vue          # 周历视图（默认，大格子全部显示）
        ├── Calendar.vue          # 月历视图（含悬浮提示、当日弹层）
        ├── DayPopover.vue        # 当日放送列表弹层
        ├── ListView.vue          # 列表视图（按日期分组）
        ├── AnimeBackground.vue   # 浅透明二次元美少女背景（Anime 页，含横幅回退）
        ├── InsiderBackground.vue # 内部模式全局背景（inside 模式下全站壁纸）
        ├── SeasonSwitcher.vue    # 档期切换按钮
        ├── LanguageSelector.vue  # 语言选择下拉框
        ├── ThemeSelector.vue     # 主题选择下拉框
        └── AnimeDetail.vue       # 动漫详情弹窗
```

## 工作原理

1. 按当前日期计算所在档期（冬 1–3 月 / 春 4–6 月 / 夏 7–9 月 / 秋 10–12 月）
2. 查询 AniList 获取该档期全部动画（`season` + `seasonYear`，按热度排序）
3. 再用这批动画的 ID 查询 `airingSchedules`，得到**每集**的精确放送时间（Unix 时间戳）
4. 结果按档期缓存到 localStorage（12 小时），期间重复加载/切换档期直接读缓存，不重复请求
5. 时间戳转本地时区后填入周历 / 月历网格

## 已知说明

- **中文标题与中文简介为人工维护的映射表**（AniList 不提供中文标题/简介字段）：标题见 [src/data/zhTitles.js](src/data/zhTitles.js)、简介见 [src/data/zhDescriptions.js](src/data/zhDescriptions.js)、类型标签中文翻译见 [src/data/zhGenres.js](src/data/zhGenres.js)，均完整覆盖 2026 夏季档全部正常向作品（成人向除外）；语言为中文时点开详情会优先显示中文简介，未收录的动画回退显示罗马音标题与英文简介。新增条目时在文件中按 `AniList id: '内容'` 追加即可（id 可在动画详情弹窗的 AniList 链接中查到）
- 档期内已完结 / 未开播 / 缺排期的动画不出现在日历上，会列在日历下方
- 日历数据来自浏览器直连 AniList（外网需可达）；AniList 官方故障时日历会显示错误提示，其余页面不受影响
- 后端使用 Node 内置 `node:sqlite`（Node 24+ 稳定，20/22 为实验特性）；若 Node 版本过低请升级
