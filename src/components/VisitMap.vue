<script setup>
// 访问 IP 地图：Leaflet + OpenStreetMap 底图。
// UI：玻璃面板 + iOS 分段控件（点位/热力）+ 渐变图例 + 暗色底图适配。
import { onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  points: { type: Array, default: () => [] },
  height: { type: Number, default: 420 },
})

const el = ref(null)
const showHeat = ref(true)
let map = null
let markersLayer = null
let heatLayer = null
let heatReady = false

function fmtLocation(p) {
  return [p.country, p.region, p.city].filter(Boolean).join(' · ') || '未知位置'
}

// 点位颜色：从蓝色（少）渐变到红色（多），与热力图色带一致
function markerColor(count) {
  const t = Math.min(1, Math.log10(Math.max(1, count) + 1) / 4.2)
  const hue = Math.round(210 - t * 210) // 210（蓝）→ 0（红）
  return `hsl(${hue} 78% 52%)`
}

function render({ fit = true } = {}) {
  if (!map) return
  if (markersLayer) {
    markersLayer.clearLayers()
    markersLayer = null
  }
  if (heatLayer) {
    map.removeLayer(heatLayer)
    heatLayer = null
  }

  const pts = props.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  if (!pts.length) return

  markersLayer = L.layerGroup(
    pts.map((p) => {
      const radius = Math.max(5, Math.min(26, 4 + Math.sqrt(p.count) * 1.6))
      const marker = L.circleMarker([p.lat, p.lon], {
        radius,
        stroke: true,
        weight: 1.4,
        color: '#ffffff',
        fillColor: markerColor(p.count),
        fillOpacity: 0.62,
      })
      marker.bindPopup(
        `<b>${fmtLocation(p)}</b><br/>访问 ${p.count} 次 · ${p.ipCount} 个 IP`
      )
      return marker
    })
  )
  markersLayer.addTo(map)

  if (showHeat.value && heatReady) {
    const heatData = pts.map((p) => [
      p.lat,
      p.lon,
      Math.min(1, Math.log2(p.count + 1) / 8),
    ])
    heatLayer = L.heatLayer(heatData, {
      radius: 38,
      blur: 24,
      maxZoom: 10,
      minOpacity: 0.25,
      gradient: {
        0.2: '#3388ff',
        0.4: '#66bb6a',
        0.6: '#ffb300',
        0.8: '#ff7043',
        1: '#d32f2f',
      },
    })
    heatLayer.addTo(map)
  }

  if (fit) {
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lon], 4)
    } else {
      map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), {
        padding: [30, 30],
        maxZoom: 10,
      })
    }
  }
}

function setMode(v) {
  if (showHeat.value === v) return
  showHeat.value = v
  render({ fit: false })
}

watch(() => props.points, render, { deep: true })

onMounted(async () => {
  if (!el.value || map) return
  map = L.map(el.value, {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
  }).setView([20, 0], 2)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)

  window.L = window.L || L
  try {
    await import('leaflet.heat')
    heatReady = true
  } catch {
    heatReady = false
  }
  render()
})

onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
  markersLayer = null
  heatLayer = null
})
</script>

<template>
  <div class="visit-map">
    <div class="visit-map-panel">
      <div class="visit-map-toolbar">
        <div class="map-modes" role="group" aria-label="地图显示模式">
          <button
            type="button"
            class="map-mode"
            :class="{ active: !showHeat }"
            @click="setMode(false)"
          >
            <AppIcon name="map-pin" :size="13" /> 点位
          </button>
          <button
            type="button"
            class="map-mode"
            :class="{ active: showHeat }"
            @click="setMode(true)"
          >
            <AppIcon name="flame" :size="13" /> 热力
          </button>
        </div>

        <div class="map-legend" :class="{ dim: !showHeat }" aria-hidden="true">
          <span>少</span>
          <span class="map-legend-bar"></span>
          <span>多</span>
        </div>

        <span class="map-count">
          <AppIcon name="map-pin" :size="12" />
          {{ points.length }} 个热点位置
        </span>
      </div>

      <div ref="el" class="visit-map-canvas" :style="{ height: height + 'px' }"></div>

      <div v-if="!points.length" class="visit-map-empty">
        <AppIcon name="map-pin" :size="16" />
        暂无可标注的 IP 位置
      </div>
    </div>
  </div>
</template>

<style scoped>
.visit-map {
  margin-top: 4px;
}

/* —— 玻璃面板 —— */
.visit-map-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.08);
}

.visit-map-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--panel-2) 75%, transparent);
  border-bottom: 1px solid var(--border);
}

/* iOS 分段控件 */
.map-modes {
  display: flex;
  gap: 3px;
  padding: 3px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.map-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.map-mode:hover {
  color: var(--text);
}

.map-mode.active {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
}

/* 渐变图例 */
.map-legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  transition: opacity var(--dur-ios-1) var(--ease-ios-expo);
}

.map-legend.dim {
  opacity: 0.35;
}

.map-legend-bar {
  width: 72px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(90deg, #3388ff, #66bb6a, #ffb300, #ff7043, #d32f2f);
}

.map-count {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.visit-map-canvas {
  width: 100%;
  background: #aadaff;
  z-index: 0;
}

.visit-map-empty {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  font-size: 12px;
  color: var(--muted);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  backdrop-filter: blur(4px);
}

/* —— Leaflet 皮肤 —— */
.visit-map :deep(.leaflet-container) {
  font-family: inherit;
  border-radius: 0;
}

/* 深色主题：OpenStreetMap 底图反色为暗色地图 */
:root[data-theme='dark'] .visit-map :deep(.leaflet-tile) {
  filter: invert(100%) hue-rotate(180deg) brightness(0.95) contrast(0.9) saturate(0.6);
}

:root[data-theme='dark'] .visit-map :deep(.leaflet-container) {
  background: #0b1220;
}

.visit-map :deep(.leaflet-control-zoom a) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: color-mix(in srgb, var(--overlay-panel) 92%, transparent);
  color: var(--text);
  border: 1px solid var(--border) !important;
  font-size: 15px;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.visit-map :deep(.leaflet-control-zoom a:hover) {
  background: var(--panel-2);
  color: var(--accent);
}

.visit-map :deep(.leaflet-control-attribution) {
  background: color-mix(in srgb, var(--overlay-panel) 80%, transparent) !important;
  color: var(--muted) !important;
  font-size: 10px !important;
  border-radius: 8px 0 0 0;
}

.visit-map :deep(.leaflet-control-attribution a) {
  color: var(--accent) !important;
}

.visit-map :deep(.leaflet-popup-content-wrapper) {
  background: color-mix(in srgb, var(--overlay-panel) 96%, transparent);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.22);
  backdrop-filter: blur(8px);
}

.visit-map :deep(.leaflet-popup-tip) {
  background: var(--overlay-panel);
}

.visit-map :deep(.leaflet-popup-content) {
  font-size: 12px;
  line-height: 1.6;
  margin: 10px 12px;
}

.visit-map :deep(.leaflet-popup-close-button) {
  color: var(--muted) !important;
  padding: 6px 6px 0 0 !important;
}
</style>
