import { FormEvent, useState } from 'react';
import { Button, Field, Modal } from '../../components/UI';
import { formatDateTime } from '../../lib/format';
import { services } from '../../services/api';
import type { BackupDownload, BackupJob, SystemBackup } from '../../services/profile';
import { DELETE_CONFIRMATION_WORDING, PasswordConfirmationField, usePasswordConfirmation } from '../auth/PasswordConfirmation';
import { origin, sizeText } from './backupFormat';
import { DialogFocus, type FocusReturn } from './DialogFocus';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Unable to complete the request. Try again.';
const BACKUP_DELETE_WORDING = { ...DELETE_CONFIRMATION_WORDING, expired: 'Your password confirmation expired. Enter it again to delete this backup.' };
const subtitle = (backup: SystemBackup) => `Created ${formatDateTime(backup.createdAt)} by ${origin(backup)}`;

/** Hands the one-time link to the browser, whose download manager takes over from here. */
function startDownload(link: BackupDownload) {
  const anchor = document.createElement('a');
  anchor.href = link.url;
  if (link.filename) anchor.download = link.filename;
  anchor.click();
}

export function DownloadDialog({ backup, returnTo, onClose, onStarted }: { backup: SystemBackup; returnTo: FocusReturn; onClose: () => void; onStarted: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true); setError('');
    try { startDownload(await services.profile.download(backup.id, password)); onStarted(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  };
  return <DialogFocus busy={busy} returnTo={returnTo}>
    <Modal title="Download this backup?" subtitle={`${subtitle(backup)} · ${sizeText(backup.sizeBytes)}`} size="sm" onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="admin-form" aria-busy={busy}>
        <p className="profile-warning">This file is a complete copy of the database, including administrator password hashes. Store it securely.</p>
        {error && <div role="alert" className="admin-form-error">{error}</div>}
        <Field label="YOUR PASSWORD" aria-label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
        <div className="modal-actions">
          <Button variant="subtle" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!password}>Download</Button>
        </div>
      </form>
    </Modal>
  </DialogFocus>;
}

export function RestoreDialog({ backup, returnTo, onClose, onStarted }: { backup: SystemBackup; returnTo: FocusReturn; onClose: () => void; onStarted: (job: BackupJob) => void }) {
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
  return <DialogFocus busy={busy} returnTo={returnTo}>
    <Modal title="Restore this backup?" subtitle={subtitle(backup)} size="sm" variant="danger" onClose={() => { if (!busy) onClose(); }}>
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

export function DeleteDialog({ backup, returnTo, onlyRestorable, onClose, onDeleted }: { backup: SystemBackup; returnTo: FocusReturn; onlyRestorable: boolean; onClose: () => void; onDeleted: () => void }) {
  const confirmation = usePasswordConfirmation(BACKUP_DELETE_WORDING);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const busy = deleting || confirmation.confirming;
  const remove = async () => {
    if (busy) return;
    setError('');
    // A permanent delete is re-authenticated, like the other modules' deletes.
    if (!await confirmation.confirm()) return;
    setDeleting(true);
    try { await services.profile.remove(backup.id); onDeleted(); }
    catch (cause) { if (!confirmation.handleRejection(cause)) setError(message(cause)); setDeleting(false); }
  };
  return <DialogFocus busy={busy} returnTo={returnTo}>
    <Modal title="Delete this backup?" subtitle={`${subtitle(backup)} · ${backup.status === 'ready' ? sizeText(backup.sizeBytes) : 'Failed'}`} size="sm" variant="danger" onClose={() => { if (!busy) onClose(); }}>
      <div className="admin-form" aria-busy={busy}>
        <p className="admin-remove-copy">This backup will be permanently removed. This action cannot be undone.</p>
        {onlyRestorable && <p className="profile-warning">This is your only restorable backup.</p>}
        {error && <div role="alert" className="admin-form-error">{error}</div>}
        <PasswordConfirmationField confirmation={confirmation} disabled={deleting} onSubmit={() => void remove()} />
        <div className="modal-actions">
          <Button variant="subtle" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="danger" loading={busy} onClick={remove}>Delete Backup</Button>
        </div>
      </div>
    </Modal>
  </DialogFocus>;
}

/** Cancelling a restore is the one cancel that asks first. */
export function StopRestoreDialog({ returnTo, onClose, onStop }: { returnTo: FocusReturn; onClose: () => void; onStop: () => void }) {
  return <DialogFocus returnTo={returnTo}><Modal title="Stop the restore?" size="sm" variant="danger" onClose={onClose}>
    <div className="admin-form">
      <p className="admin-remove-copy">Stop the restore? The database stays exactly as it was before the restore started.</p>
      <div className="modal-actions">
        <Button variant="subtle" type="button" onClick={onClose}>Keep Restoring</Button>
        <Button variant="danger" type="button" onClick={onStop}>Stop Restore</Button>
      </div>
    </div>
  </Modal></DialogFocus>;
}
