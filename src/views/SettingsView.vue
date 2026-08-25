<script setup>
// 设置页：配置哪些页面对游客可见、哪些页面对内部人员额外可见
import { computed, onMounted, ref } from 'vue'
import { getSettings, updateSettings } from '../api/settings'
import { useSettings } from '../composables/useSettings'

const settings = useSettings()

const OPTIONS = [
  { key: 'anime', label: 'Anime 日历', desc: '当前档期新番放送时间表' },
  { key: 'blog', label: 'Blog 博客', desc: '追番笔记与推荐' },
  { key: 'wiki', label: 'Wiki', desc: '动漫知识库' },
  { key: 'tools', label: 'Tools 工具箱', desc: 'JSON 格式化 / 二维码解析 / 图片裁切' },
  { key: 'pet', label: '桌宠（大肥鱼）', desc: '网页左下角的动画小宠物，默认仅登录可见' },
]

const guestSelected = ref([])
const insiderSelected = ref([])
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const error = ref('')

onMounted(async () => {
  try {
    const d = await getSettings()
    guestSelected.value = d.guestPages
    insiderSelected.value = d.insiderPages || []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

// 内部人员额外可见的选项：已对游客可见的页面自动包含在内部可见内，不再重复勾选
const insiderOptions = computed(() =>
  OPTIONS.filter((o) => !guestSelected.value.includes(o.key))
)
const guestCovered = computed(() =>
  OPTIONS.filter((o) => guestSelected.value.includes(o.key))
)

async function onSave() {
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    const d = await updateSettings({
      guestPages: guestSelected.value,
      insiderPages: insiderSelected.value,
    })
    settings.apply(d) // 导航 / 主页立即生效
    insiderSelected.value = d.insiderPages
    message.value = '已保存'
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <h1 class="page-title">设置</h1>
    <p class="sub">页面访问权限：配置不同身份的可见范围（游客 &lt; 内部人员 &lt; 管理员）</p>

    <p v-if="error" class="settings-error">{{ error }}</p>
    <p v-if="loading" class="settings-hint">加载中…</p>

    <div v-else class="settings-stack">
      <section class="settings-card">
        <h2 class="section-title">游客可见页面</h2>
        <p class="section-sub">未勾选的页面，游客与内部人员都看不到（内部人员需额外授权）</p>
        <label v-for="o in OPTIONS" :key="o.key" class="opt">
          <input type="checkbox" :value="o.key" v-model="guestSelected" />
          <span class="opt-main">
            <span class="opt-label">{{ o.label }}</span>
            <span class="opt-desc">{{ o.desc }}</span>
          </span>
        </label>
      </section>

      <section class="settings-card">
        <h2 class="section-title">内部人员可见页面（游客不可见）</h2>
        <p class="section-sub">
          内部人员为只读身份，可浏览此处勾选的页面；已对游客可见的页面会自动包含在其可见范围内
        </p>
        <label v-for="o in insiderOptions" :key="o.key" class="opt">
          <input type="checkbox" :value="o.key" v-model="insiderSelected" />
          <span class="opt-main">
            <span class="opt-label">{{ o.label }}</span>
            <span class="opt-desc">{{ o.desc }}</span>
          </span>
        </label>
        <p v-if="guestCovered.length" class="covered-hint">
          已包含：<span v-for="o in guestCovered" :key="o.key" class="covered-tag">{{ o.label }}</span>
        </p>
        <p v-if="!insiderOptions.length" class="settings-hint">当前没有可单独授权的页面</p>
      </section>

      <div class="actions">
        <button class="btn btn-primary" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <span v-if="message" class="saved">{{ message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: min(900px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.settings-error {
  color: #ff9d9d;
  font-size: 14px;
}

.settings-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.settings-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.section-title {
  margin: 0;
  font-size: 15px;
}

.section-sub {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
}

.opt:hover {
  background: var(--panel-2);
}

.opt input {
  margin-top: 4px;
  accent-color: var(--accent);
}

.opt-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opt-label {
  font-size: 14px;
  font-weight: 600;
}

.opt-desc {
  font-size: 12px;
  color: var(--muted);
}

.covered-hint {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.covered-tag {
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}

.saved {
  font-size: 13px;
  color: var(--accent);
}
</style>
