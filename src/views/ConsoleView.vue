<script setup>
// 管理员控制台：多终端标签页（每个标签页一个独立终端会话，与 Xshell 一致）。
// 标签页：＋新建 / ✕关闭（至少保留一个）/ 点击切换；后台标签页的 shell 保持运行。
// 仅管理员可访问（路由 auth + 服务端 authRequired + WebSocket token 三重校验）。
import { ref } from 'vue'
import ConsoleTerminal from '../components/ConsoleTerminal.vue'
import FileManager from '../components/FileManager.vue'

// 供 <KeepAlive> 按组件名缓存，离开控制台再回来时保留终端会话和文件管理器状态
defineOptions({ name: 'ConsoleView' })

const tabs = ref([{ id: 1, title: '终端 1' }])
const activeId = ref(1)
const mode = ref('terminal') // 'terminal' | 'files'
const termCwdByTab = ref({}) // tabId -> 该终端当前工作目录（从 shell 提示符解析）
const fileTick = ref(0) // 每次打开文件管理 +1，强制文件管理器重新同步到终端目录
let nextId = 2

function addTab() {
  const id = nextId++
  tabs.value.push({ id, title: `终端 ${id}` })
  activeId.value = id
  mode.value = 'terminal'
}

function closeTab(id) {
  const i = tabs.value.findIndex((t) => t.id === id)
  if (i < 0) return
  tabs.value.splice(i, 1)
  if (activeId.value === id) {
    activeId.value = tabs.value.length ? tabs.value[Math.max(0, i - 1)].id : 0
  }
}

function onTermCwd(tabId, p) {
  termCwdByTab.value = { ...termCwdByTab.value, [tabId]: p }
}

function openFiles() {
  mode.value = 'files'
  fileTick.value++ // 打开时强制文件管理器重新定位到当前终端目录
}
</script>

<template>
  <div class="console-page">
    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab"
        :class="{ active: t.id === activeId && mode === 'terminal' }"
        @click="activeId = t.id; mode = 'terminal'"
        @mousedown.prevent
      >
        {{ t.title }}
        <span v-if="tabs.length > 1" class="tab-close" title="关闭" @click.stop="closeTab(t.id)">✕</span>
      </button>
      <button class="tab tab-add" title="新建终端" @click="addTab">＋</button>
      <button
        class="tab file-tab"
        :class="{ active: mode === 'files' }"
        title="文件管理"
        @click="openFiles"
      >📁 文件管理</button>
    </div>

    <!-- v-show 而非 v-if：切换视图时终端组件保持挂载，会话不被释放 -->
    <div v-show="mode === 'files'" class="file-area">
      <FileManager :start-path="termCwdByTab[activeId] || ''" :start-tick="fileTick" />
    </div>
    <div v-show="mode !== 'files'" class="term-area">
      <section v-for="t in tabs" :key="t.id" v-show="t.id === activeId" class="term-panel">
        <ConsoleTerminal
          :tab-id="t.id"
          :active="t.id === activeId && mode === 'terminal'"
          @cwd="onTermCwd"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.console-page {
  /* 像 html wiki 一样铺满页面：无内边距、无空隙，从导航栏下开始占满到边缘 */
  height: calc(100dvh - 54px); /* 导航栏实测高度 54px */
  max-width: 100%;
  padding: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: #0d1117;
}

/* 标签页栏 */
.tab-bar {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px 10px 0;
  background: #161b22;
  border-bottom: 1px solid #2a3441;
  flex-shrink: 0;
  overflow-x: auto;
}

.tab {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: #8b949e;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.tab:hover {
  color: #e6edf3;
  background: #1c2128;
}

.tab.active {
  color: #e6edf3;
  background: #0d1117;
  border-color: #2a3441;
}

.tab-close {
  margin-left: 8px;
  color: #6e7681;
  font-size: 11px;
}

.tab-close:hover {
  color: #f85149;
}

.tab-add {
  font-size: 15px;
  padding: 4px 12px;
  border: 1px dashed #2a3441;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: #8b949e;
}

.tab-add:hover {
  color: #58a6ff;
  border-color: #58a6ff;
}

/* 文件管理标签靠右 */
.file-tab {
  margin-left: auto;
}

/* 文件管理区占满 */
.file-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 终端区：当前标签页占满 */
.term-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.term-panel {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: #0d1117;
  display: flex;
  flex-direction: column;
}
</style>
