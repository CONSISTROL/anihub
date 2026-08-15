# 🗓️ 动漫日历

获取当前档期的动画，在日历上显示每部番剧的更新时间（按集精确到分钟）。

数据来源为 [AniList](https://anilist.co) 公开 GraphQL API，无需注册或 API Key。

## 功能

- **周历视图（默认）**：一次显示一周，7 个大格子，当天所有放送**全部直接显示**（海报 + 标题 + 第 N 话 + 精确时间），不折叠不省略；今天高亮，可前后翻周（范围限制在当前档期覆盖的周内）
- **月历视图**：整月总览，不同番剧用不同颜色区分，所有条目同样完整显示，带小封面
- **列表视图**：按日期分组展示当月全部放送（海报 + 完整标题 + 时间 + 星期）
- **三种视图**：左上角「周历 / 月历 / 列表」随时切换
- **档期切换**：上一档 / 下一档 / 一键回到当前档期（如 2026 夏季 → 2026 春季），回到当前档期时自动跳到本周
- **语言选择**：动画名支持 中文（默认）/ 日本語 / English / 罗马音 四种显示，选择会记住（localStorage）
- **主题切换**：浅色 / 深色 / 自动（按时间，6:00–18:00 浅色、其余深色），右上角切换，选择会记住
- **二次元背景**：浅透明二次元美少女图垫底（每次进入随机选一张 `public/` 下的壁纸，默认内置 bg1/bg2，可在 [AnimeBackground.vue](src/components/AnimeBackground.vue) 的 `LOCAL_WALLPAPERS` 数组里登记更多；无本地图时自动回退到档期动画的横版高清横幅图约 1900px），不做模糊拼贴，随主题自动调节透明度
- **动漫详情**：点击任意标签/条目弹出详情——封面、多语言标题、连载状态、类型、集数、评分、制作公司、简介，以及按日期分组的完整放送时间表
- **悬浮提示**：鼠标悬停日历标签显示完整标题 + **大封面预览**（72×102）+ 精确时间
- **当日弹层**：月历视图点击日期格弹出当天完整放送列表（大封面 + 完整标题）
- **数据缓存**：档期数据缓存 12 小时（localStorage），重复打开/切换档期不再请求 API，秒开
- 放送时间按浏览器本地时区（UTC+8）显示

## 环境要求

- [Node.js](https://nodejs.org) ≥ 20.19（推荐使用最新 LTS 或 v24）
- npm（随 Node.js 一起安装）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev
```

启动后打开终端显示的地址（默认 <http://localhost:5173>），即可看到当前档期的动漫日历。

> 注意：页面数据直接通过浏览器请求 AniList API，需要能正常访问外网（anilist.co）。

## 构建与预览

```bash
# 生产构建，输出到 dist/
npm run build

# 本地预览构建产物
npm run preview
```

## 项目结构

```
├── index.html                    # 入口页面
├── package.json
├── vite.config.js
└── src/
    ├── main.js                   # 应用入口
    ├── App.vue                   # 根组件（布局 + 状态编排）
    ├── style.css                 # 全局样式（深色主题）
    ├── api/
    │   └── anilist.js            # AniList GraphQL 封装与查询
    ├── composables/
    │   ├── useSeason.js          # 档期状态：加载数据、切档、翻月
    │   ├── useLanguage.js        # 显示语言状态（默认中文，持久化）
    │   └── useTheme.js           # 主题状态：浅色/深色/按时间自动
    ├── utils/
    │   ├── date.js               # 档期映射、日历网格、时间格式化
    │   └── titles.js             # 按语言解析标题（titleFor）
    ├── data/
    │   └── zhTitles.js           # 中文标题映射表（AniList id → 译名）
    └── components/
        ├── WeekView.vue          # 周历视图（默认，大格子全部显示）
        ├── Calendar.vue          # 月历视图（含悬浮提示、当日弹层）
        ├── DayPopover.vue        # 当日放送列表弹层
        ├── ListView.vue          # 列表视图（按日期分组）
        ├── AnimeBackground.vue   # 浅透明二次元美少女背景（本地图优先，回退档期封面）
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

- **中文标题为人工维护的映射表**（AniList 不提供中文标题字段）：见 [src/data/zhTitles.js](src/data/zhTitles.js)，目前覆盖 2026 夏季档大部分条目；未收录的动画回退显示罗马音。新增条目时在文件中按 `AniList id: '译名'` 追加即可（id 可在动画详情弹窗的 AniList 链接中查到）
- 档期内已完结 / 未开播 / 缺排期的动画不出现在日历上，会列在日历下方
- AniList 查询结果总量字段（`total`）不准确，实际数据以分页拉取为准
