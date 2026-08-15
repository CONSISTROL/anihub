# 🗓️ AniHub —— Anime · Blog · Wiki

全栈多页面网站：**Anime**（当前档期放送时间表，精确到分钟）+ **Blog**（追番笔记）+ **Wiki**（动漫知识库）。站长账号登录后即可写作，Markdown 编辑，深浅主题按时间自动切换。

数据来源为 [AniList](https://anilist.co) 公开 GraphQL API，无需注册或 API Key。

## 功能

### 🗓️ Anime（`/anime`）

- **周历视图（默认）**：一次显示一周，7 个等宽大格子，当天所有放送**全部直接显示**（海报 + 标题 + 第 N 话 + 精确时间），不折叠不省略；今天高亮，可前后翻周（范围限制在当前档期覆盖的周内）
- **月历视图**：整月总览，不同番剧用不同颜色区分，所有条目同样完整显示，带小封面
- **列表视图**：按日期分组展示当月全部放送（海报 + 完整标题 + 时间 + 星期）
- **档期切换**：上一档 / 下一档 / 一键回到当前档期（如 2026 夏季 → 2026 春季），回到当前档期时自动跳到本周
- **语言选择**：动画名支持 中文（默认）/ 日本語 / English / 罗马音 四种显示；语言为中文时详情简介也显示中文，选择会记住（localStorage）
- **主题切换**：浅色 / 深色 / 自动（按时间，6:00–18:00 浅色、其余深色），右上角切换，选择会记住
- **二次元背景**：浅透明二次元美少女图垫底（每次进入随机选一张 `public/` 下的壁纸，默认内置 bg1/bg2，可在 [AnimeBackground.vue](src/components/AnimeBackground.vue) 的 `LOCAL_WALLPAPERS` 数组里登记更多；无本地图时自动回退到档期动画的横版高清横幅图约 1900px）
- **动漫详情**：点击任意条目弹出详情——封面、多语言标题、连载状态、类型、集数、评分、制作公司、简介，以及按日期分组的完整放送时间表
- **悬浮提示**：鼠标悬停日历标签显示完整标题 + **大封面预览**（72×102）+ 精确时间
- **当日弹层**：月历视图点击日期格弹出当天完整放送列表（大封面 + 完整标题）
- **数据缓存**：档期数据缓存 12 小时（localStorage），重复打开/切换档期不再请求 API，秒开

### 📝 博客（`/blog`）与 📚 Wiki（`/wiki`）

- 站长账号登录后即可发布、编辑、删除文章；未登录只读（个人站，不开放注册）
- Markdown 写作（标题、加粗、链接、代码块等），实时预览
- 标题自动生成中文 URL 别名（slug），冲突自动加 `-2`
- 支持按关键词搜索标题 / 摘要 / 正文 / 标签，分页浏览
- 正文经 DOMPurify 消毒渲染，防 XSS
- 博客与 Wiki 共用一套编辑系统，`category` 区分

### 🏠 主页（`/`）

- 站名 + 三张导航卡片，点击跳转到日历 / 博客 / Wiki
- **隐藏登录入口**：界面不显示任何登录按钮，未登录时点击站点 logo「AniHub」进入登录页；已登录显示欢迎语与退出按钮

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

首次启动后端会自动创建 `server/anihub.db`（SQLite）并建表，同时按 `server/.env` 中的配置自动创建站长账号（不存在则新建，已存在则同步为当前密码）。

**站长账号**（个人站，不开放注册）：编辑 `server/.env` 设置 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，改完重启即生效；未设置时默认 `admin` / `anihub-dev-password`（生产环境务必修改）。

## 生产部署（单端口）

```bash
# 1. 构建前端
npm run build

# 2. 启动服务（Express 同时托管 API 与 dist/ 静态文件）
npm start
```

访问 <http://localhost:3001> 即可，全部功能同一端口。

> 生产环境建议设置环境变量 `JWT_SECRET`（登录令牌签名密钥）与站长密码 `ADMIN_PASSWORD`；不设置则用默认开发值。

## 项目结构

```
├── index.html                    # 入口页面
├── package.json
├── vite.config.js                # dev proxy: /api → :3001
├── server/                       # Node + Express + SQLite 后端
│   ├── index.js                  # 装配：JSON → API 路由 → 静态托管 dist/ → SPA fallback
│   ├── db.js                     # node:sqlite 连接 + users/posts 建表（WAL）
│   ├── config.js                 # PORT / JWT_SECRET（读环境变量）
│   ├── routes/auth.js            # 登录 / 获取当前用户
│   ├── routes/posts.js           # 文章 CRUD（列表/详情/新建/编辑/删除，作者校验）
│   ├── middleware/auth.js        # JWT 鉴权：authRequired / optionalAuth
│   └── lib/                      # slugify（保留中文）、validate
└── src/
    ├── main.js                   # 应用入口（挂载 router）
    ├── App.vue                   # 布局壳：NavBar + router-view
    ├── style.css                 # 全局样式与深浅主题 CSS 变量
    ├── router/index.js           # 路由表 + 登录守卫
    ├── api/
    │   ├── http.js               # fetch 封装（/api 前缀、Bearer、401 自动登出）
    │   ├── posts.js              # 文章接口
    │   └── anilist.js            # AniList GraphQL 封装与缓存
    ├── composables/
    │   ├── useAuth.js            # 登录状态（token + 用户，localStorage 持久化）
    │   ├── useSeason.js          # 档期状态：加载数据、切档、翻月
    │   ├── useLanguage.js        # 显示语言状态（默认中文，持久化）
    │   └── useTheme.js           # 主题状态：浅色/深色/按时间自动
    ├── utils/
    │   ├── date.js               # 档期映射、日历网格、时间格式化
    │   └── titles.js             # 按语言解析标题（titleFor）
    ├── data/
    │   ├── zhTitles.js           # 中文标题映射表（AniList id → 译名）
    │   └── zhDescriptions.js     # 中文简介映射表
    ├── views/
    │   ├── HomeView.vue          # /           导航卡片主页
    │   ├── CalendarView.vue      # /anime      Anime 日历
    │   ├── BlogListView.vue      # /blog       博客列表
    │   ├── BlogPostView.vue      # /blog/:slug 博客详情
    │   ├── WikiListView.vue      # /wiki       Wiki 列表
    │   ├── WikiPostView.vue      # /wiki/:slug Wiki 详情
    │   ├── EditView.vue          # 新建/编辑（博客与 Wiki 共用）
    │   └── LoginView.vue         # 站长登录
    └── components/
        ├── NavBar.vue            # 全站导航栏（含登录态）
        ├── MarkdownView.vue      # Markdown 渲染（marked + DOMPurify）
        ├── PostList.vue          # 文章列表（搜索/分页，博客/Wiki 共用）
        ├── PostDetail.vue        # 文章详情（作者操作）
        ├── WeekView.vue          # 周历视图（默认，大格子全部显示）
        ├── Calendar.vue          # 月历视图（含悬浮提示、当日弹层）
        ├── DayPopover.vue        # 当日放送列表弹层
        ├── ListView.vue          # 列表视图（按日期分组）
        ├── AnimeBackground.vue   # 浅透明二次元美少女背景
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

- **中文标题与中文简介为人工维护的映射表**（AniList 不提供中文标题/简介字段）：标题见 [src/data/zhTitles.js](src/data/zhTitles.js)、简介见 [src/data/zhDescriptions.js](src/data/zhDescriptions.js)，均覆盖 2026 夏季档大部分条目；语言为中文时点开详情会优先显示中文简介，未收录的动画回退显示罗马音标题与英文简介。新增条目时在文件中按 `AniList id: '内容'` 追加即可（id 可在动画详情弹窗的 AniList 链接中查到）
- 档期内已完结 / 未开播 / 缺排期的动画不出现在日历上，会列在日历下方
- 日历数据来自浏览器直连 AniList（外网需可达）；AniList 官方故障时日历会显示错误提示，其余页面不受影响
- 后端使用 Node 内置 `node:sqlite`（Node 24+ 稳定，20/22 为实验特性）；若 Node 版本过低请升级
