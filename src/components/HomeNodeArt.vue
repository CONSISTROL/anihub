<script setup>
// 主页入口卡片的「节点插画」。
//
// 为什么重写：这一格原先是一张 512×512 的 PNG（public/home/*.webp，每张约 100KB），
// 五张图加起来 500KB 且与主题无关 —— 深色主题下是一块亮斑，浅色主题下又偏暗，
// 高 DPI 屏上还是一张固定像素的位图。现在改成**纯 SVG + CSS 手绘**：
//   · 体积从 ~100KB/张降到不到 2KB，随窗口缩放始终锐利
//   · 全部用 currentColor，颜色直接吃卡片的 --accent（浅色 / 深色 / 将来换主题都自适应）
//   · 每张图有各自「看得出在干什么」的微动效（日历扫过、笔在写字、齿轮咬合…）
//
// —— 绘制约定 ——
//   · 所有图形大体画在 120×120 viewBox 的 **[20,100] 中心区**（wiki 那两张飘起的便签
//     会略微越界，是故意让它"飘出去"的）：留白一致，五张卡片并排时视觉份量才均匀。
//   · ⚠ 尺寸只由 CSS 变量 --art-size 决定（父级 .node-visual 设置，窄屏调小）。
//     早先这里写的是 `height: 100%`，而父级高度又是被内容撑开的 —— 百分比解不开，
//     SVG 就退回「按宽度算高度」，在 413px 宽的卡片里渲染成一个 371×371 的巨方块
//     （用户反馈的"动画图太大"就是这个，不是插画本身画大了）。
//   · 构图要对齐到同一套栅格，不出现半格偏移（日历的格线、书页的行距等）
//
// 动效约定：
//   · 循环动画都写成单独的 CSS 类（.art-sweep / .art-fade / .art-spin…），
//     一次性动画只加在需要它的元素上，整张图不会整体漂移
//   · prefers-reduced-motion 下全部停掉并回到动画的收尾状态（不能停在"写了一半"）
//   · 动效是**装饰**：卡片本身已有跟手倾角与柔光，这里的动作幅度刻意做小
//
// ⚠ 齿轮为什么要「算」出来而不是手画：tools 那张原先手画了一对号称啮合的齿轮，
//   实际是两个太阳（齿是一条条放射的短线），圆心距也远大于两半径之和，压根没碰上。
//   齿轮是有硬几何约束的图形，手写 path 必错：
//     ① 模数 m = 2r / N 必须相同 —— 齿距一样才可能咬合
//     ② 中心距必须 = 两分度圆半径之和，且相位上「甲的齿」正对「乙的槽」
//     ③ 转速比必须是 ω₂ = -ω₁ · N₁ / N₂ —— 否则转起来齿会互相穿过
//   下面三条全部由参数推出来，不写死。
defineProps({
  // anime | blog | wiki | tools | game
  name: { type: String, required: true },
})

/* —— 直齿齿轮轮廓 ——
   齿厚按「等弧长」近似（齿廓在任意半径上的弧长都 ≈ 半个周节），
   齿顶 / 齿根各用一段圆弧收口 —— 这正是标准直齿轮画出来的样子。 */
function gearPath(cx, cy, r, teeth, phase) {
  const m = (2 * r) / teeth
  const ro = r + m // 齿顶圆
  const ri = r - m * 1.25 // 齿根圆
  const step = (Math.PI * 2) / teeth
  const tip = (step / 4) * (r / ro) // 等弧长 ⇒ 角宽与半径成反比
  const root = (step / 4) * (r / ri)
  const pt = (rad, a) =>
    `${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`
  const arc = (rad, to) => `A ${rad.toFixed(2)} ${rad.toFixed(2)} 0 0 1 ${to}`
  let d = `M ${pt(ri, phase - root)}`
  for (let i = 0; i < teeth; i++) {
    const c = phase + i * step
    d += ` L ${pt(ro, c - tip)} ${arc(ro, pt(ro, c + tip))}`
    d += ` L ${pt(ri, c + root)} ${arc(ri, pt(ri, c + step - root))}`
  }
  return `${d} Z`
}

