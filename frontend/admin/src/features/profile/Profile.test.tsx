import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { services } from '../../services/api';

beforeEach(async () => { await services.auth.login('admin_justine', 'password123'); });
afterEach(() => vi.restoreAllMocks());
function page() { render(<MemoryRouter initialEntries={['/profile']}><App /></MemoryRouter>); }

async function rename(value: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));
  const username = screen.getByLabelText('Username');
  await userEvent.clear(username);
  await userEvent.type(username, value);
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
}

it('edits the own profile in a dialog and updates the shell identity', async () => {
  page();
  await rename('justine.updated');
  await waitFor(() => expect(screen.getByRole('link', { name: /Open profile.*justine.updated/i })).toBeInTheDocument());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'justine.updated' })).toBeInTheDocument();
  expect(screen.getByText('Your profile was updated successfully.')).toBeInTheDocument();
  // Return fixture identity for independent tests.
  await rename('admin_justine');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'admin_justine' })).toBeInTheDocument());
});

it('does not expose backup actions without a superadmin role', async () => {
  vi.spyOn(services.auth, 'me').mockResolvedValue({ id: 'local-admin', username: 'admin_justine' });
  page();
  await screen.findByRole('button', { name: 'Edit Profile' });
  expect(screen.queryByRole('button', { name: /Create Backup/ })).not.toBeInTheDocument();
});

it('requires matching passwords before submitting a change', async () => {
  page();
  await userEvent.click(await screen.findByRole('button', { name: 'Change Password' }));
  await userEvent.type(screen.getByLabelText('Current password'), 'password123');
  await userEvent.type(screen.getByLabelText('New password'), 'Newpassword123!');
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'Different123!');
  await userEvent.click(screen.getByRole('button', { name: 'Update Password' }));
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

describe('change password rules', () => {
  const rule = (state: 'Met' | 'Not met', label: string) => within(screen.getByRole('list', { name: 'Password requirements' })).getByRole('listitem', { name: `${state}: ${label}` });
  async function openDialog() {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'Change Password' }));
  }
  async function submit(newPassword: string, confirmation = newPassword) {
    await userEvent.type(screen.getByLabelText('Current password'), 'password123');
    await userEvent.type(screen.getByLabelText('New password'), newPassword);
    await userEvent.type(screen.getByLabelText('Confirm new password'), confirmation);
    await userEvent.click(screen.getByRole('button', { name: 'Update Password' }));
  }

  it('shows the shared live checklist under the new password in place of the length hint', async () => {
    await openDialog();
    expect(screen.queryByText('At least 8 characters.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Password requirements' })).getAllByRole('listitem')).toHaveLength(5);
    rule('Not met', 'At least 8 characters');
    await userEvent.type(screen.getByLabelText('New password'), 'Abc1');
    rule('Not met', 'At least 8 characters');
    rule('Met', 'An uppercase letter');
    rule('Met', 'A lowercase letter');
    rule('Met', 'A number');
    rule('Not met', 'A symbol');
    await userEvent.type(screen.getByLabelText('New password'), 'defg!');
    for (const label of ['At least 8 characters', 'An uppercase letter', 'A lowercase letter', 'A number', 'A symbol']) rule('Met', label);
  });

  it.each([
    ['Abcde1!', 'Password must be at least 8 characters.'],
    ['abcdefg1!', 'Password must include an uppercase letter.'],
    ['ABCDEFG1!', 'Password must include a lowercase letter.'],
    ['Abcdefgh!', 'Password must include a number.'],
    ['Abcdefg12', 'Password must include a symbol.'],
  ])('refuses %s with the first unmet rule and does not send it', async (password, message) => {
    const changePassword = vi.spyOn(services.profile, 'changePassword');
    await openDialog();
    await submit(password);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(changePassword).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports only the first unmet rule when several fail', async () => {
    await openDialog();
    await submit('abc');
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.queryByText('Password must include an uppercase letter.')).not.toBeInTheDocument();
  });

  it('sends a password that meets every rule and closes the dialog', async () => {
    // Stubbed so the shared fixture account keeps its sign-in for the other tests.
    const changePassword = vi.spyOn(services.profile, 'changePassword').mockResolvedValue(undefined);
    await openDialog();
    await submit('Abcdef1!');
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'password123', newPassword: 'Abcdef1!' }));
    expect(await screen.findByText('Your password was updated successfully.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

it('signs out from the profile after confirmation', async () => {
  const logout = vi.spyOn(services.auth, 'logout');
  page();
  await userEvent.click(await screen.findByRole('button', { name: 'Sign Out' }));
  expect(screen.getByRole('dialog', { name: 'Sign out?' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(logout).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign Out' }));
  await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'My Profile' })).not.toBeInTheDocument());
});

it('reveals password fields while the show passwords checkbox is checked', async () => {
  page();
  await userEvent.click(await screen.findByRole('button', { name: 'Change Password' }));
  expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Show passwords' }));
  expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'text');
  expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
  expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'text');
});

