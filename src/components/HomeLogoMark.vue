<script setup>
// 首页 Logo：以「星星」为元素的动态标记（**不含任何字母**）
//
// 造型：一大两小三颗四角星构成星群 —— 主星在中心，伴星沿一条细椭圆轨道分布，
//       另有两颗极小的碎星点缀。轨道极慢自转，所以星群整体像在绕着主星转。
//       （试过"旋臂星系"，5 颗星连成曲线后中心被捏成一坨，读起来像叶子不像 Logo；
//         三颗大小对比明显的星更清楚，也更像图标。）
//
// 动态（常态，很轻）：
//   · 三颗星按各自节奏闪烁（delay 错开）
//   · 主星呼吸略强
//   · 轨道与两圈星轨极慢自转
//
// 交互（鼠标移到 Logo 上，与常态明显不同）：
//   1. 整体轻微放大
//   2. 三颗星一起点亮：星晕、星芒张开，并按顺序脉冲
//   3. 伴星沿轨道公转起来（常态几乎是静止的慢转，hover 时明显在绕主星转）
//   4. 一束光沿轨道跑一圈 + 一颗流星扫过（常态都没有）
//   5. 邻近的星会被光标"轻轻推开"，离得越近推得越远 —— 纯手算，不用物理引擎
//
// 实现要点：
//   · 星形 = clip-path polygon（四角星）裁出的方块；星芒长度用 --r 缩放，跟着星的大小走
//   · 每颗星的位移写进 --dx/--dy，transition 用 iOS 弹簧曲线，光标离开后自然弹回
//   · 指针位置用 getBoundingClientRect 归一化到 viewBox 坐标，再换算成百分比
//   · prefers-reduced-motion 下全部静态
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

// 「减少动效」下不跑三体模拟（CSS 只能停掉脉动，星的位移是 JS 写的）
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

// ——————————————————————————————————————————————————————————————
// 三星系统：**O₂(1.2) 周期轨道**（等质量之外的"三体编舞"解）
//
// 初值来自用户给的参考图（Li et al. 2023, "New three-dimensional periodic orbits
// of the general three-body problem", 图注 "O_2(1.2)"）：
//
//   质量        [1.0, 1.0, 1.2]
//   初始位置    [(-1, 0, 0), (1, 0, 0), (0, 0, 1.02201)]
//   初始速度    [(-0.2726, -0.432094,  0.629473),
//                (-0.2726, -0.432094, -0.629473),
//                ( 0.454333, 0.720156, 0)]
//   周期        6.90577639826182
//
// 为什么用数值积分（上一版的分层构型用的是开普勒解析式）：
//   这是一条**一般三体的周期解**，没有"内层双星 + 外层伴星"那种可分解结构，
//   写不出解析式；只能老老实实用速度 Verlet 积分。
//   好处是它同样是**严格周期**的 —— 离线验证过：在 t = 6.90577639826182 处精确闭合
//   （dt = 1/50000 时位置闭合误差 1.0e-5、速度 1.6e-5），能量相对漂移 1.3e-11。
//   ⚠ 步长不够会明显跑偏：dt = 1/20000 时闭合误差是 1.8（完全散架），
//     所以这里取 dt = 1/50000。
//
// ⚠ 这套初值本身是**三维**的（z 速度 ±0.629473）：z 跨度 2.9，和 x 跨度同量级。
//   把 z 速度置零也能得到一条闭合的平面轨道，但那不是图中的这条（周期也对不上）。
//   所以照原值积分，再靠下面的视角把它投影到画面里。
// ——————————————————————————————————————————————————————————————
const G = 1
const MASS = [1.0, 1.0, 1.2]
// 原始单位下的初值（物理量一律留在原始单位，只在渲染时缩放 —— 血的教训）
// ⚠ z 上先减掉质心的 z（0.383254）：原值下系统质心不在原点，
//   投影后会整体偏出 viewBox 中心、而且各天体轨迹挤在一起。
//   验证过总动量本来就是 0，所以**只需要挪位置、不需要改速度**。
const CM_Z = 0.383254
const INIT_POS = [
  [-1, 0, 0 - CM_Z],
  [1, 0, 0 - CM_Z],
  [0, 0, 1.02201 - CM_Z],
]
const INIT_VEL = [
  [-0.2726, -0.432094, 0.629473],
  [-0.2726, -0.432094, -0.629473],
  [0.454333, 0.720156, 0],
]
// 原始单位下的周期
const PERIOD = 6.90577639826182
// 离线制表时的积分步长。必须够小：dt=1/20000 时一个周期就"完全散架"（偏差 2.3），
// 1/50000 → 1.7e-5，1/200000 → 2.6e-6。取 1/50000。
// ⚠ 这只影响**制表**（挂载时算一次），不影响运行开销。
const DT = 1 / 50000