/* —— tools 的一对齿轮 ——
   N₁=11 / N₂=10：齿够大，缩进卡片里仍然看得出是「齿」而不是「花边」 */
const GEAR_A = { cx: 47, cy: 49, r: 19, teeth: 11 }
const GEAR_B = { teeth: 10, r: 0, cx: 0, cy: 0 }
const MESH_ANGLE = (40 * Math.PI) / 180 // 两轮连心线的方向，取 40° 让构图落在中心区
GEAR_B.r = ((2 * GEAR_A.r) / GEAR_A.teeth / 2) * GEAR_B.teeth // 同模数 ⇒ 同齿距
GEAR_B.cx = GEAR_A.cx + (GEAR_A.r + GEAR_B.r) * Math.cos(MESH_ANGLE) // 中心距 = 两分度圆半径之和
GEAR_B.cy = GEAR_A.cy + (GEAR_A.r + GEAR_B.r) * Math.sin(MESH_ANGLE)
// 甲的某个齿正对乙（相位 = 连心线方向）；乙则要让「槽」朝着甲 ⇒ 再偏半个齿距
const GEAR_A_D = gearPath(GEAR_A.cx, GEAR_A.cy, GEAR_A.r, GEAR_A.teeth, MESH_ANGLE)
const GEAR_B_D = gearPath(
  GEAR_B.cx,
  GEAR_B.cy,
  GEAR_B.r,
  GEAR_B.teeth,
  MESH_ANGLE + Math.PI + Math.PI / GEAR_B.teeth
)
// 转速比 = 齿数反比：甲转一圈（24s），乙要转 24 · N₂/N₁ 秒 —— 写死会在几秒后错位打架
const GEAR_B_PERIOD = 24 * (GEAR_B.teeth / GEAR_A.teeth)

/* —— game 的地牢地块：3×3，格 24 / 缝 2，整体 76×76 落在中心区 —— */
const GAME_CELLS = [22, 48, 74].flatMap((x) => [22, 48, 74].map((y) => [x, y]))
</script>

