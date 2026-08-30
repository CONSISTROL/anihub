<script setup>
// 网页内虚拟键盘（精简版）：
// - 数字、字母、空格、回车、Backspace、清空
// - 普通页面：输入到命令缓冲区，Enter 提交 login / inside
// - 游戏页面：按键直接发送到游戏 iframe，WASD 对应上下左右，A/B 可输作弊码
// - 电脑端物理按键会同步高亮对应的虚拟键
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'

defineOptions({ name: 'VirtualKeyboard' })

const emit = defineEmits(['close', 'login', 'inside'])
const route = useRoute()

const isGame = computed(() => route.name === 'game')
const buffer = ref('')
const activeKey = ref('')
let activeTimer = null

const QWERTY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
const DIGITS = '1234567890'.split('')

function flashKey(label) {
  activeKey.value = label
  if (activeTimer) clearTimeout(activeTimer)
  activeTimer = setTimeout(() => {
    activeKey.value = ''
  }, 180)
}

function sendToGame(key, code) {
  const iframe = document.querySelector('.spd-frame')
  const win = iframe?.contentWindow
  if (!win) return
  const opts = { key, code, bubbles: true, cancelable: true }
  win.document.dispatchEvent(new KeyboardEvent('keydown', opts))
  setTimeout(() => {
    win.document.dispatchEvent(new KeyboardEvent('keyup', opts))
  }, 80)
}

function submitCommand() {
  const cmd = buffer.value.trim().toLowerCase()
  buffer.value = ''
  if (cmd === 'login') emit('login')
  else if (cmd === 'inside') emit('inside')
}

function pressCommand(k) {
  if (k === '⌫') {
    buffer.value = buffer.value.slice(0, -1)
  } else if (k === '回车') {
    submitCommand()
  } else if (k === '清空') {
    buffer.value = ''
  } else if (k === '空格') {
    buffer.value += ' '
  } else {
    buffer.value += k
  }
}

function pressGame(k) {
  if (/^[A-Z]$/.test(k)) {
    sendToGame(k.toLowerCase(), `Key${k}`)
    return
  }
  if (/^[0-9]$/.test(k)) {
    sendToGame(k, `Digit${k}`)
    return
  }
  const map = {
    空格: [' ', 'Space'],
    回车: ['Enter', 'Enter'],
    '⌫': ['Backspace', 'Backspace'],
  }
  const hit = map[k]
  if (hit) sendToGame(hit[0], hit[1])
}

function onKey(k) {
  flashKey(k)
  if (isGame.value) pressGame(k)
  else pressCommand(k)
}

// 物理按键 → 虚拟键标签
function physicalLabel(e) {
  if (e.key === ' ') return '空格'
  if (e.key === 'Enter') return '回车'
  if (e.key === 'Backspace') return '⌫'
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toUpperCase()
  if (/^[0-9]$/.test(e.key)) return e.key
  return null
}

function onPhysicalKey(e) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }

  const label = physicalLabel(e)

  if (isGame.value) {
    if (!label) return
    e.preventDefault()
    flashKey(label)
    if (/^[A-Z]$/.test(label)) {
      sendToGame(label.toLowerCase(), `Key${label}`)
    } else if (/^[0-9]$/.test(label)) {
      sendToGame(label, `Digit${label}`)
    } else if (label === '空格') {
      sendToGame(' ', 'Space')
    } else if (label === '回车') {
      sendToGame('Enter', 'Enter')
    } else if (label === '⌫') {
      sendToGame('Backspace', 'Backspace')
    }
    return
  }

  if (!label) return
  e.preventDefault()
  flashKey(label)
  if (label === '回车') {
    submitCommand()
  } else if (label === '⌫') {
    buffer.value = buffer.value.slice(0, -1)
  } else if (label === '空格') {
    buffer.value += ' '
  } else {
    buffer.value += label
  }
}

onMounted(() => window.addEventListener('keydown', onPhysicalKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onPhysicalKey)
  if (activeTimer) clearTimeout(activeTimer)
})
</script>

<template>
  <div class="vk-mask" @click.self="emit('close')">
    <div class="vk-panel">
      <header class="vk-head">
        <h3 class="vk-title">
          <AppIcon name="keyboard" :size="16" />
          网页内键盘
        </h3>
        <button class="vk-close" title="关闭键盘" @click="emit('close')">✕</button>
      </header>

      <div class="vk-body">
        <div v-if="!isGame" class="vk-screen">{{ buffer || ' ' }}</div>

        <div class="vk-digits">
          <button
            v-for="k in DIGITS"
            :key="k"
            class="vk-key"
            :class="{ 'vk-key-active': activeKey === k }"
            @click="onKey(k)"
          >{{ k }}</button>
        </div>

        <div
          v-for="(row, ri) in QWERTY_ROWS"
          :key="ri"
          class="vk-qwerty-row"
        >
          <button
            v-for="k in row"
            :key="k"
            class="vk-key"
            :class="{ 'vk-key-active': activeKey === k }"
            @click="onKey(k)"
          >{{ k }}</button>
        </div>

        <div class="vk-action-row">
          <button
            class="vk-key vk-key-space"
            :class="{ 'vk-key-active': activeKey === '空格' }"
            @click="onKey('空格')"
          >空格</button>
          <button
            class="vk-key"
            :class="{ 'vk-key-active': activeKey === '⌫' }"
            @click="onKey('⌫')"
          >⌫</button>
          <button
            v-if="!isGame"
            class="vk-key"
            :class="{ 'vk-key-active': activeKey === '清空' }"
            @click="onKey('清空')"
          >清空</button>
          <button
            class="vk-key vk-key-enter vk-enter-right"
            :class="{ 'vk-key-active': activeKey === '回车' }"
            @click="onKey('回车')"
          >回车</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vk-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(0 0 0 / 0.3);
  backdrop-filter: blur(2px);
  padding: 12px;
}

.vk-panel {
  width: min(560px, 96vw);
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.35);
  overflow: hidden;
}

.vk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.vk-title {
  margin: 0;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.vk-close {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.vk-close:hover {
  color: var(--text);
  background: var(--panel-2);
}

.vk-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vk-screen {
  padding: 8px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 16px;
  letter-spacing: 0.08em;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-height: 36px;
  color: var(--text);
}

.vk-digits {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 6px;
}

.vk-qwerty-row {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.vk-qwerty-row .vk-key {
  flex: 1 1 0;
  min-width: 26px;
  max-width: 48px;
}

.vk-action-row {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.vk-action-row .vk-key {
  flex: 1;
  max-width: 120px;
}

.vk-enter-right {
  margin-left: auto;
}

.vk-key-space {
  min-width: 150px;
}

.vk-key {
  min-height: 40px;
  padding: 6px 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-1) var(--ease-ios-expo);
}

.vk-key:active {
  transform: scale(0.94);
  background: var(--panel);
}

.vk-key-active {
  color: #fff;
  background: var(--accent);
  border-color: transparent;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}

.vk-key-enter {
  color: #fff;
  background: var(--accent);
  border-color: transparent;
}

.vk-key-enter.vk-key-active {
  background: color-mix(in srgb, var(--accent) 80%, #fff);
}
</style>
