import { Profile } from './features/profile/Profile'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { LoadingState } from './components/UI'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import { Login } from './features/auth/AuthPages'
import { ForgotPassword } from './features/auth/ForgotPassword'
import { Dashboard } from './features/dashboard/Dashboard'
import { Locations } from './features/locations/Locations'
import { MapEditor } from './features/map/MapEditor'
import { Users } from './features/users/Users'
import { Logs } from './features/logs/Logs'

function Guard() { const { session, loading } = useAuth(); if (loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><LoadingState size={26}>Restoring your session…</LoadingState></div>; return session ? <Shell><Outlet /></Shell> : <Navigate to="/login" replace /> }
function MissingRoute() { return <main><h1>Page not found</h1><p>The requested administration page is unavailable.</p></main> }
function AppRoutes() { return <Routes><Route path="/login" element={<Login />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} /><Route element={<Guard />}><Route index element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="/map-editor" element={<MapEditor />} /><Route path="/locations" element={<Locations />} /><Route path="/users" element={<Users />} /><Route path="/profile" element={<Profile />} /><Route path="/system-logs" element={<Logs />} /></Route><Route path="*" element={<MissingRoute />} /></Routes> }
export function App() { return <AuthProvider><AppRoutes /></AuthProvider> }
