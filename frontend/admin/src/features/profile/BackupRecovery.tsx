import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Empty, LoadingState } from '../../components/UI';
import { formatDateTime } from '../../lib/format';
import { services } from '../../services/api';
import { errorMessage, isTechnicalMessage, reportError } from '../../services/errors';
import type { BackupHistory, BackupJob, BackupSchedule, SystemBackup } from '../../services/profile';
import { isAutomatic, scheduleWhen, sizeText } from './backupFormat';
import { DeleteDialog, DownloadDialog, RestoreDialog, StopRestoreDialog } from './BackupDialogs';
import { ScheduleDialog } from './BackupScheduleDialog';
/** A job's own message when it is plain; the server appends raw exception text after a colon, which is replaced by a line for the kind of job. */
const jobFailureText = (job: BackupJob) => {
  const raw = job.message?.trim();
  if (raw && !/could not be (started|completed|recorded): /.test(raw) && !isTechnicalMessage(raw)) return raw;
  if (raw) reportError(raw);
  return job.kind === 'restore'
    ? "The restore couldn't be completed. Check the data before making changes, and try again."
    : "The backup couldn't be completed. Try again, or check the server logs if it keeps failing.";
};
const pending = (job: BackupJob | null) => job?.status === 'queued' || job?.status === 'running';
type Target = { action: 'download' | 'restore' | 'delete'; backup: SystemBackup };

