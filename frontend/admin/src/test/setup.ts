import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest `globals` is off, so RTL's automatic cleanup never registers itself.
afterEach(cleanup)

// The 1 s default is too tight for findBy*/waitFor on a loaded machine.
configure({ asyncUtilTimeout: 3000 })
