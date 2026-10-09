import { FormEvent, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, LoadingState, Modal } from '../../components/UI';
import { FeedbackStack, useFeedback } from '../../components/Feedback';
import { PageIcon } from '../../components/PageIcon';
import { services } from '../../services/api';
import type { AccountProfile } from '../../services/profile';
import { useAuth } from '../auth/AuthContext';
import { BackupRecovery } from './BackupRecovery';
import { DialogFocus } from './DialogFocus';
import profileIcon from '../../assets/figma/navigation/profile-user.svg';
import './profile.css';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
const roleLabel = (role: AccountProfile['role']) => role === 'superadmin' ? 'Superadmin' : 'Administrator';

export function Profile() {
  const { session, updateSession } = useAuth();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<'details' | 'password' | null>(null);
  const feedback = useFeedback();
  useEffect(() => {
    let live = true;
    setLoadError('');
    services.profile.get().then((value) => { if (live) setProfile(value); })
      .catch((cause) => { if (live) setLoadError(errorText(cause)); });
    return () => { live = false; };
  }, [attempt]);
  return <div className="page profile-page">
    <FeedbackStack messages={feedback.messages} onDismiss={feedback.dismiss} />
    <div className="page-hero"><PageIcon name="profile" /><div><h1>My Profile</h1><p>Your account and sign-in details.</p></div></div>
    {loadError ? <Card className="profile-unavailable"><div role="alert" className="admin-form-error">{loadError}</div><Button variant="subtle" onClick={() => setAttempt((n) => n + 1)}>Retry</Button></Card>
      : !profile ? <LoadingState>Loading your profile…</LoadingState> : <div className="stack">
      <Card className="profile-account">
        <div className="profile-identity">
          <div className="profile-avatar"><img src={profileIcon} alt="" /></div>
          <div className="profile-identity-copy"><h2>{profile.username}</h2><p>{profile.email}</p></div>
          <Badge tone={profile.role === 'superadmin' ? 'green' : 'grey'}>{roleLabel(profile.role)}</Badge>
        </div>
        <div className="profile-actions">
          <Button variant="subtle" onClick={() => setDialog('password')}>Change Password</Button>
          <Button onClick={() => setDialog('details')}>Edit Profile</Button>
        </div>
      </Card>
      {session?.role === 'superadmin' && profile.role === 'superadmin' && <BackupRecovery onSuccess={feedback.reportSuccess} />}
    </div>}
    {dialog === 'details' && profile && <DetailsDialog profile={profile} onClose={() => setDialog(null)} onSaved={(updated) => {
      setProfile(updated); updateSession(updated); setDialog(null);
      feedback.reportSuccess('Your profile was updated successfully.');
    }} />}
    {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} onChanged={() => {
      setDialog(null);
      feedback.reportSuccess('Your password was updated successfully.');
    }} />}
  </div>;
}

function DetailsDialog({ profile, onClose, onSaved }: { profile: AccountProfile; onClose: () => void; onSaved: (profile: AccountProfile) => void }) {
  const [username, setUsername] = useState(profile.username);
  const [email, setEmail] = useState(profile.email);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const unchanged = username.trim() === profile.username && email.trim() === profile.email;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || unchanged) return;
    setError(''); setSaving(true);
    try { onSaved(await services.profile.update({ username: username.trim(), email: email.trim() })); }
    catch (cause) { setError(errorText(cause)); setSaving(false); }
  };
  return <DialogFocus busy={saving}><Modal title="Edit Profile" size="sm" onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={save} className="admin-form">
      {error && <div role="alert" className="admin-form-error">{error}</div>}
      <Field label="USERNAME" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" maxLength={100} disabled={saving} />
      <Field label="EMAIL" aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" maxLength={254} disabled={saving} subhelper="Password reset codes are sent here." />
      <div className="modal-actions">
        <Button type="button" variant="subtle" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={saving} disabled={!username.trim() || !email.trim() || unchanged}>Save Changes</Button>
      </div>
    </form>
  </Modal></DialogFocus>;
}

function PasswordDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState('');
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (changing) return;
    setError(''); setMismatch('');
    if (newPassword !== confirmPassword) { setMismatch('Passwords do not match.'); return; }
    if (newPassword === currentPassword) { setError('Choose a different new password.'); return; }
    setChanging(true);
    try { await services.profile.changePassword({ currentPassword, newPassword }); onChanged(); }
    catch (cause) { setError(errorText(cause)); setChanging(false); }
  };
  return <DialogFocus busy={changing}><Modal title="Change Password" size="sm" onClose={() => { if (!changing) onClose(); }}>
    <form onSubmit={submit} className="admin-form">
      {error && <div role="alert" className="admin-form-error">{error}</div>}
      <Field label="CURRENT PASSWORD" aria-label="Current password" type={showPasswords ? 'text' : 'password'} autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={changing} />
      <Field label="NEW PASSWORD" aria-label="New password" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" required minLength={8} subhelper="At least 8 characters." value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={changing} />
      <Field label="CONFIRM NEW PASSWORD" aria-label="Confirm new password" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" required minLength={8} error={mismatch} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={changing} />
      <label className="profile-show-password"><input type="checkbox" checked={showPasswords} disabled={changing} onChange={(e) => setShowPasswords(e.target.checked)} />Show passwords</label>
      <div className="modal-actions">
        <Button type="button" variant="subtle" disabled={changing} onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={changing}>Update Password</Button>
      </div>
    </form>
  </Modal></DialogFocus>;
}
