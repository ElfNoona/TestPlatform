import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useCallback } from 'react'
import { AuthProvider } from './context/AuthContext'
import { setUnauthorizedHandler } from './utils/api'
import SplashScreen from './components/SplashScreen'
import LoginPage from './pages/LoginPage'
import ExamPage from './pages/ExamPage'
import SubmitConfirmPage from './pages/SubmitConfirmPage'
import TeacherDashboard from './pages/TeacherDashboard'
import SessionReviewPage from './pages/SessionReviewPage'

function App() {
  const [splashDone, setSplashDone] = useState(false)

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true)
  }, [])

  return (
    <AuthProvider>
      <AppInner splashDone={splashDone} onSplashComplete={handleSplashComplete} />
    </AuthProvider>
  )
}

interface AppInnerProps {
  splashDone: boolean
  onSplashComplete: () => void
}

function AppInner({ splashDone, onSplashComplete }: AppInnerProps) {
  // Wire up global 401 handler — logout + redirect to login
  // This runs once after mount inside AuthProvider scope
  setUnauthorizedHandler(() => {
    // Hard redirect — clears in-memory auth state
    window.location.replace('/login')
  })

  return (
    <>
      {/* Splash screen shown on first load */}
      {!splashDone && (
        <SplashScreen onComplete={onSplashComplete} duration={2500} />
      )}

      {/* Main application */}
      {splashDone && (
        <BrowserRouter>
          <Routes>
            <Route path="/"               element={<Navigate to="/login" replace />} />
            <Route path="/login"          element={<LoginPage />} />
            <Route path="/exam/:attemptId" element={<ExamPage />} />
            <Route path="/submit-confirm" element={<SubmitConfirmPage />} />
            <Route path="/teacher"        element={<TeacherDashboard />} />
            <Route path="/teacher/session/:sessionId" element={<SessionReviewPage />} />
            {/* Catch-all */}
            <Route path="*"              element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      )}
    </>
  )
}

export default App
