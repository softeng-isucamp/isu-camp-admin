import { describe, expect, it } from 'vitest'
import { services } from './api'

describe('mock service contracts', () => {
  it('authenticates the seeded administrator', async () => {
    await expect(services.auth.login('admin_justine', 'password123')).resolves.toMatchObject({ username: 'admin_justine', role: 'Administrator' })
    await expect(services.auth.login('wrong', 'password123')).rejects.toThrow('Invalid username or password')
  })

  it('filters locations through the service boundary', async () => {
    const result = await services.locations.list('computer lab')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe('Computer Lab 1')
  })

  it('creates an audit entry after a user mutation', async () => {
    const before = (await services.logs.list('All')).total
    const page = await services.users.list('admin01')
    await services.users.update({ ...page.items[0], username: 'admin01' })
    expect((await services.logs.list('Admin')).total).toBeGreaterThanOrEqual(before)
  })
})
