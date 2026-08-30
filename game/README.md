# 游戏：Shattered Pixel Dungeon Web

`/game` 页面嵌入的是 **Shattered Pixel Dungeon** 的浏览器移植版（TeaVM/libGDX）。
运行所需的静态文件位于 `public/spd/`，由 Vue 页面 `src/views/GameView.vue` 以全屏
iframe 方式加载。

## 来源与许可证

- 原版项目：<https://github.com/00-Evan/shattered-pixel-dungeon>
- Web 移植（本仓库使用的构建来源）：<https://github.com/glassesmonkey/shattered-pixel-dungeon-web>
- 许可证：GPL-3.0，见原项目 `LICENSE.txt` 与本目录说明。

## 如何重新构建

需要 JDK 17+。在 Web 移植仓库根目录执行：

```bash
./gradlew :web:webBuild
# Windows:
gradlew.bat :web:webBuild
```

构建产物位于 `web/build/dist/webapp/`，将其内容复制到本仓库 `public/spd/` 即可：

```bash
rm -rf public/spd
cp -R <spd-web>/web/build/dist/webapp public/spd
```

## 说明

- `public/spd/index.html` 是游戏入口，`GameView.vue` 固定加载 `/spd/index.html`。
- 首次加载会下载较大的 `app.js` 和资源文件，页面已提供加载提示。
- 游戏需要 WebGL。
- 首次运行默认简体中文；玩家在游戏内切换语言后会记住选择。
