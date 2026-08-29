<script setup>
// 访问 IP 地图：Leaflet + OpenStreetMap 底图，圆点标注访问量，热力图展示热点区域
import { onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

  // 标注点：半径随访问量增大，红色越深代表热点越高
  markersLayer = L.layerGroup(
    pts.map((p) => {
      const radius = Math.max(5, Math.min(26, 4 + Math.sqrt(p.count) * 1.6))
      const marker = L.circleMarker([p.lat, p.lon], {
        radius,
        stroke: true,
        weight: 1,
        color: '#ffffff',
        fillColor: '#ff5d5d',
        fillOpacity: 0.55,
      })
      marker.bindPopup(
        `<b>${fmtLocation(p)}</b><br/>访问 ${p.count} 次 · ${p.ipCount} 个 IP`
      )
      return marker
    })
  )
  markersLayer.addTo(map)

  // 热力图：按访问量归一化强度
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

  // 自动缩放到所有点（切换热力图时不打断当前视角）
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

function toggleHeat() {
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

  // leaflet.heat 插件依赖全局 L，先挂到 window 再动态加载
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
    <div class="visit-map-toolbar">
      <label class="visit-map-toggle">
        <input v-model="showHeat" type="checkbox" @change="toggleHeat" />
        热点热力图
      </label>
      <span class="visit-map-tip">圆点越大代表访问越多；热力图颜色越红代表越集中</span>
    </div>
    <div ref="el" class="visit-map-canvas" :style="{ height: height + 'px' }"></div>
    <p v-if="!points.length" class="visit-map-empty">暂无可标注的 IP 位置</p>
  </div>
</template>

<style scoped>
.visit-map {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.visit-map-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.visit-map-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text);
  font-weight: 600;
}

.visit-map-toggle input {
  accent-color: var(--accent);
}

.visit-map-tip {
  font-size: 11px;
  color: var(--muted);
}

.visit-map-canvas {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #aadaff;
  z-index: 0;
}

.visit-map :deep(.leaflet-container) {
  font-family: inherit;
  border-radius: 12px;
}

.visit-map :deep(.leaflet-popup-content) {
  font-size: 12px;
  line-height: 1.6;
}

.visit-map-empty {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  padding: 8px 0;
}
</style>
