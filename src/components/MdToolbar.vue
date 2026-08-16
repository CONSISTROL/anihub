<script setup>
// Markdown 模式工具栏：命令通过 emit 交给编辑页执行（作用于选中文本）
const emit = defineEmits(['cmd'])

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 32]
const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ec4899', '#64748b', '#111827']

function fire(type, value) {
  emit('cmd', { type, value })
}
</script>

<template>
  <div class="md-toolbar">
    <button type="button" class="md-btn" title="加粗" @click="fire('bold')"><b>B</b></button>
    <button type="button" class="md-btn" title="斜体" @click="fire('italic')"><i>I</i></button>
    <button type="button" class="md-btn" title="删除线" @click="fire('strike')"><s>S</s></button>
    <span class="md-sep" />
    <button type="button" class="md-btn" title="一级标题" @click="fire('h1')">H1</button>
    <button type="button" class="md-btn" title="二级标题" @click="fire('h2')">H2</button>
    <button type="button" class="md-btn" title="三级标题" @click="fire('h3')">H3</button>
    <span class="md-sep" />
    <button type="button" class="md-btn" title="行内代码" @click="fire('code')">&lt;/&gt;</button>
    <button type="button" class="md-btn" title="代码块" @click="fire('code-block')">{ }</button>
    <button type="button" class="md-btn" title="引用" @click="fire('quote')">❝</button>
    <button type="button" class="md-btn" title="无序列表" @click="fire('ul')">•</button>
    <button type="button" class="md-btn" title="有序列表" @click="fire('ol')">1.</button>
    <span class="md-sep" />
    <button type="button" class="md-btn" title="链接" @click="fire('link')">🔗</button>
    <button type="button" class="md-btn" title="插入图片" @click="fire('image')">🖼️</button>
    <span class="md-sep" />
    <select class="md-select" title="字号" @change="fire('font-size', $event.target.value)">
      <option value="">字号</option>
      <option v-for="s in FONT_SIZES" :key="s" :value="s">{{ s }}px</option>
    </select>
    <span class="md-colors">
      <button
        v-for="c in COLORS"
        :key="c"
        type="button"
        class="md-swatch"
        :style="{ background: c }"
        :title="c"
        @click="fire('color', c)"
      />
      <input type="color" class="md-picker" title="自定义颜色" @input="fire('color', $event.target.value)" />
    </span>
  </div>
</template>

<style scoped>
.md-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px 10px 0 0;
  border-bottom: none;
}

.md-btn {
  min-width: 26px;
  height: 26px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}

.md-btn:hover {
  color: var(--text);
  background: var(--panel);
}

.md-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 5px;
}

.md-select {
  height: 26px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 4px;
}

.md-colors {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
}

.md-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgb(0 0 0 / 0.25);
  cursor: pointer;
  padding: 0;
}

.md-picker {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
</style>
