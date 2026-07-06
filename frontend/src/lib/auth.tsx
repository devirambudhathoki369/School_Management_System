import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, setAccessToken } from './api'

/**
 * Session management: short-lived access token kept in memory only; the
 * rotating refresh token is persisted so a reload can restore the session.
 * (Hardening step before production: move the refresh token into an
 * httpOnly cookie issued by the backend.)
 */

export type Role = 'super_admin' | 'admin' | 'staff' | 'student' | 'guardian'

export interface SchoolInfo {
  id: string
  name: string
  address: string
  contact: string
  pan_no: string
}

export interface Account {
  id: string
  username: string
  role: Role
  email: string
  verified: boolean
  permissions: string[]
  school: SchoolInfo | null
}

interface AuthState {
  account: Account | null
  loading: boolean
  login: (role: Role, username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const REFRESH_KEY = 'erp.refresh'
const AuthContext = createContext<AuthState | null>(null)

async function refreshSession(): Promise<{ access: string; refresh: string } | null> {
  const refresh = localStorage.getItem(REFRESH_KEY)
  if (!refresh) return null
  try {
    const { data } = await api.post('/api/v1/auth/refresh/', { refresh })
    return data
  } catch {
    localStorage.removeItem(REFRESH_KEY)
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Restore the session on app load.
    ;(async () => {
      const tokens = await refreshSession()
      if (tokens) {
        setAccessToken(tokens.access)
        localStorage.setItem(REFRESH_KEY, tokens.refresh)
        try {
          const { data } = await api.get<Account>('/api/v1/auth/me/')
          setAccount(data)
        } catch {
          setAccessToken(null)
        }
      }
      setLoading(false)
    })()
  }, [])

  const login = useCallback(async (role: Role, username: string, password: string) => {
    const { data } = await api.post('/api/v1/auth/login/', { role, username, password })
    setAccessToken(data.access)
    localStorage.setItem(REFRESH_KEY, data.refresh)
    setAccount(data.account)
  }, [])

  const logout = useCallback(async () => {
    const refresh = localStorage.getItem(REFRESH_KEY)
    localStorage.removeItem(REFRESH_KEY)
    setAccessToken(null)
    setAccount(null)
    if (refresh) {
      await api.post('/api/v1/auth/logout/', { refresh }).catch(() => undefined)
    }
  }, [])

  const value = useMemo(
    () => ({ account, loading, login, logout }),
    [account, loading, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
