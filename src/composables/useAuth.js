// 登录态：模块级单例
// - 管理员：token + user 持久化（anihub.token / anihub.user），有写权限
// - 内部人员：insiderToken 持久化（anihub.insider），只读，介于游客与管理之间
// 必须定义在模块顶层，路由守卫（非 setup 上下文）才能直接使用
import { ref, computed } from 'vue'

const TOKEN_KEY = 'anihub.token'
const USER_KEY = 'anihub.user'
const INSIDER_KEY = 'anihub.insider'

const token = ref(localStorage.getItem(TOKEN_KEY) || '')
let savedUser = null
try {
  savedUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null')
} catch {
  savedUser = null
}
const user = ref(savedUser)

const insiderToken = ref(localStorage.getItem(INSIDER_KEY) || '')

const isLoggedIn = computed(() => !!token.value) // 管理员已登录
const isInsider = computed(() => !!insiderToken.value)

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

function enterInsider(t) {
  insiderToken.value = t
  localStorage.setItem(INSIDER_KEY, t)
}

function exitInsider() {
  insiderToken.value = ''
  localStorage.removeItem(INSIDER_KEY)
}

export function useAuth() {
  return { token, user, isLoggedIn, isInsider, insiderToken, setSession, clearSession, enterInsider, exitInsider }
}
