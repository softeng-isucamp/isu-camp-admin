import { useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Shell } from './components/Shell'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import { Login, PasswordReset } from './features/auth/AuthPages'
import { Dashboard } from './features/dashboard/Dashboard'
import { Locations } from './features/locations/Locations'
import { RoutesPage } from './features/routes/RoutesPage'
import { MapEditor } from './features/map/MapEditor'
import { Users } from './features/users/Users'
import { Logs } from './features/logs/Logs'

function Guard() { const { session, loading } = useAuth(); if (loading) return null; return session ? <Shell><Outlet /></Shell> : <Navigate to="/login" replace /> }
function AppRoutes() { return <Routes><Route path="/login" element={<Login />} /><Route path="/reset-password" element={<PasswordReset />} /><Route element={<Guard />}><Route index element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="/map-editor" element={<MapEditor />} /><Route path="/locations" element={<Locations />} /><Route path="/routes" element={<RoutesPage />} /><Route path="/users" element={<Users />} /><Route path="/system-logs" element={<Logs />} /></Route><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes> }
export function App() { return <AuthProvider><AppRoutes /></AuthProvider> }
