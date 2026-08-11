import { createContext, useContext, useState, ReactNode } from 'react'

/**
 * AuthContext — stores the student's JWT and attemptId in memory.
 * Deliberately NOT stored in localStorage to avoid cross-tab leakage.
 *
 * TODO: implement actual token refresh if needed
 * TODO: add teacher auth flow once provider is decided (decisions.md #1)
 */

interface AuthState {
  token: string | null
  attemptId: string | null
}

interface AuthContextValue extends AuthState {
  login: (token: string, attemptId: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ token: null, attemptId: null })

  function login(token: string, attemptId: string) {
    setAuth({ token, attemptId })
  }

  function logout() {
    setAuth({ token: null, attemptId: null })
  }

  return (
    <AuthContext.Provider value={{ ...auth, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
