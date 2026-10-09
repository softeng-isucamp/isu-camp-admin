import { z } from 'zod';

export const profileSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().min(1), email: z.string().email(),
  role: z.enum(['admin', 'superadmin']),
});
export type AccountProfile = z.infer<typeof profileSchema>;
export type ProfileChanges = Pick<AccountProfile, 'username' | 'email'>;
export type PasswordChange = { currentPassword: string; newPassword: string };
const jobSchema = z.object({
  id: z.string(), kind: z.enum(['backup', 'restore']),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  message: z.string().optional(),
});
export type BackupJob = z.infer<typeof jobSchema>;
const backupSchema = z.object({
  id: z.string(), createdAt: z.string().datetime(), createdBy: z.string(),
  sizeBytes: z.number().nonnegative(), scope: z.string(),
  status: z.enum(['ready', 'failed']),
});
export type SystemBackup = z.infer<typeof backupSchema>;
const historySchema = z.object({ items: z.array(backupSchema), activeJob: jobSchema.nullish() });
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type FixtureAccount = {
  profile: () => Promise<AccountProfile>;
  updateProfile: (changes: ProfileChanges) => Promise<AccountProfile>;
  changePassword: (changes: PasswordChange) => Promise<void>;
  confirmPassword: (password: string) => Promise<void>;
};

/** Proposed HTTP contract; fixture jobs demonstrate UI states without copying data. */
export function createProfileService(request: Request, fixture?: FixtureAccount) {
  const backups: SystemBackup[] = [];
  const jobs = new Map<string, { job: BackupJob; polls: number; actor: string }>();
  let activeJob: BackupJob | null = null;
  const superadmin = async () => {
    if ((await fixture!.profile()).role !== 'superadmin') throw new Error('Superadmin access is required.');
  };
  const start = async (kind: BackupJob['kind']): Promise<BackupJob> => {
    await superadmin();
    if (activeJob) throw new Error('Another backup or restore is already running.');
    const job: BackupJob = { id: crypto.randomUUID(), kind, status: 'queued' };
    jobs.set(job.id, { job, polls: 0, actor: (await fixture!.profile()).username });
    activeJob = job;
    return { ...job };
  };
  return {
    isFixture: !!fixture,
    get: async (): Promise<AccountProfile> => {
      if (fixture) return fixture.profile();
      const result = profileSchema.safeParse(await request('/api/profile'));
      if (!result.success) throw new Error('Profile settings are unavailable. The server must provide your email and account role.');
      return result.data;
    },
    update: async (changes: ProfileChanges): Promise<AccountProfile> => fixture
      ? fixture.updateProfile(changes)
      : profileSchema.parse(await request('/api/profile', { method: 'PATCH', body: JSON.stringify(changes) })),
    changePassword: async (changes: PasswordChange): Promise<void> => {
      if (fixture) return fixture.changePassword(changes);
      await request('/api/profile/password', { method: 'POST', body: JSON.stringify(changes) });
    },
    history: async () => {
      if (!fixture) return historySchema.parse(await request('/api/backups'));
      await superadmin();
      return { items: structuredClone(backups), activeJob: activeJob ? { ...activeJob } : null };
    },
    createBackup: async (): Promise<BackupJob> => fixture ? start('backup')
      : jobSchema.parse(await request('/api/backups', { method: 'POST', body: '{}' })),
    restore: async (id: string, password: string): Promise<BackupJob> => {
      if (!fixture) return jobSchema.parse(await request(`/api/backups/${encodeURIComponent(id)}/restore`, {
        method: 'POST', body: JSON.stringify({ currentPassword: password }),
      }));
      await superadmin();
      await fixture.confirmPassword(password);
      if (!backups.some((backup) => backup.id === id && backup.status === 'ready')) throw new Error('Backup is unavailable.');
      return start('restore');
    },
    job: async (id: string): Promise<BackupJob> => {
      if (!fixture) return jobSchema.parse(await request(`/api/jobs/${encodeURIComponent(id)}`));
      await superadmin();
      const entry = jobs.get(id);
      if (!entry) throw new Error('Job was not found.');
      if (entry.job.status === 'succeeded') return { ...entry.job };
      entry.polls++;
      entry.job.status = entry.polls < 2 ? 'running' : 'succeeded';
      if (entry.job.status === 'succeeded') {
        if (entry.job.kind === 'backup') backups.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: entry.actor, sizeBytes: 204800, scope: 'Demo campus data', status: 'ready' });
        activeJob = null;
      }
      return { ...entry.job };
    },
  };
}
