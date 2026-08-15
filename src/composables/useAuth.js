// 登录态：模块级单例（token + user 持久化到 localStorage）
// 必须定义在模块顶层，路由守卫（非 setup 上下文）才能直接使用
import { ref, computed } from 'vue'

const TOKEN_KEY = 'anihub.token'
const USER_KEY = 'anihub.user'

const token = ref(localStorage.getItem(TOKEN_KEY) || '')
let savedUser = null
try {
  savedUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null')
} catch {
  savedUser = null
}
const user = ref(savedUser)

const isLoggedIn = computed(() => !!token.value)

function setSession(t, u) {
  token.value = t
  user.value = u
  localStorage.setItem(TOKEN_KEY, t)
  localStorage.setItem(USER_KEY, JSON.stringify(u))
}

function clearSession() {
  token.value = ''
  user.value = null
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function useAuth() {
  return { token, user, isLoggedIn, setSession, clearSession }
}
