import { FormEvent, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, LoadingState, Modal } from '../../components/UI';
import { formatDateTime } from '../../lib/format';
import { services } from '../../services/api';
import type { BackupJob, SystemBackup } from '../../services/profile';
import { DialogFocus } from './DialogFocus';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to complete the request. Try again.';
const pending = (job: BackupJob | null) => job?.status === 'queued' || job?.status === 'running';
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** Superadmin backups; `onSuccess` reports completed operations through the page's feedback stack. */
export function BackupRecovery({ onSuccess }: { onSuccess: (text: string) => void }) {
  const [items, setItems] = useState<SystemBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [job, setJob] = useState<BackupJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SystemBackup | null>(null);
  const [retry, setRetry] = useState(0);
  const [pollError, setPollError] = useState('');
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    services.profile.history().then((history) => {
      if (live) { setItems(history.items); setJob(history.activeJob ?? null); }
    }).catch((cause) => { if (live) setError(message(cause)); })
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
      } catch (cause) { if (live) setPollError(`Unable to check the operation status: ${message(cause)} It may still be running.`); }
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
    onSuccess(services.profile.isFixture ? 'Demo operation completed. No server data was changed.'
      : completedKind === 'restore' ? 'Data was restored successfully.' : 'Backup was created successfully.');
    services.profile.history().then((history) => { if (live) setItems(history.items); })
      .catch((cause) => { if (live) setError(`Backup history could not be refreshed: ${message(cause)}`); });
    return () => { live = false; };
  }, [completedJobId, completedKind, onSuccess]);
  const create = async () => {
    if (busy || pending(job)) return;
    setBusy(true); setError('');
    try { setJob(await services.profile.createBackup()); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  const locked = busy || pending(job) || selected !== null;
  return <Card className="table-card profile-backups" role="region" aria-labelledby="backup-heading">
    <div className="table-heading">
      <div><h2 id="backup-heading">Backup & Recovery</h2>
        <p>{services.profile.isFixture ? 'Fixture demo: backups and restores are simulated.' : 'Server backups you can restore from.'}</p></div>
      <Button onClick={create} loading={busy} disabled={loading || !!error || locked}>＋ Create Backup</Button>
    </div>
    {pending(job) && <div className="profile-job"><LoadingState>{job!.kind === 'backup' ? 'Creating backup' : 'Restoring data'} · {job!.status === 'queued' ? 'Queued' : 'In progress'}…</LoadingState></div>}
    {job?.status === 'failed' && <div role="alert" className="admin-table-error">{job.message || 'The operation failed. Try again.'}</div>}
    {pollError && <div role="alert" className="admin-table-error profile-inline-error">{pollError}<Button variant="subtle" onClick={() => setRetry((n) => n + 1)}>Check Status</Button></div>}
    {error && <div role="alert" className="admin-table-error profile-inline-error">{error}<Button variant="subtle" onClick={() => setRetry((n) => n + 1)}>Retry</Button></div>}
    {loading ? <LoadingState size={20}>Loading backups…</LoadingState> : !error && <div className="table-wrap">
      <table>
        <thead><tr><th>Created</th><th>Created By</th><th>Data Included</th><th>Size</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
        <tbody>{items.map((backup) => <tr key={backup.id}>
          <td><time dateTime={backup.createdAt}>{formatDateTime(backup.createdAt)}</time></td>
          <td><strong>{backup.createdBy}</strong></td>
          <td>{backup.scope}</td>
          <td>{size(backup.sizeBytes)}</td>
          <td><Badge tone={backup.status === 'ready' ? 'green' : 'grey'}>{backup.status === 'ready' ? 'Ready' : 'Failed'}</Badge></td>
          <td style={{ textAlign: 'right' }}><Button variant="subtle" disabled={locked || backup.status !== 'ready'} aria-label={`Restore backup from ${formatDateTime(backup.createdAt)}`} onClick={() => setSelected(backup)}>Restore</Button></td>
        </tr>)}</tbody>
      </table>
      {!items.length && <Empty>No backups yet.</Empty>}
    </div>}
    {selected && <RestoreConfirmation backup={selected} onClose={() => setSelected(null)} onStarted={(value) => { setJob(value); setSelected(null); }} />}
  </Card>;
}

function RestoreConfirmation({ backup, onClose, onStarted }: { backup: SystemBackup; onClose: () => void; onStarted: (job: BackupJob) => void }) {
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || confirmation !== 'RESTORE' || !password) return;
    setBusy(true); setError('');
    try { onStarted(await services.profile.restore(backup.id, password)); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  };
  return <DialogFocus busy={busy}>
    <Modal title="Restore this backup?" subtitle={`Created ${formatDateTime(backup.createdAt)} by ${backup.createdBy}`} size="sm" variant="danger" onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="admin-form" aria-busy={busy}>
        <p className="admin-remove-copy">This replaces {backup.scope} with this backup. Changes made after it was created may be lost.</p>
        {error && <div role="alert" className="admin-form-error">{error}</div>}
        <Field label="TYPE RESTORE TO CONFIRM" aria-label="Type RESTORE to confirm" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} required />
        <Field label="YOUR PASSWORD" aria-label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
        <div className="modal-actions">
          <Button variant="subtle" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={confirmation !== 'RESTORE' || !password}>Restore Backup</Button>
        </div>
      </form>
    </Modal>
  </DialogFocus>;
}
