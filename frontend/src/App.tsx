import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import ExamPage from './pages/ExamPage'
import SubmitConfirmPage from './pages/SubmitConfirmPage'

// TODO: add a proper auth guard — redirect unauthenticated students to login
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/exam/:attemptId" element={<ExamPage />} />
        <Route path="/submit-confirm" element={<SubmitConfirmPage />} />
        {/* TODO: teacher/admin routes (grading review UI — not yet scoped) */}
      </Routes>
    </BrowserRouter>
  )
}

export default App