<template>
  <!-- 底纹：极淡的网格 + 一圈光晕，让插画"浮"在卡片上而不是直接贴底 -->
  <span class="art" :class="`art-${name}`">
    <svg class="art-svg" viewBox="0 0 120 120" role="presentation" aria-hidden="true">
      <!-- ——— Anime：4×3 的日历格 + 一条时间轴，指针在轴上扫过 ——— -->
      <template v-if="name === 'anime'">
        <rect class="ln" x="24" y="28" width="72" height="54" rx="9" />
        <path class="ln faint" d="M24 40h72" />
        <path class="ln soft" d="M42 40v42M60 40v42M78 40v42M24 54h72M24 68h72" />
        <rect class="fill soft art-fade" x="45" y="42" width="12" height="10" rx="3.5" />
        <rect class="fill soft art-fade d2" x="63" y="56" width="12" height="10" rx="3.5" />
        <rect class="fill soft art-fade d4" x="81" y="42" width="12" height="10" rx="3.5" />
        <path class="ln faint" d="M24 92h72" />
        <path class="ln faint" d="M32 92v5M48 92v5M64 92v5M80 92v5M96 92v5" />
        <circle class="fill art-sweep" cx="32" cy="92" r="3" />
      </template>

      <!-- ——— Blog：一页文稿 + 一支正在写字的笔 ———
           文稿三行、笔压在第三行末尾；文字行刻意只写到 x=74 / 52，
           给右下角的笔留出位置，不然笔身会横穿做好的文字线。 -->
      <template v-else-if="name === 'blog'">
        <rect class="ln" x="26" y="22" width="60" height="76" rx="9" />
        <path class="ln faint" d="M26 34h60" />
        <circle class="fill soft" cx="34" cy="28" r="2.2" />
        <circle class="fill soft" cx="41" cy="28" r="2.2" />
        <path class="ln soft" d="M34 46h40M34 58h40M34 70h18" />
        <g class="art-write">
          <path class="ln" d="M58 74L64.5 72L73.7 62.8L69.2 58.3L60 67.5Z" />
          <path class="ln faint" d="M60 67.5L64.5 72" />
        </g>
      </template>

      <!-- ——— Wiki：摊开的书 + 两张飘起的便签 ———
           便签刻意偏向右侧并停在上方：居中会压在书脊（书页交汇的尖角）上，
           压到书页轮廓上看着像穿帮。 -->
      <template v-else-if="name === 'wiki'">
        <rect class="ln soft art-page a" x="64" y="24" width="24" height="26" rx="5" />
        <rect class="ln soft art-page b" x="70" y="14" width="22" height="24" rx="5" />
        <path class="ln" d="M60 56c-9-5-22-5-31 0v42c9-5 22-5 31 0 9-5 22-5 31 0V56c-8-5-21-5-31 0z" />
        <path class="ln faint" d="M60 56v42" />
        <path class="ln faint" d="M37 68h16M37 78h16M67 68h16M67 78h16" />
      </template>

      <!-- ——— Tools：一对真正啮合的齿轮 + 一点火花 ———
           两条 path 与相位都是上面算出来的：分度圆相切、齿对着槽、转速比等于齿数反比。 -->
      <template v-else-if="name === 'tools'">
        <g class="art-spin" :style="{ transformOrigin: `${GEAR_A.cx}px ${GEAR_A.cy}px` }">
          <path class="ln" :d="GEAR_A_D" />
          <circle class="ln faint" :cx="GEAR_A.cx" :cy="GEAR_A.cy" r="6" />
        </g>
        <g
          class="art-spin-rev"
          :style="{ transformOrigin: `${GEAR_B.cx}px ${GEAR_B.cy}px`, animationDuration: `${GEAR_B_PERIOD}s` }"
        >
          <path class="ln" :d="GEAR_B_D" />
          <circle class="ln faint" :cx="GEAR_B.cx" :cy="GEAR_B.cy" r="5.5" />
        </g>
        <path class="fill art-spark" d="M26 19l1.7 4.3 4.3 1.7-4.3 1.7L26 31l-1.7-4.3L20 25l4.3-1.7z" />
      </template>

      <!-- ——— Game：3×3 的地牢地块，玩家在中格、楼梯在左上角 ——— -->
      <template v-else-if="name === 'game'">
        <rect
          v-for="c in GAME_CELLS"
          :key="`${c[0]}-${c[1]}`"
          class="ln faint"
          :x="c[0]"
          :y="c[1]"
          width="24"
          height="24"
          rx="6"
        />
        <path class="ln soft" d="M28 40l6-6 6 6" />
        <rect class="fill soft art-fade" x="80" y="28" width="12" height="12" rx="4" />
        <circle class="ln soft art-ping" cx="60" cy="60" r="4.5" />
        <circle class="fill" cx="60" cy="60" r="4.5" />
      </template>
    </svg>
  </span>
</template>

<style scoped>
.art {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--accent);
}

