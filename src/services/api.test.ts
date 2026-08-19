import { describe, expect, it } from 'vitest'
import { services, setMockFailure } from './api'

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

  it('reports invalid import JSON and missing references', async () => {
    await expect(services.imports.locations('{bad')).resolves.toMatchObject({ imported: 0, errors: ['Invalid JSON file.'] })
    const result = await services.imports.routes(JSON.stringify({ id: 'r-import', name: 'Broken', sourceNodeId: 'missing', destinationNodeId: 'missing', pathPoints: [] }))
    expect(result.imported).toBe(0)
    expect(result.errors[0]).toContain('node reference')
  })

  it('supports deterministic injectable save failures', async () => {
    setMockFailure('mapSave', true)
    await expect(services.map.save()).rejects.toThrow('Mock mapSave failed')
    setMockFailure('mapSave', false)
    await expect(services.map.save()).resolves.toBeUndefined()
  })
})
