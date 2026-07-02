import axios from 'axios'

/**
 * Single API client for the whole app. The base URL is same-origin ('/'):
 * Vite proxies to Django in dev; in production the app is served behind the
 * same gateway as the API.
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
  return config
})