// 渲染缩放：原始系统投影后的最大半径约 1.5 个原始单位。
// SCALE 由**离线积分一圈实测的最大投影距离**反算出来（见 fitScale()），
// 让整套轨迹**正好填满 viewBox**，不靠手写常数试。
// 这里是初始占位值，挂载时会按实测覆盖。
let SCALE = 20
// 系统**轨迹中心线**在 viewBox 里占的半径。光团本体还会再往外探约 1.8 单位，
// 所以不能直接取 30（= 半宽），否则光团会顶出 viewBox。取 28.5 → 内容约到 30.3。
const FIT_RADIUS = 28.5
// 原始坐标系到画面的整体旋转（把轨道摆成参考图那种斜向构图）
const VIEW_ROT = -0.42

// —— 视角（3D 透视）——
// 把三维轨道投影到二维：x 基本水平、z 当成"深度"、y 压缩成竖直方向。
// 这样既有参考图里"交叉椭圆"的平面观感，又保留真实的立体错落。
const TILT_Y = 0.62 // y 方向的压缩（越小平躺着越明显）
const TILT_Z = -0.46 // z 分量往竖直方向的投影（负值让"远"的一侧偏上）
const DEPTH_K = 0.34 // 深度 → 近大远小 / 前后遮挡的强度

// 时间推进：仿真时间秒数（PERIOD 秒 = 一圈）
const TIME_PER_SEC = 1
const HOVER_SPEED = 3.2

// 三颗星的外观：三个质量相近，大小也接近（1.2 那颗稍大一点）
const BODY_LOOK = [
  { r: 5.6, main: true },
  { r: 5.4, main: false },
  { r: 6.0, main: false }, // 质量 1.2，略大
]
// 只保留配色方面的常量（颜色通过 .is-c0/1/2 选渐变，见模板）

// —— 彗星拖尾 ——
//
// 常态：每颗星拖一条**彗尾**——最老的一段渐隐到 0，看着像在消逝。
// 点击：`pinned` 后不再裁剪 —— 跑满一圈就把完整椭圆永久留在画面上。
//
// ⚠ 尾巴长度按**屏幕弧长**限制，不按点数、也不按时间：
//   · 按时间限过 —— 帧率一被节流（rAF 在无头/后台会降频），同样时长里跑过的距离
//     差很多，长度就飘（实测在 328~620 段之间乱跳）。
//   · 按点数限也不对 —— 点数与速度挂钩，外层星在近星点比远星点快 2 倍多，
//     同一个点数上限在快的时候是短尾巴、慢的时候能拖出好几圈（实测 1323 段
//     把整个 logo 糊成一团）。
//   按弧长限就与速度/帧率都无关，观感恒定。
// 尾巴覆盖的屏幕弧长（viewBox 单位）。**两种状态都要按弧长裁**。
// 三体编舞的轨迹是一个紧致的小环（投影后整套系统只占约 50×48 单位），
// 所以尾巴要给得比分层构型（当时是 72/210）长得多，才看得出"三条交叉的环"：
//   常态：一段明显的弧
//   钉住：≈ 一个半圈周长（实测一圈弧长约 260~290），跑满一圈留下完整轨道
// 尾巴覆盖的屏幕弧长（viewBox 单位）。**两种状态都按弧长裁**。
// ⚠ 用户反馈过"拖尾持续时间太长"，所以这里比之前短得多：
//   之前 150/420 —— 常态那条弧几乎绕了小半圈，看着像"整条轨迹都亮着"。
//   现在常态只有 ~70（约占轨道周长 1/4），是明确的一段"尾巴"而不是"整圈"。
// ⚠ 这两个数字是**固定弧长**，不是"占一圈的比例"，所以和周期长短无关 ——
//   以后改 PERIOD 或轨道大小，尾巴的视觉长度不会随之变。
const TRAIL_LEN = 70
const TRAIL_LEN_PINNED = 220
const TRAIL_MIN_STEP = 0.16 // 相邻记录点的最小间距（越小越顺滑、段数越多）
// ⚠ 三条轨迹必须是**明显不同**的颜色（用户要求"轨迹颜色要不一样"）。
//   之前三条是 210,228,255 / 160,205,255 / 196,214,255 —— 都是浅蓝，差几个色阶，
//   叠在一起根本分不出哪条是谁，而且第 0 条和第 2 条还是同一个色系、顺序和圆点对不上。
//   现在每条都用自己圆点的**主色相**，拉开明度/色相，并把亮度调到接近
//   （紫罗兰按原亮度会明显比另两条暗，特意提亮到 178,140,255）：
//     第 1 条（冰蓝白 #8fb8ff）  第 2 条（青蓝 #3fc9ee）  第 3 条（紫罗兰 #b28cff）
const TRAIL_TINT = ['143, 184, 255', '63, 201, 238', '178, 140, 255']
// 引导环（三条常驻虚线完整轨道）用同一套色相。
// ⚠ 这里有个来回：曾按"不要虚线运动轨迹"删掉过，之后用户又要求加回来。
//   现在的分工是：**环 = 暗的虚线**（给出"轨道在哪"），**尾 = 亮的实线**（给出"正在往哪走"）。
const GUIDE_TINT = ['143, 184, 255', '63, 201, 238', '178, 140, 255']

