import { afterEach, expect, it, vi } from 'vitest';
import { createProfileService, supportsAlternativeEmail, type BackupSchedule } from './profile';
import { createLocalAdapter } from './localAdapter';
import { PasswordConfirmationRequiredError } from './errors';

it('keeps renamed fixture credentials and password changes in the current fixture session', async () => {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  const service = createProfileService(vi.fn(), fixture.auth);
  await service.update({ username: 'renamed', email: 'new@example.com', currentPassword: 'password123' });
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

it('sends the alternative email and password to PATCH /api/profile and reads the alternative email back', async () => {
  const request = vi.fn().mockResolvedValue({ id: '1', username: 'admin', email: 'admin@example.com', role: 'admin', alternativeEmail: 'alt@example.com' });
  const service = createProfileService(request);
  const changes = { username: 'admin', email: 'admin@example.com', alternativeEmail: 'alt@example.com', currentPassword: 'secret' };
  expect(await service.update(changes)).toMatchObject({ alternativeEmail: 'alt@example.com' });
  expect(request).toHaveBeenCalledWith('/api/profile', { method: 'PATCH', body: JSON.stringify(changes) });
  await service.update({ username: 'admin', email: 'admin@example.com', alternativeEmail: null, currentPassword: 'secret' });
  expect(JSON.parse(request.mock.lastCall![1].body)).toEqual({ ...changes, alternativeEmail: null });
});

it('tells a server without alternative emails from one with none set', async () => {
  const absent = createProfileService(vi.fn().mockResolvedValue({ id: '1', username: 'admin', email: 'a@example.com', role: 'admin' }));
  const unset = createProfileService(vi.fn().mockResolvedValue({ id: '1', username: 'admin', email: 'a@example.com', role: 'admin', alternativeEmail: null }));
  expect(supportsAlternativeEmail(await absent.get())).toBe(false);
  expect(supportsAlternativeEmail(await unset.get())).toBe(true);
});

it('hands a refusal that names a field to the caller untouched', async () => {
  const refusal = Object.assign(new Error('That email address is already in use'), { fieldErrors: { alternativeEmail: 'That email address is already in use' } });
  const service = createProfileService(vi.fn().mockRejectedValue(refusal));
  await expect(service.update({ username: 'admin', email: 'a@example.com', alternativeEmail: 'b@example.com', currentPassword: 'x' })).rejects.toBe(refusal);
});

it('keeps the fixture alternative email through the profile service', async () => {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  const service = createProfileService(vi.fn(), fixture.auth);
  expect(await service.get()).toMatchObject({ alternativeEmail: null });
  await expect(service.update({ username: 'admin_justine', email: 'admin@isu.edu.ph', alternativeEmail: 'dean.backup@gmail.com', currentPassword: 'password123' }))
    .rejects.toMatchObject({ fieldErrors: { alternativeEmail: 'That email address is already in use' } });
  expect(await service.update({ username: 'admin_justine', email: 'admin@isu.edu.ph', alternativeEmail: 'justine.home@gmail.com', currentPassword: 'password123' }))
    .toMatchObject({ alternativeEmail: 'justine.home@gmail.com' });
});

const SCHEDULE: BackupSchedule = { enabled: true, frequency: 'daily', day: null, time: '02:30', timeZone: 'Asia/Manila', keep: 14 };
const BACKUP = { id: 'b1', createdAt: '2026-10-09T02:00:00Z', createdBy: 'scheduled', sizeBytes: 1024, scope: 'Campus data', status: 'ready' };

it('reads the capability flags and schedule from the real history, and treats missing ones as absent', async () => {
  const request = vi.fn().mockResolvedValue({ items: [BACKUP], activeJob: { id: 'j', kind: 'backup', status: 'running', cancellable: true }, canDownload: true, canDelete: false, schedule: SCHEDULE });
  const service = createProfileService(request);
  expect(await service.history()).toMatchObject({ canDownload: true, canDelete: false, schedule: SCHEDULE, activeJob: { cancellable: true } });
  request.mockResolvedValue({ items: [BACKUP], activeJob: { id: 'j', kind: 'backup', status: 'running' } });
  const today = await service.history();
  expect(today.canDownload).toBeUndefined();
  expect(today.canDelete).toBeUndefined();
  expect(today.schedule).toBeUndefined();
  expect(today.activeJob?.cancellable).toBeUndefined();
});

it('drops a schedule it cannot read instead of failing the whole history', async () => {
  const service = createProfileService(vi.fn().mockResolvedValue({ items: [BACKUP], schedule: { ...SCHEDULE, timeZone: 'UTC' } }));
  const history = await service.history();
  expect(history.items).toHaveLength(1);
  expect(history.schedule).toBeUndefined();
});

it('accepts the cancelled job status', async () => {
  const service = createProfileService(vi.fn().mockResolvedValue({ id: 'j', kind: 'restore', status: 'cancelled' }));
  expect(await service.job('j')).toMatchObject({ status: 'cancelled' });
});

it('sends cancel, download, delete and schedule requests through the proposed endpoints', async () => {
  const request = vi.fn().mockResolvedValue({ id: 'job/1', kind: 'backup', status: 'running' });
  const service = createProfileService(request);
  await service.cancelJob('job/1');
  expect(request).toHaveBeenLastCalledWith('/api/jobs/job%2F1/cancel', { method: 'POST', body: '{}' });
  request.mockResolvedValue({ url: 'https://files.example.com/once', expiresAt: '2026-10-09T02:05:00Z' });
  expect(await service.download('b/1', 'secret')).toEqual({ url: 'https://files.example.com/once', expiresAt: '2026-10-09T02:05:00Z' });
  expect(request).toHaveBeenLastCalledWith('/api/backups/b%2F1/download', { method: 'POST', body: JSON.stringify({ currentPassword: 'secret' }) });
  request.mockResolvedValue(null);
  await service.remove('b/1');
  expect(request).toHaveBeenLastCalledWith('/api/backups/b%2F1', { method: 'DELETE' });
  request.mockResolvedValue(SCHEDULE);
  expect(await service.saveSchedule(SCHEDULE)).toEqual(SCHEDULE);
  expect(request).toHaveBeenLastCalledWith('/api/backups/schedule', { method: 'PUT', body: JSON.stringify(SCHEDULE) });
});

it.each(['javascript:alert(1)', '//evil.example/x', 'data:text/plain,hi', 'blob:http://x/1'])('refuses a download link that is not http(s) or a root-relative path: %s', async (url) => {
  const service = createProfileService(vi.fn().mockResolvedValue({ url, expiresAt: '2026-10-09T02:05:00Z' }));
  await expect(service.download('b1', 'secret')).rejects.toThrow();
});

it('resolves a root-relative download link against the API origin, not the page origin', async () => {
  const request = vi.fn().mockResolvedValue({ url: '/api/backup-downloads/tok', expiresAt: '2026-10-09T02:05:00Z' });
  const service = createProfileService(request, undefined, undefined, (path) => `http://api.example:5000${path}`);
  expect((await service.download('b1', 'secret')).url).toBe('http://api.example:5000/api/backup-downloads/tok');
  request.mockResolvedValue({ url: 'https://files.example.com/once', expiresAt: '2026-10-09T02:05:00Z' });
  expect((await service.download('b1', 'secret')).url).toBe('https://files.example.com/once');
});

it('drops a weekly schedule without a day, and a daily one with a day, instead of failing the history', async () => {
  for (const schedule of [{ ...SCHEDULE, frequency: 'weekly', day: null }, { ...SCHEDULE, frequency: 'daily', day: 3 }]) {
    const service = createProfileService(vi.fn().mockResolvedValue({ items: [BACKUP], schedule }));
    const history = await service.history();
    expect(history.items).toHaveLength(1);
    expect(history.schedule).toBeUndefined();
  }
  const service = createProfileService(vi.fn().mockResolvedValue({ ...SCHEDULE, frequency: 'weekly', day: null }));
  await expect(service.saveSchedule(SCHEDULE)).rejects.toThrow();
});

it('never falls back to fixture behaviour in real mode', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Not found'));
  const service = createProfileService(request);
  await expect(service.cancelJob('j')).rejects.toThrow('Not found');
  await expect(service.remove('b1')).rejects.toThrow('Not found');
  await expect(service.saveSchedule(SCHEDULE)).rejects.toThrow('Not found');
  await expect(service.download('b1', 'p')).rejects.toThrow('Not found');
});

async function fixtureService(audit = vi.fn()) {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  return { service: createProfileService(vi.fn(), fixture.auth, audit), audit };
}
async function finishJob(service: Awaited<ReturnType<typeof fixtureService>>['service'], id: string) {
  let job = await service.job(id);
  while (job.status === 'running' || job.status === 'queued') job = await service.job(id);
  return job;
}

it('starts the fixture with every capability on, the seeded daily schedule and a varied demo history', async () => {
  const { service } = await fixtureService();
  const history = await service.history();
  expect(history).toMatchObject({ activeJob: null, canDownload: true, canDelete: true, schedule: SCHEDULE });
  expect(history.items.map((item) => [item.createdBy === 'scheduled' ? 'automatic' : 'manual', item.status])).toEqual([['automatic', 'ready'], ['manual', 'ready'], ['automatic', 'failed']]);
  const times = history.items.map((item) => Date.parse(item.createdAt));
  expect(times).toEqual([...times].sort((a, b) => b - a));
  expect(times[0]).toBeLessThanOrEqual(Date.now());
  expect(Date.now() - times[2]).toBeLessThan(7 * 24 * 3_600_000);
  expect(history.items[2].sizeBytes).toBe(0);
});

it('cancels a fixture backup through to a cancelled status, adds no history row, and audits it', async () => {
  const { service, audit } = await fixtureService();
  const before = (await service.history()).items;
  const job = await service.createBackup();
  expect(job.cancellable).toBe(true);
  expect((await service.cancelJob(job.id)).status).toBe('queued');
  expect(await service.job(job.id)).toMatchObject({ status: 'cancelled', cancellable: false });
  expect(await service.history()).toMatchObject({ items: before, activeJob: null });
  expect(audit).toHaveBeenCalledWith('Cancelled Backup', expect.any(String));
  // Cancelling a finished job is a no-op that reports its status.
  expect(await service.cancelJob(job.id)).toMatchObject({ status: 'cancelled' });
  expect(audit).toHaveBeenCalledTimes(1);
  expect((await service.createBackup()).status).toBe('queued');
});

it('lets a fixture backup that was not cancelled finish', async () => {
  const { service } = await fixtureService();
  const job = await service.createBackup();
  const before = (await service.history()).items.length;
  expect(await finishJob(service, job.id)).toMatchObject({ status: 'succeeded' });
  expect((await service.history()).items).toHaveLength(before + 1);
});

async function withBackup() {
  const context = await fixtureService();
  const job = await context.service.createBackup();
  await finishJob(context.service, job.id);
  const [backup] = (await context.service.history()).items;
  return { ...context, backup };
}

const blobUrls = vi.fn(() => 'blob:demo-download');
afterEach(() => vi.unstubAllGlobals());

it('checks the password for a fixture download and returns a clearly labelled demo file', async () => {
  const { service, backup, audit } = await withBackup();
  let blob: Blob | undefined;
  vi.stubGlobal('URL', { createObjectURL: (value: Blob) => { blob = value; return blobUrls(); }, revokeObjectURL: vi.fn() });
  await expect(service.download(backup.id, 'wrong')).rejects.toThrow('Password is incorrect');
  const link = await service.download(backup.id, 'password123');
  expect(link).toMatchObject({ url: 'blob:demo-download', filename: `isu-camp-backup-DEMO-${backup.id}.txt` });
  expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now());
  const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob!); });
  expect(text).toContain('DEMO FILE');
  expect(audit).toHaveBeenCalledWith('Downloaded Backup', backup.createdAt);
  await expect(service.download('missing', 'password123')).rejects.toThrow('Backup is unavailable.');
});

