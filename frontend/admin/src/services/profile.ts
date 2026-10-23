import { z } from 'zod';
import { PasswordConfirmationRequiredError } from './errors';

export const profileSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().min(1), email: z.string().email(),
  role: z.enum(['admin', 'superadmin']),
  // The key is absent from a backend that predates alternative emails; null means supported and unset.
  alternativeEmail: z.string().nullable().optional(),
});
export type AccountProfile = z.infer<typeof profileSchema>;
export type ProfileChanges = Pick<AccountProfile, 'username' | 'email'> & {
  /** Omitted when the server does not offer the field; null clears it. */
  alternativeEmail?: string | null;
  /** Required by the server whenever either email changes. */
  currentPassword?: string;
};
/** Whether the server reports an alternative email at all; without it the field stays hidden. */
export const supportsAlternativeEmail = (profile: AccountProfile) => profile.alternativeEmail !== undefined;
export type PasswordChange = { currentPassword: string; newPassword: string };
const jobSchema = z.object({
  id: z.string(), kind: z.enum(['backup', 'restore']),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  message: z.string().optional(),
  /** Absent means the server cannot cancel this job, so the control stays hidden. */
  cancellable: z.boolean().optional(),
});
export type BackupJob = z.infer<typeof jobSchema>;
const backupSchema = z.object({
  id: z.string(), createdAt: z.string().datetime(), createdBy: z.string(),
  sizeBytes: z.number().nonnegative(), scope: z.string(),
  status: z.enum(['ready', 'failed']),
});
export type SystemBackup = z.infer<typeof backupSchema>;
// Weekly needs a day and daily has none; the fixture and the HTTP parse path share this check.
export const scheduleSchema = z.object({
  enabled: z.boolean(), frequency: z.enum(['daily', 'weekly']),
  day: z.number().int().min(0).max(6).nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.literal('Asia/Manila'),
  keep: z.number().int().min(1),
}).refine((schedule) => (schedule.frequency === 'weekly') === (schedule.day !== null));
export type BackupSchedule = z.infer<typeof scheduleSchema>;
// A schedule the frontend cannot read (or in another time zone) hides the schedule control rather than the whole list.
const historySchema = z.object({
  items: z.array(backupSchema), activeJob: jobSchema.nullish(),
  canDownload: z.boolean().optional(), canDelete: z.boolean().optional(),
  schedule: scheduleSchema.optional().catch(undefined),
});
export type BackupHistory = z.infer<typeof historySchema>;
// One-time link the browser navigates to; refuses `javascript:` and other schemes. A root-relative path is the API's, not the page's.
const downloadSchema = z.object({ url: z.string().regex(/^(https?:\/\/|\/(?!\/))/), expiresAt: z.string().datetime() });
/** `filename` is only set by the fixture, whose blob link carries no Content-Disposition. */
export type BackupDownload = z.infer<typeof downloadSchema> & { filename?: string };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type FixtureAccount = {
  profile: () => Promise<AccountProfile>;
  updateProfile: (changes: ProfileChanges) => Promise<AccountProfile>;
  changePassword: (changes: PasswordChange) => Promise<void>;
  confirmPassword: (password: string) => Promise<void>;
  recentlyConfirmed: () => boolean;
};
/** Records one action in the fixture's System Logs. */
type Audit = (action: string, target: string) => void;
const HOUR = 3_600_000;
/** A few archives so the fixture history shows automatic, manual and failed rows before anything is created. */
const seedBackups = (now = Date.now()): SystemBackup[] => [
  { id: 'demo-backup-3', createdAt: new Date(now - 5 * HOUR).toISOString(), createdBy: 'scheduled', sizeBytes: 212_992, scope: 'Demo campus data', status: 'ready' },
  { id: 'demo-backup-2', createdAt: new Date(now - 29 * HOUR).toISOString(), createdBy: 'admin_dean', sizeBytes: 204_800, scope: 'Demo campus data', status: 'ready' },
  { id: 'demo-backup-1', createdAt: new Date(now - 53 * HOUR).toISOString(), createdBy: 'scheduled', sizeBytes: 0, scope: 'Demo campus data', status: 'failed' },
];
const FIXTURE_SCHEDULE: BackupSchedule = { enabled: true, frequency: 'daily', day: null, time: '02:30', timeZone: 'Asia/Manila', keep: 14 };
const TERMINAL: BackupJob['status'][] = ['succeeded', 'failed', 'cancelled'];

