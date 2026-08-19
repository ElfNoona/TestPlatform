import { createContext, useContext, useState, ReactNode } from 'react'

/**
 * AuthContext — stores the student's JWT, attemptId, and proctoring info in memory.
 * Deliberately NOT stored in localStorage to avoid cross-tab leakage.
 */

interface AuthState {
  token: string | null
  attemptId: string | null
  proctoringSessionId: string | null
  proctoringStatus: 'ACTIVE' | 'DEGRADED' | 'UNAVAILABLE' | null
}

interface AuthContextValue extends AuthState {
  login: (
    token: string,
    attemptId: string,
    proctoringSessionId: string | null,
    proctoringStatus: string | null
  ) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    token: null,
    attemptId: null,
    proctoringSessionId: null,
    proctoringStatus: null,
  })

  function login(
    token: string,
    attemptId: string,
    proctoringSessionId: string | null,
    proctoringStatus: string | null
  ) {
    const status = ['ACTIVE', 'DEGRADED', 'UNAVAILABLE'].includes(proctoringStatus ?? '')
      ? (proctoringStatus as AuthState['proctoringStatus'])
      : 'UNAVAILABLE'
    setAuth({ token, attemptId, proctoringSessionId, proctoringStatus: status })
  }

  function logout() {
    setAuth({ token: null, attemptId: null, proctoringSessionId: null, proctoringStatus: null })
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