it('deletes a fixture backup only after the password was confirmed, and not while a job runs', async () => {
  const fixture = createLocalAdapter({ locations: [] }, null);
  await fixture.auth.login('admin_justine', 'password123');
  const audit = vi.fn();
  const service = createProfileService(vi.fn(), fixture.auth, audit);
  await finishJob(service, (await service.createBackup()).id);
  const [backup] = (await service.history()).items;
  await expect(service.remove(backup.id)).rejects.toBeInstanceOf(PasswordConfirmationRequiredError);
  await fixture.auth.confirmPassword('password123');
  await service.createBackup();
  await expect(service.remove(backup.id)).rejects.toThrow('Another backup or restore is already running.');
  const running = (await service.history()).activeJob!;
  await service.cancelJob(running.id);
  await service.job(running.id);
  await service.remove(backup.id);
  expect((await service.history()).items.map((item) => item.id)).not.toContain(backup.id);
  expect(audit).toHaveBeenCalledWith('Deleted Backup', backup.createdAt);
  await expect(service.remove(backup.id)).rejects.toThrow('Backup is unavailable.');
});

it('saves the fixture schedule, validates it, audits the change, and applies retention to new backups', async () => {
  const { service, audit } = await fixtureService();
  const weekly: BackupSchedule = { ...SCHEDULE, frequency: 'weekly', day: 1, keep: 1 };
  expect(await service.saveSchedule(weekly)).toEqual(weekly);
  expect((await service.history()).schedule).toEqual(weekly);
  expect(audit).toHaveBeenCalledWith('Changed Backup Schedule', expect.stringContaining('weekly'));
  await expect(service.saveSchedule({ ...weekly, keep: 0 })).rejects.toThrow();
  await expect(service.saveSchedule({ ...weekly, day: null })).rejects.toThrow();
  await finishJob(service, (await service.createBackup()).id);
  await finishJob(service, (await service.createBackup()).id);
  expect((await service.history()).items).toHaveLength(1);
});