it('shows fixture backup history and requires explicit restore confirmation', async () => {
  page();
  expect(await screen.findByText(/Fixture demo/)).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: /Create Backup/ }));
  const restore = await screen.findByRole('button', { name: /Restore backup from/ });
  await userEvent.click(restore);
  expect(screen.getByRole('dialog')).toHaveTextContent('replaces');
  expect(screen.getByRole('dialog')).toHaveTextContent('may be lost');
  const confirm = screen.getByRole('button', { name: 'Restore Backup' });
  expect(confirm).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Type RESTORE to confirm'), 'RESTORE');
  await userEvent.type(screen.getByLabelText('Your password'), 'incorrect');
  await userEvent.click(confirm);
  expect(await screen.findByRole('alert')).toHaveTextContent(/Password is incorrect/);
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('keeps profile edits when a server save fails', async () => {
  vi.spyOn(services.profile, 'update').mockRejectedValue(new Error('Username is already taken.'));
  page();
  await rename('taken');
  expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken.');
  expect(screen.getByLabelText('Username')).toHaveValue('taken');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open profile for admin_justine/i })).toBeInTheDocument();
});

it('displays failed backup jobs without claiming completion', async () => {
  vi.spyOn(services.profile, 'createBackup').mockResolvedValue({ id: 'failed-job', kind: 'backup', status: 'failed', message: 'Storage is unavailable.' });
  page();
  await userEvent.click(await screen.findByRole('button', { name: /Create Backup/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage is unavailable.');
  expect(screen.queryByText(/completed|successfully/)).not.toBeInTheDocument();
});

it('refreshes completed backup history even when the HTTP response arrives later', async () => {
  let resolveHistory!: (value: { items: { id: string; createdAt: string; createdBy: string; sizeBytes: number; scope: string; status: 'ready' }[]; activeJob: null }) => void;
  vi.spyOn(services.profile, 'history').mockResolvedValueOnce({ items: [], activeJob: null })
    .mockImplementationOnce(() => new Promise((resolve) => { resolveHistory = resolve; }));
  vi.spyOn(services.profile, 'createBackup').mockResolvedValue({ id: 'slow-job', kind: 'backup', status: 'queued' });
  vi.spyOn(services.profile, 'job').mockResolvedValue({ id: 'slow-job', kind: 'backup', status: 'succeeded' });
  page();
  await userEvent.click(await screen.findByRole('button', { name: /Create Backup/ }));
  await screen.findByText('Demo operation completed. No server data was changed.');
  await waitFor(() => expect(resolveHistory).toBeTypeOf('function'));
  resolveHistory({ items: [{ id: 'slow-backup', createdAt: '2026-10-09T02:00:00Z', createdBy: 'backend.operator', sizeBytes: 1024, scope: 'Campus data', status: 'ready' }], activeJob: null });
  expect(await screen.findByText('backend.operator')).toBeInTheDocument();
});

it('locks background backup actions and retains focus while restore submission is pending', async () => {
  vi.spyOn(services.profile, 'history').mockResolvedValue({ items: [{ id: 'restore-1', createdAt: '2026-10-09T02:00:00Z', createdBy: 'operator', sizeBytes: 1024, scope: 'Campus data', status: 'ready' }], activeJob: null });
  vi.spyOn(services.profile, 'restore').mockImplementation(() => new Promise(() => {}));
  page();
  await userEvent.click(await screen.findByRole('button', { name: /Restore backup from/ }));
  await userEvent.type(screen.getByLabelText('Type RESTORE to confirm'), 'RESTORE');
  await userEvent.type(screen.getByLabelText('Your password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Restore Backup' }));
  expect(screen.getByRole('button', { name: /Create Backup/ })).toBeDisabled();
  await userEvent.tab();
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('focuses the edit dialog, keeps Tab inside it, and returns focus on close', async () => {
  page();
  const trigger = await screen.findByRole('button', { name: 'Edit Profile' });
  await userEvent.click(trigger);
  expect(screen.getByLabelText('Username')).toHaveFocus();
  await userEvent.tab({ shift: true });
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

describe('alternative email', () => {
  const PRIMARY = 'admin@isu.edu.ph';
  // The fixture account is shared by every test in this file, so put it back.
  afterEach(async () => {
    vi.restoreAllMocks();
    await services.auth.login('admin_justine', 'password123');
    await services.profile.update({ username: 'admin_justine', email: PRIMARY, alternativeEmail: null, currentPassword: 'password123' });
  });
  const openDialog = async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));
  };
  const type = async (label: string, value: string) => {
    const field = screen.getByLabelText(label);
    await userEvent.clear(field);
    if (value) await userEvent.type(field, value);
  };
  const save = () => userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  it('offers the optional alternative email with its helper, and no password until an email changes', async () => {
    await openDialog();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary email')).toHaveValue(PRIMARY);
    expect(screen.getByLabelText('Alternative email')).toHaveValue('');
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByText('Password reset codes are sent here.')).toBeInTheDocument();
    expect(screen.getByText('Used for account recovery if you lose access to your primary email.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await type('Username', 'justine.only.renamed');
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await type('Alternative email', 'justine.home@gmail.com');
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByText('Changing an email address needs your password.')).toBeInTheDocument();
    await type('Alternative email', '');
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await type('Primary email', 'other@isu.edu.ph');
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('saves an alternative email with the password and shows it under the primary on the card', async () => {
    const update = vi.spyOn(services.profile, 'update');
    await openDialog();
    await type('Alternative email', 'justine.home@gmail.com');
    await type('Current password', 'password123');
    await save();
    expect(await screen.findByText('Alternative: justine.home@gmail.com')).toBeInTheDocument();
    expect(update).toHaveBeenCalledWith({ username: 'admin_justine', email: PRIMARY, alternativeEmail: 'justine.home@gmail.com', currentPassword: 'password123' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Your profile was updated successfully.')).toBeInTheDocument();
  });

  it('clears the alternative email by emptying the field', async () => {
    await services.profile.update({ username: 'admin_justine', email: PRIMARY, alternativeEmail: 'justine.home@gmail.com', currentPassword: 'password123' });
    await openDialog();
    expect(screen.getByLabelText('Alternative email')).toHaveValue('justine.home@gmail.com');
    await type('Alternative email', '');
    await type('Current password', 'password123');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/Alternative:/)).not.toBeInTheDocument();
  });

  it('shows a wrong password under the password field and keeps the dialog open', async () => {
    await openDialog();
    await type('Alternative email', 'justine.home@gmail.com');
    await type('Current password', 'wrong');
    await save();
    expect(await screen.findByText('Your current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Editing the field retires its message.
    await userEvent.type(screen.getByLabelText('Current password'), '1');
    expect(screen.queryByText('Your current password is incorrect')).not.toBeInTheDocument();
  });

  it.each([
    ['Primary email', 'DEAN.admin@isu.edu.ph'],
    ['Alternative email', 'dean.backup@gmail.com'],
  ])('shows an address another administrator holds under the %s field', async (label, taken) => {
    await openDialog();
    await type(label, taken);
    await type('Current password', 'password123');
    await save();
    const message = await screen.findByText('That email address is already in use');
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    expect(message).toBe(screen.getByLabelText(label).closest('.field-group')!.querySelector('.field-error-msg'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses an alternative equal to the primary, ignoring case', async () => {
    await openDialog();
    await type('Alternative email', PRIMARY.toUpperCase());
    await type('Current password', 'password123');
    await save();
    expect(await screen.findByText('Use a different address from your primary email')).toBeInTheDocument();
    expect(screen.getByLabelText('Alternative email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a taken username under the username field', async () => {
    await openDialog();
    await type('Username', 'admin_dean');
    await save();
    expect(await screen.findByText('That username is already taken')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows an invalid address under its field', async () => {
    await openDialog();
    await type('Alternative email', 'nope');
    await type('Current password', 'password123');
    await save();
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('hides the alternative email, and the password it would need, when the server does not report it', async () => {
    vi.spyOn(services.profile, 'get').mockResolvedValue({ id: '1', username: 'admin_justine', email: PRIMARY, role: 'superadmin' });
    const update = vi.spyOn(services.profile, 'update').mockResolvedValue({ id: '1', username: 'admin_justine', email: 'new@isu.edu.ph', role: 'superadmin' });
    await openDialog();
    expect(screen.queryByLabelText('Alternative email')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue(PRIMARY);
    await type('Email', 'new@isu.edu.ph');
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await save();
    await waitFor(() => expect(update).toHaveBeenCalledWith({ username: 'admin_justine', email: 'new@isu.edu.ph' }));
  });

  it('shows a refusal that names no field in the dialog banner', async () => {
    vi.spyOn(services.profile, 'update').mockRejectedValue(new Error('Failed to update your profile.'));
    await openDialog();
    await type('Username', 'someone');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to update your profile.');
  });
});