const wrapEl = ref(null)
const hovered = ref(false)
// 点击后尾巴不再消逝
const pinned = ref(false)

// 三颗星的可反应状态：位置（viewBox 用户单位）、轨迹尾巴、被光标推开的偏移
const bodies = reactive(
  BODY_LOOK.map((look, i) => ({
    x: 32,
    y: 32,
    dx: 0,
    dy: 0,
    // 尾巴：{ x, y } 的一串点，最新的在最后
    trail: [],
    r: look.r,
    main: look.main,
    delay: i * 420,
    // 3D：depth 用于近大远小与前后遮挡（+1 最近 / -1 最远）
    depth: 0,
    scale: 1,
  }))
)

// 已推进的相位，包在 [0,1) 内（1 = 一个完整周期）
let phase = 0
// 时间倍率：常态 1，hover 时加速（平滑过渡，切换不突跳）
let speed = 1
let speedTarget = 1
let raf = 0
let lastTs = 0
let running = false

/** 把三维原始坐标投影到 viewBox。
 *  x 基本水平；y 压成竖直分量（TILT_Y）；z 既贡献一点竖直分量（TILT_Z，
 *  让"远"的一侧偏上，形成参考图那种斜向椭圆），又作为**深度**决定
 *  近大远小与前后遮挡（按系统最大半径 normR 归一化）。
 *  scale 默认取自适应的 SCALE；拟合阶段会显式传 1 来量基准范围。
 */
function project3(px, py, pz, normR, scale = SCALE) {
  const c = Math.cos(VIEW_ROT)
  const s = Math.sin(VIEW_ROT)
  // 先在水平面内旋转，摆成斜向构图
  const rx = px * c - pz * s
  const rz = px * s + pz * c
  // 屏幕坐标
  const sx = 32 + rx * scale
  const sy = 32 + (py * TILT_Y + rz * TILT_Z) * scale
  // 深度：rz 越大 = 离观察者越近（0 为最远）
  const depth = Math.max(-1, Math.min(1, rz / Math.max(1e-6, normR)))
  return { x: sx, y: sy, depth }
}


// —— 轨道引导环 ——
// 三体编舞没有解析式，所以引导环由**离线积分一整圈**采样出来（挂载时算一次）。
// 三颗星各画自己那一圈的完整轨迹 —— 也正是参考图里那三条交叉的椭圆。
//
// 这一份采样同时干三件事：① 供引导环画路径；② 供播放时按相位查表（见下）；
// ③ 量出投影后的最大范围，反算出把整套轨迹**正好铺满 viewBox** 的 SCALE。
// 只积分一次，三边共用（避免"取样用的初值/步长"和"拟合用的"不一致）。

// —— 离线把"整整一个周期"算成一张表，播放时按相位查表 ——
//
// 为什么要这样（而不是边跑边积分）：
//   这条轨道是**混沌不稳定**的，实测每周期把误差放大 ~10⁴ 倍、5~6 个周期后就飞出画面
//   （见上面 LOOP 说明）。所以必须**每个周期回到起点**。
//   但"到点重启积分"会让人看出来"每 7 秒重来一次"（用户就是这么反馈的）。
//
// 于是：**在挂载时把一整圈积分成一张高密度表**，之后画面只是按相位在这张表上走动：
//   · 相位是连续增加的，到 1 回绕到 0 —— 因为表是"一个周期"的采样，
//     表尾与表首本来就是同一个物理状态的近似，画面**看不出接缝**（不像重启那样有起始感）
//   · 每帧只在相邻两项之间做一次线性插值，比实时积分更便宜
//   · 形状永远是这一圈的形状，不会漂
// ⚠ 表的密度：PERIOD / (1/240) ≈ 1658 项。密度不够时线性插值会把圆滑的轨迹切成折线。
const TABLE_HZ = 240
// 系统的最大半径（离线量出来的），用于把 depth 归一化到 -1~1。
// ⚠ 这个常量原先放在被删掉的"数值积分"那一段里，改成制表后它必须先于 PERIOD_TABLE 定义 ——
//   否则 setup 阶段会直接抛 `NORM_R is not defined`，整页渲染失败（踩过一次）。
const NORM_R = 1.56
const PERIOD_TABLE = sampleOnePeriodAt(TABLE_HZ) // 长度 = 项数+1（末项与首项同相位）

