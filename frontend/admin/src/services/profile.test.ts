import { expect, it, vi } from 'vitest';
import { createProfileService } from './profile';
import { createLocalAdapter } from './localAdapter';

it('keeps renamed fixture credentials and password changes in the current fixture session', async () => {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  const service = createProfileService(vi.fn(), fixture.auth);
  await service.update({ username: 'renamed', email: 'new@example.com' });
  await service.changePassword({ currentPassword: 'password123', newPassword: 'Different123!' });
  await fixture.auth.logout();
  await expect(fixture.auth.login('renamed', 'password123')).rejects.toThrow();
  expect(await fixture.auth.login('renamed', 'Different123!')).toMatchObject({ username: 'renamed', email: 'new@example.com' });
});

it.each([
  ['Abcde1!', 'Password must be at least 8 characters.'],
  ['abcdefg1!', 'Password must include an uppercase letter.'],
  ['ABCDEFG1!', 'Password must include a lowercase letter.'],
  ['Abcdefgh!', 'Password must include a number.'],
  ['Abcdefg12', 'Password must include a symbol.'],
  ['abc', 'Password must be at least 8 characters.'],
])('refuses the fixture password change to %s with the server message and keeps the old password', async (newPassword, message) => {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  const service = createProfileService(vi.fn(), fixture.auth);
  await expect(service.changePassword({ currentPassword: 'password123', newPassword })).rejects.toThrow(message);
  await fixture.auth.logout();
  expect(await fixture.auth.login('admin_justine', 'password123')).toMatchObject({ username: 'admin_justine' });
});

it('checks the current password before the new one, as the server does', async () => {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  const service = createProfileService(vi.fn(), fixture.auth);
  await expect(service.changePassword({ currentPassword: 'wrong', newPassword: 'abc' })).rejects.toThrow('Current password is incorrect.');
});

it('sends authenticated operations through the proposed endpoint contract', async () => {
  const request = vi.fn().mockResolvedValue({ id: 'job-1', kind: 'restore', status: 'queued' });
  const service = createProfileService(request);
  expect(await service.restore('backup/1', 'secret')).toMatchObject({ status: 'queued' });
  expect(request).toHaveBeenCalledWith('/api/backups/backup%2F1/restore', { method: 'POST', body: JSON.stringify({ currentPassword: 'secret' }) });
  request.mockResolvedValue({ id: 1, username: 'admin', email: 'admin@example.com', role: 'superadmin' });
  expect(await service.update({ username: 'admin', email: 'admin@example.com' })).toMatchObject({ id: '1', role: 'superadmin' });
  expect(request).toHaveBeenLastCalledWith('/api/profile', { method: 'PATCH', body: JSON.stringify({ username: 'admin', email: 'admin@example.com' }) });
});

it('rejects unsupported roles and propagates server errors instead of fixture fallback', async () => {
  const request = vi.fn().mockResolvedValue({ id: '1', username: 'admin', email: 'admin@example.com', role: 'owner' });
  const service = createProfileService(request);
  await expect(service.get()).rejects.toThrow(/unavailable/);
  request.mockRejectedValue(new Error('Superadmin access required'));
  await expect(service.createBackup()).rejects.toThrow('Superadmin access required');
  expect(service.isFixture).toBe(false);
});

it('does not claim a malformed job response succeeded', async () => {
  const service = createProfileService(vi.fn().mockResolvedValue({ success: true }));
  await expect(service.createBackup()).rejects.toThrow();
});