/** Superadmin backups; `onSuccess` reports completed operations through the page's feedback stack. */
export function BackupRecovery({ onSuccess }: { onSuccess: (text: string) => void }) {
  const [items, setItems] = useState<SystemBackup[]>([]);
  const [capabilities, setCapabilities] = useState<Pick<BackupHistory, 'canDownload' | 'canDelete'>>({});
  const [schedule, setSchedule] = useState<BackupSchedule>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<BackupJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancelRequested, setCancelRequested] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pollError, setPollError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  // Async answers are checked against what is on screen now, and a cancel that lost its race is reported once.
  const jobRef = useRef(job);
  jobRef.current = job;
  const cancelAsked = useRef<string | null>(null);
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);
  const apply = (history: BackupHistory) => {
    setItems(history.items);
    setCapabilities({ canDownload: history.canDownload, canDelete: history.canDelete });
    setSchedule(history.schedule);
  };
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    services.profile.history().then((history) => {
      if (live) { apply(history); setJob(history.activeJob ?? null); }
    }).catch((cause) => { if (live) setError(errorMessage(cause, "Backups couldn't be loaded. Please try again.")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [retry]);
  const jobId = pending(job) ? job!.id : null;
  useEffect(() => {
    if (!jobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setPollError('');
    const poll = async () => {
      try {
        const result = await services.profile.job(jobId);
        if (!live) return;
        setJob(result);
        if (pending(result)) timer = setTimeout(poll, 1500);
      } catch (cause) { if (live) setPollError(`${errorMessage(cause, "We couldn't check the operation's status.")} It may still be running.`); }
    };
    timer = setTimeout(poll, 1000);
    return () => { live = false; clearTimeout(timer); };
  }, [jobId, retry]);
  // Terminal history refresh has its own lifetime; ending polling must not cancel it.
  const completedJobId = job?.status === 'succeeded' ? job.id : null;
  const completedKind = job?.kind;
  useEffect(() => {
    if (!completedJobId) return;
    let live = true;
    // A cancel that lost the race shows only "had already finished"; the history still refreshes.
    if (cancelAsked.current !== completedJobId) onSuccess(services.profile.isFixture ? 'Demo operation completed. No server data was changed.'
      : completedKind === 'restore' ? 'Data was restored successfully.' : 'Backup was created successfully.');
    services.profile.history().then((history) => { if (live) apply(history); })
      .catch((cause) => { if (live) setError(errorMessage(cause, "The backup history couldn't be refreshed. Reload the page to see the latest backups.")); });
    return () => { live = false; };
  }, [completedJobId, completedKind, onSuccess]);
  const create = async () => {
    if (busy || pending(job)) return;
    setBusy(true); setError('');
    try { setJob(await services.profile.createBackup()); }
    catch (cause) { setError(errorMessage(cause, "The backup couldn't be started. Please try again.", { mutation: true })); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!job || cancelRequested === job.id) return;
    const id = job.id;
    setStopping(false); setActionError(''); setCancelRequested(id); cancelAsked.current = id;
    // The answer may arrive after polling finished this job or the administrator started another.
    const stillPending = () => jobRef.current?.id === id && pending(jobRef.current);
    try {
      const result = await services.profile.cancelJob(id);
      // The job stops asynchronously; only a terminal answer replaces what polling already knows.
      if (stillPending() && !pending(result)) setJob(result);
    } catch (cause) {
      if (!stillPending()) return;
      setActionError(errorMessage(cause, "The operation couldn't be stopped. Please try again.", { mutation: true })); setCancelRequested(null); cancelAsked.current = null;
    }
  };
  // Where focus lands when a dialog closes: the row's menu button, else whatever still stands.
  const focusTargets = (backupId?: string) => () => [
    backupId ? Array.from(document.querySelectorAll<HTMLElement>('[data-backup-trigger]')).find((trigger) => trigger.dataset.backupTrigger === backupId) : null,
    document.querySelector<HTMLElement>('[data-job-cancel]'),
    document.querySelector<HTMLElement>('[data-create-backup]'),
    document.getElementById('backup-heading'),
  ];
  const open = (action: Target['action'], backup: SystemBackup) => { setMenuId(null); setTarget({ action, backup }); };
  const active = pending(job);
  const cancelling = active && cancelRequested === job!.id;
  const locked = busy || active;
  const readyCount = items.filter((backup) => backup.status === 'ready').length;
  // A cancelled run leaves no history row, so it is reported here; a cancel that lost the race says so.
  const outcome = job?.status === 'cancelled' ? (job.kind === 'backup' ? 'Backup cancelled.' : 'Restore cancelled; no data was changed.')
    : job?.status === 'succeeded' && cancelRequested === job.id ? `The ${job.kind} had already finished.` : '';
  const scheduleSummary = !schedule?.enabled ? 'Automatic backups are off' : `Automatic backups: ${scheduleWhen(schedule)} · keeps ${schedule.keep}`;
  // A flag the server did not send hides its control; Download and Restore need a ready archive.
  const rowActions = (backup: SystemBackup) => {
    const ready = backup.status === 'ready';
    const actions: { action: Target['action']; label: string }[] = [];
    if (ready && capabilities.canDownload) actions.push({ action: 'download', label: 'Download' });
    if (ready) actions.push({ action: 'restore', label: 'Restore' });
    if (capabilities.canDelete) actions.push({ action: 'delete', label: 'Delete' });
    return actions;
  };
  return <Card className="table-card profile-backups" style={{ overflow: 'visible' }} role="region" aria-labelledby="backup-heading">
    <div className="table-heading">
      <div><h2 id="backup-heading" tabIndex={-1}>Backup & Recovery</h2>
        <p>{services.profile.isFixture ? 'Fixture demo: backups and restores are simulated.' : 'Server backups you can restore from.'}</p></div>
      <div className="profile-heading-actions">
        {schedule && <Button variant="subtle" disabled={loading} aria-label={`${scheduleSummary}. Edit schedule`} title={scheduleSummary} onClick={() => setEditingSchedule(true)}>
          <span className={schedule.enabled ? 'profile-dot on' : 'profile-dot'} aria-hidden="true" />
          {schedule.enabled ? `Auto · ${scheduleWhen(schedule)}` : 'Auto backups off'}
        </Button>}
        <Button data-create-backup onClick={create} loading={busy} disabled={loading || !!error || locked || target !== null}>＋ Create Backup</Button>
      </div>
    </div>
    {active && <div className="profile-job">
      <LoadingState>{job!.kind === 'backup' ? 'Creating backup' : 'Restoring data'} · {cancelling ? 'Cancelling' : job!.status === 'queued' ? 'Queued' : 'In progress'}…</LoadingState>
      {job!.cancellable && <Button variant="subtle" data-job-cancel disabled={cancelling} onClick={() => job!.kind === 'restore' ? setStopping(true) : void cancel()}>Cancel</Button>}
    </div>}
    {outcome && <div role="status" className="profile-notice">{outcome}</div>}
    {job?.status === 'failed' && <div role="alert" className="admin-table-error">{jobFailureText(job)}</div>}
    {actionError && <div role="alert" className="admin-table-error">{actionError}</div>}
    {pollError && <div role="alert" className="admin-table-error profile-inline-error">{pollError}<Button variant="subtle" onClick={() => setRetry((n) => n + 1)}>Check Status</Button></div>}
    {error && <div role="alert" className="admin-table-error profile-inline-error">{error}<Button variant="subtle" onClick={() => setRetry((n) => n + 1)}>Retry</Button></div>}
    {loading ? <LoadingState size={20}>Loading backups…</LoadingState> : !error && <div className="table-wrap" style={{ overflow: 'visible' }}>
      <table className="profile-backup-table">
        <colgroup><col style={{ width: '27%' }} /><col style={{ width: '25%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /></colgroup>
        <thead><tr><th>Created</th><th>Type</th><th>Size</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{items.map((backup) => {
          const actions = rowActions(backup);
          return <tr key={backup.id}>
            <td><time dateTime={backup.createdAt}>{formatDateTime(backup.createdAt)}</time></td>
            <td>{isAutomatic(backup) ? <Badge tone="green">Automatic</Badge> : <><Badge tone="grey">Manual</Badge> <span className="profile-muted">{backup.createdBy}</span></>}</td>
            <td>{backup.status === 'ready' ? sizeText(backup.sizeBytes) : '—'}</td>
            <td><Badge tone={backup.status === 'ready' ? 'green' : 'grey'}>{backup.status === 'ready' ? 'Ready' : 'Failed'}</Badge></td>
            <td style={{ position: 'relative' }}>
              {actions.length > 0 && <div style={{ display: 'inline-flex' }} ref={menuId === backup.id ? menuRef : undefined}>
                <button className="table-action menu-trigger" data-backup-trigger={backup.id} aria-label={`Actions for backup from ${formatDateTime(backup.createdAt)}`} aria-expanded={menuId === backup.id}
                  disabled={locked || target !== null} onClick={() => setMenuId((current) => current === backup.id ? null : backup.id)}>•••</button>
                {menuId === backup.id && <div className="row-action-menu" role="menu">
                  {actions.map((entry) => <button key={entry.action} role="menuitem" className={entry.action === 'delete' ? 'danger' : undefined} onClick={() => open(entry.action, backup)}>{entry.label}</button>)}
                </div>}
              </div>}
            </td>
          </tr>;
        })}</tbody>
      </table>
      {!items.length && <Empty>No backups yet.</Empty>}
    </div>}
    {target?.action === 'download' && <DownloadDialog backup={target.backup} returnTo={focusTargets(target.backup.id)} onClose={() => setTarget(null)}
      onStarted={() => { setTarget(null); onSuccess('Download started. The link works once and expires shortly.'); }} />}
    {target?.action === 'restore' && <RestoreDialog backup={target.backup} returnTo={focusTargets(target.backup.id)} onClose={() => setTarget(null)} onStarted={(started) => { setJob(started); setTarget(null); }} />}
    {target?.action === 'delete' && <DeleteDialog backup={target.backup} returnTo={focusTargets(target.backup.id)} onlyRestorable={target.backup.status === 'ready' && readyCount === 1} onClose={() => setTarget(null)}
      onDeleted={() => { setItems((list) => list.filter((backup) => backup.id !== target.backup.id)); setTarget(null); onSuccess('Backup was deleted successfully.'); }} />}
    {stopping && <StopRestoreDialog returnTo={focusTargets()} onClose={() => setStopping(false)} onStop={() => void cancel()} />}
    {editingSchedule && schedule && <ScheduleDialog initial={schedule} onClose={() => setEditingSchedule(false)}
      onSaved={(saved) => { setSchedule(saved); setEditingSchedule(false); onSuccess('Automatic backup settings saved.'); }} />}
  </Card>;
}