/** Proposed HTTP contract; fixture jobs demonstrate UI states without copying data. */
export function createProfileService(request: Request, fixture?: FixtureAccount, audit: Audit = () => {}, apiUrl: (path: string) => string = (path) => path) {
  let backups: SystemBackup[] = fixture ? seedBackups() : [];
  let schedule: BackupSchedule = { ...FIXTURE_SCHEDULE };
  const jobs = new Map<string, { job: BackupJob; polls: number; actor: string; cancelRequested: boolean }>();
  let activeJob: BackupJob | null = null;
  const superadmin = async () => {
    if ((await fixture!.profile()).role !== 'superadmin') throw new Error('Superadmin access is required.');
  };
  const start = async (kind: BackupJob['kind']): Promise<BackupJob> => {
    await superadmin();
    if (activeJob) throw new Error('Another backup or restore is already running.');
    const job: BackupJob = { id: crypto.randomUUID(), kind, status: 'queued', cancellable: true };
    jobs.set(job.id, { job, polls: 0, actor: (await fixture!.profile()).username, cancelRequested: false });
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
      return {
        items: structuredClone(backups), activeJob: activeJob ? { ...activeJob } : null,
        canDownload: true, canDelete: true, schedule: { ...schedule },
      };
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
      if (TERMINAL.includes(entry.job.status)) return { ...entry.job };
      entry.polls++;
      if (entry.cancelRequested) {
        entry.job.status = 'cancelled';
        entry.job.cancellable = false;
        activeJob = null;
        return { ...entry.job };
      }
      entry.job.status = entry.polls < 2 ? 'running' : 'succeeded';
      if (entry.job.status === 'succeeded') {
        if (entry.job.kind === 'backup') {
          backups.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: entry.actor, sizeBytes: 204800, scope: 'Demo campus data', status: 'ready' });
          // Retention removes archives whoever made them, so each removal is audited like a delete.
          for (const removed of backups.slice(schedule.keep)) audit('Deleted Backup (retention)', removed.createdAt);
          backups = backups.slice(0, schedule.keep);
        }
        entry.job.cancellable = false;
        activeJob = null;
      }
      return { ...entry.job };
    },
    /** Asks the server to stop a job. It stops asynchronously, so callers keep polling for the terminal status. */
    cancelJob: async (id: string): Promise<BackupJob> => {
      if (!fixture) return jobSchema.parse(await request(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }));
      await superadmin();
      const entry = jobs.get(id);
      if (!entry) throw new Error('Job was not found.');
      if (!TERMINAL.includes(entry.job.status)) {
        entry.cancelRequested = true;
        audit(entry.job.kind === 'backup' ? 'Cancelled Backup' : 'Cancelled Restore', 'Demo campus data');
      }
      return { ...entry.job };
    },
    download: async (id: string, password: string): Promise<BackupDownload> => {
      if (!fixture) {
        const link = downloadSchema.parse(await request(`/api/backups/${encodeURIComponent(id)}/download`, {
          method: 'POST', body: JSON.stringify({ currentPassword: password }),
        }));
        return { ...link, url: link.url.startsWith('/') ? apiUrl(link.url) : link.url };
      }
      await superadmin();
      await fixture.confirmPassword(password);
      const backup = backups.find((item) => item.id === id && item.status === 'ready');
      if (!backup) throw new Error('Backup is unavailable.');
      const file = new Blob([`ISU Camp backup ${backup.id}\nDEMO FILE: the fixture holds no real data, so this is not a database backup.\n`], { type: 'text/plain' });
      const url = URL.createObjectURL(file);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      audit('Downloaded Backup', backup.createdAt);
      return { url, expiresAt: new Date(Date.now() + 60_000).toISOString(), filename: `isu-camp-backup-DEMO-${backup.id}.txt` };
    },
    remove: async (id: string): Promise<void> => {
      if (!fixture) { await request(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }); return; }
      await superadmin();
      // The prompt confirms the password first; the server refuses a delete once that confirmation lapses.
      if (!fixture.recentlyConfirmed()) throw new PasswordConfirmationRequiredError();
      if (activeJob) throw new Error('Another backup or restore is already running.');
      const backup = backups.find((item) => item.id === id);
      if (!backup) throw new Error('Backup is unavailable.');
      backups = backups.filter((item) => item.id !== id);
      audit('Deleted Backup', backup.createdAt);
    },
    saveSchedule: async (next: BackupSchedule): Promise<BackupSchedule> => {
      if (!fixture) return scheduleSchema.parse(await request('/api/backups/schedule', { method: 'PUT', body: JSON.stringify(next) }));
      await superadmin();
      const result = scheduleSchema.safeParse(next);
      if (!result.success) throw new Error('Enter a valid time and keep at least one backup.');
      schedule = result.data;
      audit('Changed Backup Schedule', schedule.enabled ? `${schedule.frequency} at ${schedule.time}, keep ${schedule.keep}` : 'Automatic backups off');
      return { ...schedule };
    },
  };
}