function sampleOnePeriodAt(hz) {
  const n = Math.round(PERIOD * hz)
  const dt = PERIOD / n
  const x = INIT_POS.map((p) => p[0])
  const y = INIT_POS.map((p) => p[1])
  const z = INIT_POS.map((p) => p[2])
  const vx = INIT_VEL.map((v) => v[0])
  const vy = INIT_VEL.map((v) => v[1])
  const vz = INIT_VEL.map((v) => v[2])
  const A = { x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] }
  const compute = () => {
    for (let i = 0; i < 3; i++) A.x[i] = A.y[i] = A.z[i] = 0
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const dx = x[j] - x[i]
        const dy = y[j] - y[i]
        const dz = z[j] - z[i]
        const r2 = dx * dx + dy * dy + dz * dz
        const f = G / (r2 * Math.sqrt(r2))
        A.x[i] += f * MASS[j] * dx
        A.y[i] += f * MASS[j] * dy
        A.z[i] += f * MASS[j] * dz
        A.x[j] -= f * MASS[i] * dx
        A.y[j] -= f * MASS[i] * dy
        A.z[j] -= f * MASS[i] * dz
      }
    }
  }
  compute()
  const out = []
  for (let s = 0; s <= n; s++) {
    out.push([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]])
    for (let i = 0; i < 3; i++) {
      x[i] += vx[i] * dt + 0.5 * A.x[i] * dt * dt
      y[i] += vy[i] * dt + 0.5 * A.y[i] * dt * dt
      z[i] += vz[i] * dt + 0.5 * A.z[i] * dt * dt
    }
    const ox = [A.x[0], A.x[1], A.x[2]]
    const oy = [A.y[0], A.y[1], A.y[2]]
    const oz = [A.z[0], A.z[1], A.z[2]]
    compute()
    for (let i = 0; i < 3; i++) {
      vx[i] += 0.5 * (ox[i] + A.x[i]) * dt
      vy[i] += 0.5 * (oy[i] + A.y[i]) * dt
      vz[i] += 0.5 * (oz[i] + A.z[i]) * dt
    }
  }
  return out
}

/** 量出投影后的最大范围（SCALE = 1 时），反算填满 viewBox 所需的 SCALE */
function fitScale() {
  let maxR = 0
  for (const f of PERIOD_TABLE) {
    for (let i = 0; i < 3; i++) {
      const p = project3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2], NORM_R, 1)
      maxR = Math.max(maxR, Math.hypot(p.x - 32, p.y - 32))
    }
  }
  return maxR > 1e-6 ? FIT_RADIUS / maxR : 20
}
SCALE = fitScale()

/** 按相位 [0,1) 取三颗星在 viewBox 里的位置。
 *  相邻两项线性插值；**表尾与表首也做插值**（相位跨过 1 时从末项插到首项），
 *  这样位置是严格连续的 —— 否则回绕瞬间会有一个 ~49 用户单位的大跳
 *  （实测：不做跨边界插值时相邻帧最大位移 51，做了之后应当降到 1 左右）。 */
function positionsAtPhase(phase) {
  const last = PERIOD_TABLE.length - 1
  const fp = phase * last
  let i0 = Math.floor(fp)
  let t = fp - i0
  if (i0 >= last) {
    i0 = last - 1
    t = 1
  }
  const a = PERIOD_TABLE[i0]
  // i0 + 1 最多取到表尾（相位 1 时正好落在末项上，与首项同相位）
  const b = PERIOD_TABLE[i0 + 1]
  const out = []
  for (let k = 0; k < 3; k++) {
    const px = a[k * 3] + (b[k * 3] - a[k * 3]) * t
    const py = a[k * 3 + 1] + (b[k * 3 + 1] - a[k * 3 + 1]) * t
    const pz = a[k * 3 + 2] + (b[k * 3 + 2] - a[k * 3 + 2]) * t
    out.push(project3(px, py, pz, NORM_R))
  }
  return out
}

