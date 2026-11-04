import { Profile } from './features/profile/Profile'
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Card, LoadingState } from './components/UI'
import logo from './assets/figma/brand/kumpas-logo.png'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import { Login } from './features/auth/AuthPages'
import { ForgotPassword } from './features/auth/ForgotPassword'
import { ForgotUsername } from './features/auth/ForgotUsername'
import { Dashboard } from './features/dashboard/Dashboard'
import { Locations } from './features/locations/Locations'
import { MapEditor } from './features/map/MapEditor'
import { Users } from './features/users/Users'
import { Logs } from './features/logs/Logs'

function Guard() { const { session, loading } = useAuth(); if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><LoadingState size={26}>Restoring your session…</LoadingState></div>; return session ? <Shell><Outlet /></Shell> : <Navigate to="/login" replace /> }
/** Unknown address. Signed in, it sits inside the sidebar layout; signed out, the only way forward is the login page. */
export function MissingRoute() {
  const { session, loading } = useAuth()
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><LoadingState size={26}>Restoring your session…</LoadingState></div>
  const card = (
    <Card className="not-found" role="region" aria-labelledby="not-found-title">
      <img src={logo} alt="" width={48} height={48} />
      <h1 id="not-found-title">Page not found</h1>
      <p>The requested administration page is unavailable. It may have moved, or the address may be mistyped.</p>
      <div className="not-found-actions">
        {session && <Link className="btn btn-primary btn-pill" to="/dashboard">Go to Dashboard</Link>}
        <Link className={`btn btn-pill ${session ? 'btn-subtle' : 'btn-primary'}`} to="/login">Back to Login</Link>
      </div>
    </Card>
  )
  if (session) return <Shell>{card}</Shell>
  return <div className="auth-page"><div className="ambient" />{card}</div>
}
function AppRoutes() { return <Routes><Route path="/login" element={<Login />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/forgot-username" element={<ForgotUsername />} /><Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} /><Route element={<Guard />}><Route index element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="/map-editor" element={<MapEditor />} /><Route path="/locations" element={<Locations />} /><Route path="/users" element={<Users />} /><Route path="/profile" element={<Profile />} /><Route path="/system-logs" element={<Logs />} /></Route><Route path="*" element={<MissingRoute />} /></Routes> }
export function App() { return <AuthProvider><AppRoutes /></AuthProvider> }
