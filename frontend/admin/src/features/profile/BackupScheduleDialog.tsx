import { FormEvent, useId, useState } from 'react';
import { Button, Field, Modal, SelectField } from '../../components/UI';
import { services } from '../../services/api';
import { errorMessage } from '../../services/errors';
import type { BackupSchedule } from '../../services/profile';
import { DAYS } from './backupFormat';
import { DialogFocus } from './DialogFocus';

/** The most backups the schedule keeps. The server sets no cap (its column is a 32-bit integer), so the portal holds the line. */
export const KEEP_MAX = 99;

export function ScheduleDialog({ initial, onClose, onSaved }: { initial: BackupSchedule; onClose: () => void; onSaved: (schedule: BackupSchedule) => void }) {
  const labelId = useId();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [frequency, setFrequency] = useState(initial.frequency);
  const [day, setDay] = useState(initial.day ?? 1);
  const [time, setTime] = useState(initial.time);
  const [keep, setKeep] = useState(String(initial.keep));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const keepCount = Number(keep);
  // A retention saved before the cap (e.g. 365) stays valid while unchanged, so editing only the time or day
  // never forces fewer backups; a changed value must be within 1..KEEP_MAX.
  const keepUnchanged = keep.trim() === String(initial.keep);
  const keepValid = /^\d+$/.test(keep.trim()) && keepCount >= 1 && (keepCount <= KEEP_MAX || keepUnchanged);
  const keepError = enabled && !keepValid ? `Enter a whole number from 1 to ${KEEP_MAX}.` : undefined;
  const valid = /^\d\d:\d\d$/.test(time) && keepValid;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || (enabled && !valid)) return;
    setSaving(true); setError('');
    // Hidden fields keep their saved values, so switching off never discards the schedule.
    const next: BackupSchedule = valid
      ? { enabled, frequency, day: frequency === 'weekly' ? day : null, time, timeZone: 'Asia/Manila', keep: keepCount }
      : { ...initial, enabled };
    try { onSaved(await services.profile.saveSchedule(next)); }
    catch (cause) { setError(errorMessage(cause, "The schedule couldn't be saved. Please try again.", { mutation: true })); setSaving(false); }
  };
  return <DialogFocus busy={saving}><Modal title="Automatic backups" size="sm" onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={save} className="admin-form" aria-busy={saving}>
      {error && <div role="alert" className="admin-form-error">{error}</div>}
      <div className="profile-switch-row">
        <div><strong id={labelId}>Back up automatically</strong><span>{enabled ? 'The server takes a backup on the schedule below.' : 'Only manual backups will be taken.'}</span></div>
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby={labelId} className="profile-switch" disabled={saving} onClick={() => setEnabled(!enabled)}><span /></button>
      </div>
      {enabled && <>
        <div className="profile-field-row">
          <SelectField label="FREQUENCY" aria-label="Frequency" value={frequency} disabled={saving} onChange={(e) => setFrequency(e.target.value as BackupSchedule['frequency'])}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
          </SelectField>
          {frequency === 'weekly' && <SelectField label="DAY" aria-label="Day of week" value={day} disabled={saving} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </SelectField>}
          <Field label="TIME" aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={saving} subhelper="Philippine time" required />
        </div>
        <Field label="BACKUPS TO KEEP" aria-label="Backups to keep" type="number" min={1} max={Math.max(KEEP_MAX, initial.keep)} value={keep} onChange={(e) => setKeep(e.target.value)} disabled={saving} subhelper="The newest backups are kept; older ones are deleted, including manual backups." error={keepError} required />
      </>}
      <div className="modal-actions">
        <Button type="button" variant="subtle" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={saving} disabled={enabled && !valid}>Save</Button>
      </div>
    </form>
  </Modal></DialogFocus>;
}
