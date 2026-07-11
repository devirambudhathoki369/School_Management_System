import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

/**
 * Single API client for the whole app. The base URL is same-origin ('/'):
 * Vite proxies to Django in dev; in production the app is served behind the
 * same gateway as the API.
 *
 * A 401 triggers one silent refresh-and-retry; if that fails the session is
 * cleared and the app's auth state sends the user to /login.
 */
export const api = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
})

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  // FormData must negotiate its own multipart boundary — the JSON default
  // would make Django reject the upload as unsupported_media_type.
  if (config.data instanceof FormData) {
    config.headers['Content-Type'] = undefined
  }
  return config
})

const REFRESH_KEY = 'erp.refresh'
let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem(REFRESH_KEY)
  if (!refresh) return null
  try {
    // Bare axios: the interceptor must not recurse into itself.
    const { data } = await axios.post('/api/v1/auth/refresh/', { refresh })
    localStorage.setItem(REFRESH_KEY, data.refresh)
    setAccessToken(data.access)
    return data.access as string
  } catch {
    localStorage.removeItem(REFRESH_KEY)
    setAccessToken(null)
    return null
  }
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
  const isAuthCall = config?.url?.includes('/auth/login') || config?.url?.includes('/auth/refresh')
  if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null
    })
    const token = await refreshing
    if (token) {
      config._retried = true
      config.headers.Authorization = `Bearer ${token}`
      return api(config)
    }
  }
  throw error
})
