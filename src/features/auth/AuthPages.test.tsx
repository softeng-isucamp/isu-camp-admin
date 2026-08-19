import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from './AuthContext'
import { Login } from './AuthPages'

describe('login screen', () => {
  it('renders the Figma-authored admin login affordances', () => {
    render(<MemoryRouter><AuthProvider><Login /></AuthProvider></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'ISU-CAMP' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('admin_justine')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/reset-password')
  })
})