/* 底纹：斜向细网格，颜色跟着强调色走但极淡（只做质感，不抢内容） */
.art::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, currentColor 16%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, currentColor 16%, transparent) 1px, transparent 1px);
  background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(closest-side at 50% 50%, #000 22%, transparent 100%);
  mask-image: radial-gradient(closest-side at 50% 50%, #000 22%, transparent 100%);
  opacity: 0.6;
}

.art-svg {
  position: relative;
  /* 尺寸只认这一个变量（父级 .node-visual 给出，窄屏会调小）。
     不要写成 `height: 100%`：父级高度一旦是"被内容撑开的"，
     百分比就解不开，SVG 会退回"按宽度算高度" —— 在 413px 宽的卡片里
     渲染成一个 371×371 的巨方块（用户反馈的"动画图太大"就是这个）。
     定值高度 + width:auto，配上 1:1 的 viewBox，尺寸完全确定。 */
  height: var(--art-size, 128px);
  width: auto;
  max-width: 100%;
  overflow: visible;
  transition:
    transform var(--dur-ios-3) var(--ease-ios-spring),
    filter var(--dur-ios-3) var(--ease-ios-expo);
}

/* 卡片悬浮时插画整体轻微抬升 + 提亮（与 .node-go 的动效同一节奏） */
:global(.node:hover) .art-svg {
  transform: translateY(-3px) scale(1.04);
  filter: drop-shadow(0 10px 18px color-mix(in srgb, currentColor 40%, transparent));
}

/* —— 线条与填充：颜色继承自 .art 的 currentColor —— */
.ln {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fill {
  fill: currentColor;
  stroke: none;
}

.soft {
  opacity: 0.55;
}

.faint {
  opacity: 0.28;
}

/* —— 微动效 ——
   每个动画只挂在需要它的元素上，不整图漂移；时长刻意拉长（3s+），避免"闪"。 */
@keyframes art-sweep {
  0% {
    transform: translateX(0);
    opacity: 0;
  }
  12%,
  78% {
    opacity: 0.85;
  }
  100% {
    transform: translateX(64px);
    opacity: 0;
  }
}

@keyframes art-fade {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.75;
  }
}

/* 笔尖左右小幅蹭动 = 在写；位移刻意取小，卡片上不该有"大动作" */
@keyframes art-write {
  0%,
  100% {
    transform: translateX(3px);
  }
  50% {
    transform: translateX(-3px);
  }
}

@keyframes art-page {
  0% {
    transform: translateY(6px);
    opacity: 0;
  }
  30%,
  70% {
    opacity: 0.7;
  }
  100% {
    transform: translateY(-14px);
    opacity: 0;
  }
}

@keyframes art-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes art-spark {
  0%,
  70%,
  100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  85% {
    opacity: 0.9;
    transform: scale(1.15);
  }
}

/* 玩家位置的扩散环：从玩家身上荡开再消失 */
@keyframes art-ping {
  0% {
    transform: scale(0.7);
    opacity: 0.8;
  }
  70%,
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}

.art-sweep {
  animation: art-sweep 4.2s var(--ease-ios) infinite;
}

.art-fade {
  animation: art-fade 3.4s var(--ease-ios) infinite;
}

.art-fade.d2 {
  animation-delay: 0.6s;
}

.art-fade.d4 {
  animation-delay: 1.2s;
}

/* SVG 的 transform-origin 默认是用户坐标系原点 → 用 fill-box 定位到图形自己身上：
   笔的支点要落在笔尖（图形包围盒的左下角），不然会绕远处打转 */
.art-write {
  transform-box: fill-box;
  transform-origin: 0% 100%;
  animation: art-write 2.8s var(--ease-ios) infinite;
}

.art-page {
  transform-box: fill-box;
  transform-origin: center;
  animation: art-page 3.6s var(--ease-ios-expo) infinite;
}

.art-page.b {
  animation-delay: 1.8s;
}

/* 齿轮的 transform-origin 由模板内联给出（圆心是算出来的，不在样式里写死）
   两个齿轮共用 art-spin 关键帧，靠方向 + 时长各自成对：
   时长比 = 齿数反比，见 GEAR_B_PERIOD */
.art-spin {
  animation: art-spin 24s linear infinite;
}

.art-spin-rev {
  animation: art-spin 24s linear infinite reverse;
}

.art-spark {
  transform-box: fill-box;
  transform-origin: center;
  animation: art-spark 2.6s var(--ease-ios) infinite;
}

.art-ping {
  transform-box: fill-box;
  transform-origin: center;
  animation: art-ping 2.8s var(--ease-ios-expo) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .art-sweep,
  .art-fade,
  .art-write,
  .art-page,
  .art-spin,
  .art-spin-rev,
  .art-spark,
  .art-ping {
    animation: none;
  }

  /* 停掉动画后必须回到"完整、自然"的静态形态：
     扫过的时间指针挪到轴中点；笔尖归位；便签停在飘起的高度（而不是藏起来） */
  .art-sweep {
    transform: translateX(32px);
    opacity: 0.85;
  }

  .art-fade {
    opacity: 0.6;
  }

  .art-write {
    transform: none;
  }

  .art-page {
    opacity: 0.7;
  }

  .art-spark {
    opacity: 0.6;
  }

  /* 扩散环没有动画就是一枚静止的空心圆，会跟玩家本体叠成一个"甜甜圈" */
  .art-ping {
    opacity: 0;
  }

  .art-svg {
    transition: none;
  }
}
</style>