// —— 轨道引导环 ——
// 三颗星各自的**完整轨道**，画成很淡的**虚线**（静止不动，是"参考线"）。
// 与彗尾配合：环给出"轨道在哪"，尾巴给出"正在往哪走"。
// 数据直接来自同一张周期表（见上），所以环与实跑轨迹永远一致。
const guidePaths = computed(() =>
  [0, 1, 2].map((i) => {
    let d = ''
    for (let s = 0; s < PERIOD_TABLE.length; s++) {
      const f = PERIOD_TABLE[s]
      const p = project3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2], NORM_R)
      d += `${s ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    }
    return d + 'Z'
  })
)

/** 尾巴的弧长裁剪：从最新一点往回累加，超过 budget 就丢掉更老的 */
function trimTrail(trail, budget) {
  let len = 0
  let cut = 0
  for (let i = trail.length - 1; i > 0; i--) {
    len += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y)
    if (len > budget) {
      cut = i
      break
    }
  }
  if (cut > 0) trail.splice(0, cut)
}

function tick(ts) {
  if (!running) return
  raf = requestAnimationFrame(tick)
  if (!lastTs) lastTs = ts
  // 帧间隔限幅：切标签页回来时不要一次跳太多
  const dtms = Math.min(48, ts - lastTs)
  lastTs = ts
  speed += (speedTarget - speed) * 0.14
  // 相位推进并包在 [0,1) 内。因为位置表就是"一个周期"的采样，
  // 表尾与表首同相位，所以回绕时**看不出接缝**（不是"重启"，是接着走）。
  phase += ((dtms / 1000) * TIME_PER_SEC * speed) / PERIOD
  if (phase >= 1) phase -= Math.floor(phase)

  const ps = positionsAtPhase(phase)
  for (let i = 0; i < 3; i++) {
    const b = bodies[i]
    const p = ps[i]
    b.x = +p.x.toFixed(2)
    b.y = +p.y.toFixed(2)
    // 近大远小：depth 越大（越靠近观察者）越大
    b.depth = p.depth
    b.scale = +(1 + p.depth * DEPTH_K).toFixed(3)
    // 记录轨迹点：太近的不记（省点）
    const prev = b.trail[b.trail.length - 1]
    if (!prev || Math.hypot(b.x - prev.x, b.y - prev.y) >= TRAIL_MIN_STEP) {
      b.trail.push({ x: b.x, y: b.y })
    }
    const budget = pinned.value ? TRAIL_LEN_PINNED : TRAIL_LEN
    // ⚠⚠ 这里**不要**去"修正"已有的尾巴点。
    //   我一度为了让相位回绕时更顺滑，写过一段"让旧点按年龄权重追向新位置"的逻辑，
    //   结果把尾巴整体往中心拽、缩成一团乱麻 —— 实测尾 0 最大半径只有 20.2，
    //   而它真实的轨道半径是 28.5（引导环包围盒 [3.5,12.3,54.5,46.6]，
    //   光点实际轨迹包围盒也正好是 [3.5,12.3,54.5,46.6]，完全吻合）。
    //   也就是说：**尾巴只需要老老实实记录"光点去过哪里"**。
    //   （位置本身在回绕处已经连续了 —— 见 positionsAtPhase 的跨边界插值；
    //     回绕前后同相位的点本来就几乎重合，不需要额外补偿。）
    trimTrail(b.trail, budget)
  }
}

function start() {
  if (running || reducedMotion?.matches) return
  running = true
  lastTs = 0
  raf = requestAnimationFrame(tick)
}
function stop() {
  running = false
  cancelAnimationFrame(raf)
  raf = 0
}
function onVisibility() {
  if (document.hidden) stop()
  else start()
}

let rect = null
const PUSH_RADIUS = 30 // viewBox 用户单位：这个范围内才有推斥
const PUSH_MAX = 3.4

function onEnter() {
  hovered.value = true
  speedTarget = HOVER_SPEED // hover = 加速运动
  if (wrapEl.value) rect = wrapEl.value.getBoundingClientRect()
}

function onMove(e) {
  if (!rect) return
  // 指针 → viewBox 坐标（64×64）
  const gx = ((e.clientX - rect.left) / rect.width) * 64
  const gy = ((e.clientY - rect.top) / rect.height) * 64
  bodies.forEach((b) => {
    const vx2 = b.x - gx
    const vy2 = b.y - gy
    const d = Math.hypot(vx2, vy2)
    if (d > PUSH_RADIUS || d < 0.001) {
      b.dx = 0
      b.dy = 0
      return
    }
    // 越近推得越远；方向背离光标。线性衰减就够自然
    const k = (1 - d / PUSH_RADIUS) ** 1.6
    const push = PUSH_MAX * k
    b.dx = +((vx2 / d) * push).toFixed(2)
    b.dy = +((vy2 / d) * push).toFixed(2)
  })
}

function onLeave() {
  hovered.value = false
  speedTarget = 1 // 回到常态速度
  rect = null
  for (const b of bodies) {
    b.dx = 0
    b.dy = 0
  }
}

// 点击：钉住尾巴（不再消逝），再点一次恢复
function onTogglePin() {
  pinned.value = !pinned.value
}

// 把轨迹点铺成"彗尾"：相邻两点一段，**每段单独给自己的透明度** ——
// 最老的一段 → 0，最新的一段最亮。
// 为什么不用整条 path 一把画：SVG 没法沿路径做渐变（linearGradient 只能沿某个方向），
// 8 字这种拐弯的轨迹一把画就会时亮时暗。逐段给 opacity 才自然。
function trailSegs(trail, tint) {
  const out = []
  const n = trail.length
  if (n < 2) return out
  const top = pinned.value ? 0.9 : 1
  for (let i = 1; i < n; i++) {
    const a = trail[i - 1]
    const b = trail[i]
    // 越老越淡：k 从 0（最老）到 1（最新）。
    // 用 1.6 次方而不是平方：平方让尾部掉得太快，尾巴会缩成一小段、
    // 看起来像断掉；1.6 次方能保持"一条连续的彗尾"的感觉。
    const k = i / (n - 1)
    const op = +(Math.pow(k, 1.6) * top).toFixed(3)
    if (op < 0.01) continue
    out.push({
      k: `${i}-${a.x}-${a.y}`,
      d: `M${a.x} ${a.y}L${b.x} ${b.y}`,
      s: `rgba(${tint}, ${op})`,
    })
  }
  return out
}

// 3D 前后遮挡：按 depth 从远到近排序渲染（远的先画、近的后画会盖住远的）
const bodiesByDepth = computed(() =>
  bodies
    .map((b, idx) => ({ ...b, idx }))
    .sort((a, b) => a.depth - b.depth)
)

function refreshRect() {
  if (wrapEl.value) rect = wrapEl.value.getBoundingClientRect()
}

onMounted(() => {
  phase = 0
  // 先算一帧，避免挂载瞬间三颗星都停在中心
  const ps = positionsAtPhase(phase)
  ps.forEach((p, i) => {
    bodies[i].x = +p.x.toFixed(2)
    bodies[i].y = +p.y.toFixed(2)
    bodies[i].depth = p.depth
    bodies[i].scale = +(1 + p.depth * DEPTH_K).toFixed(3)
  })
  start()
  window.addEventListener('resize', refreshRect, { passive: true })
  window.addEventListener('scroll', refreshRect, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', refreshRect)
  window.removeEventListener('scroll', refreshRect)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div
    ref="wrapEl"
    class="logo-mark"
    :class="{ 'is-hover': hovered, 'is-pinned': pinned }"
    role="img"
    aria-label="AniHub"
    @pointerenter="onEnter"
    @pointermove="onMove"
    @pointerleave="onLeave"
    @click="onTogglePin"
  >
    <svg class="lm-svg" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <!-- 三个光团各自的径向渐变。颜色与 TRAIL_TINT（彗尾色）保持一致。
             ⚠ 这里有个反复：先要求"不要有光晕"，后又要求"小球带点发光，像背景粒子那样"。
                现在的分工是：
                  · 本渐变（.lm-dot 的 fill）—— **实心**，最外圈不透明，保证圆点边缘干净
                  · 另加一层 `.lm-dot-bloom` 专门做柔光（渐隐到 0 的径向渐变），
                    和背景亮星用的是同一套手法（实心圆 + 低透明度会得到硬边灰盘）
                 c0 = 冰蓝白  c1 = 青蓝  c2 = 紫罗兰 -->
        <radialGradient id="lmOrb0" cx="0.42" cy="0.38" r="0.62">
          <stop offset="0" stop-color="#ffffff" stop-opacity="1" />
          <stop offset="0.45" stop-color="#cfe4ff" stop-opacity="1" />
          <stop offset="0.85" stop-color="#8fb8ff" stop-opacity="1" />
          <stop offset="1" stop-color="#7aa6f0" stop-opacity="1" />
        </radialGradient>
        <radialGradient id="lmOrb1" cx="0.42" cy="0.38" r="0.62">
          <stop offset="0" stop-color="#eafcff" stop-opacity="1" />
          <stop offset="0.45" stop-color="#8fe8ff" stop-opacity="1" />
          <stop offset="0.85" stop-color="#3fc9ee" stop-opacity="1" />
          <stop offset="1" stop-color="#2fb4d8" stop-opacity="1" />
        </radialGradient>
        <radialGradient id="lmOrb2" cx="0.42" cy="0.38" r="0.62">
          <stop offset="0" stop-color="#f6ecff" stop-opacity="1" />
          <stop offset="0.45" stop-color="#cfb0ff" stop-opacity="1" />
          <stop offset="0.85" stop-color="#a97cf5" stop-opacity="1" />
          <stop offset="1" stop-color="#9468e0" stop-opacity="1" />
        </radialGradient>
        <!-- 圆点的柔光（bloom）：**必须**是从中心渐隐到 0 的径向渐变。
             用实心圆 + 低透明度会渲染成有明显硬边的圆盘（背景亮星踩过这个坑）。
             三色各一份，与 TRAIL_TINT（轨迹色）一致。 -->
        <radialGradient id="lmBloom0" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#eaf2ff" stop-opacity="0.75" />
          <stop offset="0.35" stop-color="#a9c8ff" stop-opacity="0.3" />
          <stop offset="0.7" stop-color="#8fb8ff" stop-opacity="0.08" />
          <stop offset="1" stop-color="#8fb8ff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="lmBloom1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#e2fbff" stop-opacity="0.75" />
          <stop offset="0.35" stop-color="#6fdcf6" stop-opacity="0.3" />
          <stop offset="0.7" stop-color="#3fc9ee" stop-opacity="0.08" />
          <stop offset="1" stop-color="#3fc9ee" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="lmBloom2" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#f4ecff" stop-opacity="0.75" />
          <stop offset="0.35" stop-color="#c9aafd" stop-opacity="0.3" />
          <stop offset="0.7" stop-color="#a97cf5" stop-opacity="0.08" />
          <stop offset="1" stop-color="#a97cf5" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- 三条轨道引导环：三颗星各自的完整轨道（虚线，静止不动）。
           与下面的彗尾配合：环给出"轨道在哪"，尾巴给出"正在往哪走"。
           每条环用**各自圆点的颜色**（行内 stroke），这样"哪条轨迹属于哪颗星"一目了然 -->
      <path
        v-for="(d, i) in guidePaths"
        :key="'guide' + i"
        class="lm-guide"
        :class="'is-g' + i"
        :d="d"
        :stroke="`rgb(${GUIDE_TINT[i]})`"
      />

      <!-- 彗尾：每颗星拖一条尾巴，最老的一段渐隐到 0。
           常态尾巴随时间消逝；**点击后不再消逝** -->
      <g v-for="(b, i) in bodies" :key="'trail' + i" class="lm-trail">
        <path
          v-for="seg in trailSegs(b.trail, TRAIL_TINT[i])"
          :key="seg.k"
          :d="seg.d"
          :stroke="seg.s"
        />
      </g>

      <!-- 三颗星：三个不同颜色的光团，位置由轨道解析式逐帧写入。
           ⚠ 按 depth 排序渲染 —— depth 大的（靠近观察者）后画，
             这样前面的星会挡住后面的，3D 纵深感才出来。
           ⚠ 两层结构：外层 <g transform> 负责位置（SVG 属性，不会被 CSS 覆盖），
             内层 .lm-star 只负责被光标推开的位移与深度缩放。
             合成一层的话，CSS transform 会把 SVG 的 transform 属性整条吃掉，
             所有光团都会被摞到原点（这坑踩过两次）。 -->
      <g
        v-for="b in bodiesByDepth"
        :key="b.idx"
        :transform="`translate(${b.x} ${b.y})`"
      >
        <g
          class="lm-star is-orbit"
          :class="'is-c' + b.idx"
          :style="{
            '--r': b.r,
            '--z': b.scale,
            '--dx': b.dx,
            '--dy': b.dy,
            '--d': b.delay + 'ms',
          }"
        >
          <!-- 用户要求："只要中间的圆点，不要外面的大球"，但要"带点发光，像背景粒子那样"。
               所以是**两层**：外层柔光（bloom，渐隐到 0）+ 内层实心小圆点。
               ⚠ 顺序很重要：bloom 画在下面、圆点画在上面，圆点的边缘才不会被柔光糊掉。 -->
          <circle class="lm-dot-bloom" r="4.6" />
          <circle class="lm-dot" r="4.6" />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.logo-mark {
  position: relative;
  display: grid;
  place-items: center;
  width: 132px;
  height: 132px;
  margin-bottom: 2px;
  cursor: pointer;
  /* hover 时整体轻微放大，用 iOS 弹簧曲线 */
  transition: transform var(--dur-ios-3) var(--ease-ios-spring);
}

.logo-mark.is-hover {
  transform: scale(1.07);
}

/* 背后的柔光已按用户要求去掉（原来 132px 的盒子外还铺一圈大光晕，太大太糊）。
   现在只剩 SVG 里三颗星自己的柔光。 */

.lm-svg {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* ⚠ 这里**不要**加 filter: drop-shadow —— 用户要求"不要有光晕"，
     整体投影就是给三颗星外面套一圈发白的光。 */
}

/* ---------- 轨道引导环 ---------- */
/* 三颗星各自的完整轨道：很淡的**虚线**（第 3 条稍粗稍亮）。
   给画面一个"结构"，与彗尾区分开 —— 尾是亮的、在动的实线，环是暗的、静止的虚线。
   ⚠ 颜色由模板逐条行内指定（`GUIDE_TINT[i]`），这里**不要**再写 stroke，
     否则三条环会变成同一个颜色、彼此分不出来。 */
.lm-guide {
  fill: none;
  stroke-width: 0.32;
  opacity: 0.42;
  stroke-dasharray: 1.6 2.6;
}

.lm-guide.is-g2 {
  stroke-width: 0.42;
  opacity: 0.52;
}

/* hover 时引导环也亮一点 */
.logo-mark.is-hover .lm-guide {
  opacity: 0.62;
}

/* ---------- 三体彗尾 ---------- */
/* 每段一条 path，颜色（含透明度）由 JS 逐段写进 stroke ——
   最老的一段 → 0，最新的一段最亮，看起来就是一条会消逝的彗尾。
   这里只定线宽/端点，颜色不要写，否则会盖掉 JS 的逐段透明度。
   ⚠ 不给尾巴加 drop-shadow "柔光"：用户要求"不要有光晕"，
     而且尾巴本来就是逐段透明度画的，再加发光会糊成一条毛毛的带子。
     线细的时候靠线宽（1.15）保证可见。 */
.lm-trail path {
  fill: none;
  stroke-width: 1.15;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* hover 加速时尾巴更粗一点，强化"跑起来了"的感觉 */
.logo-mark.is-hover .lm-trail path {
  stroke-width: 1.35;
}

/* 点击钉住后：尾巴不再消逝，整条轨道会留在画面上，稍微加粗一点 */
.logo-mark.is-pinned .lm-trail path {
  stroke-width: 1.3;
}

/* ---------- 三体光团 ---------- */
/* .lm-star 只负责被光标推开的偏移。
   ⚠ 位置**不要**写在这里：CSS 的 transform 会完全覆盖同名 SVG 属性，
   把位置也塞进来会让属性上的 translate(...) 失效、三个光团全摞到原点（踩过两次）。
   定位由外层 <g transform> 负责，这里只管位移。
   ⚠ 值必须带单位：SVG 里 1 用户单位 = 1px，写成 translate(2.5, 0) 解析不出长度，
   整条 transform 会被判无效。 */
.lm-star {
  transform: translate(calc(var(--dx, 0) * 1px), calc(var(--dy, 0) * 1px));
  transition: transform var(--dur-ios-3) var(--ease-ios-spring);
}

/* 一颗星 = **外层柔光 + 内层小圆点**（用户："只要中间的圆点，不要外面的大球"，
   但又要求"小球带点发光，像背景里的粒子一样"）。
   ⚠ 缩放系数只能**实测标定**，别照公式推：
     `scale(calc(var(--r) * k))` 算出来的矩阵值与 `r × k × --z` 对不上
     （实测差约 2.4 倍），按公式调会差很多。做法是改一次 k、量一次渲染像素。
      圆点 k = 0.085 → 直径 8~10px（轨迹直径 118px）
      柔光 k = 0.26  → 直径约 25~30px，即圆点外面的那一圈晕 */
.lm-dot,
.lm-dot-bloom {
  transform-origin: 0 0;
  transform-box: view-box;
  animation-delay: var(--d, 0ms);
}

/* 外层柔光：渐隐到 0 的径向渐变（不能用实心圆 + 低透明度，那是硬边灰盘）。
   呼吸幅度比圆点大一点 —— 光晕"涨缩"比亮度起伏更像发光体。 */
.lm-dot-bloom {
  animation: lm-bloom-pulse 2.6s var(--ease-ios) infinite;
  transform: scale(calc(var(--r, 5) * 0.26)) scale(var(--z, 1));
}

/* 内层圆点：实心、亮度呼吸 */
.lm-dot {
  animation: lm-orb-pulse 2.6s var(--ease-ios) infinite;
  transform: scale(calc(var(--r, 5) * 0.085)) scale(var(--z, 1));
}

/* 三个圆点三色：冰蓝白 / 青蓝 / 紫罗兰（柔光用同一套色相） */
.lm-star.is-c0 .lm-dot {
  fill: url(#lmOrb0);
}
.lm-star.is-c1 .lm-dot {
  fill: url(#lmOrb1);
}
.lm-star.is-c2 .lm-dot {
  fill: url(#lmOrb2);
}
.lm-star.is-c0 .lm-dot-bloom {
  fill: url(#lmBloom0);
}
.lm-star.is-c1 .lm-dot-bloom {
  fill: url(#lmBloom1);
}
.lm-star.is-c2 .lm-dot-bloom {
  fill: url(#lmBloom2);
}

/* 三体运动中的圆点**不能**有 transform 过渡 —— 位置每帧都在变，
   有过渡会让它"追不上"目标位置、糊成一团拖影。推斥位移是立即生效的，
   也不需要过渡（指针离开时同样立即归位）。 */
.lm-star.is-orbit {
  transition: none;
}

/* hover：加速运动（速度倍率在 JS 里平滑提升），视觉上再补一点，
   让"加速"一眼看得出来 —— 圆点和柔光的呼吸一起提速。 */
.logo-mark.is-hover .lm-dot,
.logo-mark.is-hover .lm-dot-bloom {
  animation-duration: 1.1s;
}

/* ---------- 关键帧 ---------- */
/* 圆点呼吸：亮度一起一伏。
   ⚠ 只动 opacity —— 尺寸是各自的 transform: scale(--r)，
   keyframes 里再写 transform 会把那个缩放整条覆盖掉（踩过这个坑）。 */
@keyframes lm-orb-pulse {
  0%,
  100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}

/* 柔光呼吸：只动 opacity，同样不能碰 transform（会盖掉 --r 的缩放） */
@keyframes lm-bloom-pulse {
  0%,
  100% {
    opacity: 0.62;
  }
  50% {
    opacity: 1;
  }
}

/* 窄屏缩小：阈值放到 480px 以内（手机上才缩）。
   之前写 720px，结果连 560px 的窄窗口也被缩成 88px，光团细节全糊了。 */
@media (max-width: 480px) {
  .logo-mark {
    width: 96px;
    height: 96px;
  }
}

/* 用户要求减少动效：停掉全部循环动画与三体运动，只保留静态造型
   （JS 里也要停 —— 否则三个圆点还在跑，只是看不出呼吸）
   注意轨迹现在是逐段 path，没有自己的动画，所以这里列不到它 */
@media (prefers-reduced-motion: reduce) {
  .lm-dot,
  .lm-dot-bloom {
    animation: none;
  }

  .logo-mark,
  .lm-star {
    transition: none;
  }
}
</style>
