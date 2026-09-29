import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest `globals` is off, so RTL's automatic cleanup never registers itself.
afterEach(cleanup)
