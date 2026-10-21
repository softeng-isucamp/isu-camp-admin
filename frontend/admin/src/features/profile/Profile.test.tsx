import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { services } from '../../services/api';
import { PasswordConfirmationRequiredError } from '../../services/errors';

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
  await userEvent.click(await screen.findByRole('button', { name: /Actions for backup from/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
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
  await userEvent.click(await screen.findByRole('button', { name: /Actions for backup from/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
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

describe('backup & recovery', () => {
  type Backup = Awaited<ReturnType<typeof services.profile.history>>['items'][number];
  const READY: Backup = { id: 'b1', createdAt: '2026-10-09T02:00:00Z', createdBy: 'scheduled', sizeBytes: 5 * 1024 * 1024, scope: 'Campus data', status: 'ready' };
  const MANUAL: Backup = { ...READY, id: 'b2', createdAt: '2026-10-08T02:00:00Z', createdBy: 'operator' };
  const FAILED: Backup = { ...READY, id: 'b3', createdAt: '2026-10-07T02:00:00Z', sizeBytes: 0, status: 'failed' };
  const SCHEDULE = { enabled: true, frequency: 'daily', day: null, time: '02:30', timeZone: 'Asia/Manila', keep: 14 } as const;
  const history = (extra: Partial<Awaited<ReturnType<typeof services.profile.history>>> = {}) =>
    vi.spyOn(services.profile, 'history').mockResolvedValue({ items: [READY, MANUAL, FAILED], activeJob: null, canDownload: true, canDelete: true, schedule: SCHEDULE, ...extra });
  const row = async (index: number) => { await screen.findByRole('table'); return screen.getAllByRole('row')[index]; };
  const openMenu = async (index: number) => {
    await userEvent.click(within(await row(index)).getByRole('button', { name: /Actions for backup from/ }));
    return screen.getByRole('menu');
  };
  const menuLabels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((item) => item.textContent);

  it('shows the schedule beside Create Backup and no summary tiles', async () => {
    history();
    page();
    const button = await screen.findByRole('button', { name: 'Automatic backups: Daily at 2:30 AM · keeps 14. Edit schedule' });
    expect(button).toHaveTextContent('Auto · Daily at 2:30 AM');
    expect(button).toHaveAttribute('title', 'Automatic backups: Daily at 2:30 AM · keeps 14');
    expect(screen.getByRole('button', { name: /Create Backup/ })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Created', 'Type', 'Size', 'Status', 'Actions']);
  });

  it('words a weekly schedule and an off schedule', async () => {
    history({ schedule: { ...SCHEDULE, frequency: 'weekly', day: 1 } });
    page();
    expect(await screen.findByRole('button', { name: /Weekly on Monday at 2:30 AM/ })).toHaveTextContent('Auto · Weekly on Monday at 2:30 AM');
  });

  it('shows an off schedule without the run time', async () => {
    history({ schedule: { ...SCHEDULE, enabled: false } });
    page();
    expect(await screen.findByRole('button', { name: /Automatic backups are off/ })).toHaveTextContent('Auto backups off');
  });

  it('hides the schedule button when the server sends no schedule', async () => {
    history({ schedule: undefined });
    page();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Edit schedule/ })).not.toBeInTheDocument();
  });

  it('labels automatic and manual backups and hides the size of a failed one', async () => {
    history();
    page();
    const [automatic, manual, failed] = [await row(1), await row(2), await row(3)];
    expect(within(automatic).getByText('Automatic')).toBeInTheDocument();
    expect(within(manual).getByText('Manual')).toBeInTheDocument();
    expect(within(manual).getByText('operator')).toBeInTheDocument();
    expect(within(automatic).getByText('5.00 MB')).toBeInTheDocument();
    expect(within(failed).getAllByRole('cell')[2]).toHaveTextContent('—');
  });

  it('offers Download, Restore and Delete for a ready backup and only Delete for a failed one', async () => {
    history();
    page();
    expect(menuLabels(await openMenu(1))).toEqual(['Download', 'Restore', 'Delete']);
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' })).toHaveClass('danger');
    await userEvent.click(screen.getByText('Backup & Recovery'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(menuLabels(await openMenu(3))).toEqual(['Delete']);
  });

  it('hides Download and Delete when the server does not offer them', async () => {
    history({ canDownload: undefined, canDelete: undefined });
    page();
    expect(menuLabels(await openMenu(1))).toEqual(['Restore']);
    // A failed backup then has nothing to offer, so it has no menu.
    expect(within(await row(3)).queryByRole('button', { name: /Actions for backup/ })).not.toBeInTheDocument();
  });

  describe('schedule dialog', () => {
    it('saves a weekly schedule', async () => {
      history();
      const save = vi.spyOn(services.profile, 'saveSchedule').mockImplementation(async (next) => next);
      page();
      await userEvent.click(await screen.findByRole('button', { name: /Edit schedule/ }));
      const dialog = screen.getByRole('dialog', { name: 'Automatic backups' });
      expect(within(dialog).getByRole('switch', { name: 'Back up automatically' })).toBeChecked();
      expect(within(dialog).getByText('The server takes a backup on the schedule below.')).toBeInTheDocument();
      expect(within(dialog).queryByLabelText('Day of week')).not.toBeInTheDocument();
      expect(within(dialog).getByText('Philippine time')).toBeInTheDocument();
      expect(within(dialog).getByText('The newest backups are kept; older ones are deleted, including manual backups.')).toBeInTheDocument();
      await userEvent.selectOptions(within(dialog).getByLabelText('Frequency'), 'weekly');
      await userEvent.selectOptions(within(dialog).getByLabelText('Day of week'), 'Friday');
      await userEvent.clear(within(dialog).getByLabelText('Backups to keep'));
      await userEvent.type(within(dialog).getByLabelText('Backups to keep'), '7');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, frequency: 'weekly', day: 5, time: '02:30', timeZone: 'Asia/Manila', keep: 7 }));
      expect(await screen.findByRole('button', { name: /Weekly on Friday at 2:30 AM · keeps 7/ })).toBeInTheDocument();
      expect(screen.getByText('Automatic backup settings saved.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('hides the schedule fields while the switch is off and still saves the schedule', async () => {
      history();
      const save = vi.spyOn(services.profile, 'saveSchedule').mockImplementation(async (next) => next);
      page();
      await userEvent.click(await screen.findByRole('button', { name: /Edit schedule/ }));
      const dialog = screen.getByRole('dialog');
      await userEvent.click(within(dialog).getByRole('switch'));
      expect(within(dialog).getByRole('switch')).not.toBeChecked();
      expect(within(dialog).getByText('Only manual backups will be taken.')).toBeInTheDocument();
      for (const label of ['Frequency', 'Time', 'Backups to keep']) expect(within(dialog).queryByLabelText(label)).not.toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(save).toHaveBeenCalledWith({ ...SCHEDULE, enabled: false }));
      expect(await screen.findByRole('button', { name: /Automatic backups are off/ })).toHaveTextContent('Auto backups off');
    });

    it('refuses a keep count below one and keeps the dialog open when the save fails', async () => {
      history();
      vi.spyOn(services.profile, 'saveSchedule').mockRejectedValue(new Error('Schedule is unavailable.'));
      page();
      await userEvent.click(await screen.findByRole('button', { name: /Edit schedule/ }));
      const dialog = screen.getByRole('dialog');
      await userEvent.clear(within(dialog).getByLabelText('Backups to keep'));
      await userEvent.type(within(dialog).getByLabelText('Backups to keep'), '0');
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
      await userEvent.clear(within(dialog).getByLabelText('Backups to keep'));
      await userEvent.type(within(dialog).getByLabelText('Backups to keep'), '3');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Schedule is unavailable.');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('download', () => {
    it('warns about password hashes, needs the password, and hands the one-time link to the browser', async () => {
      history();
      const download = vi.spyOn(services.profile, 'download').mockResolvedValue({ url: '/downloads/once-1', expiresAt: '2026-10-09T02:05:00Z' });
      const clicked: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.href); });
      page();
      await openMenu(1);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
      const dialog = screen.getByRole('dialog', { name: 'Download this backup?' });
      expect(dialog).toHaveTextContent('This file is a complete copy of the database, including administrator password hashes. Store it securely.');
      const submit = within(dialog).getByRole('button', { name: 'Download' });
      expect(submit).toBeDisabled();
      await userEvent.type(within(dialog).getByLabelText('Your password'), 'password123');
      await userEvent.click(submit);
      await waitFor(() => expect(download).toHaveBeenCalledWith('b1', 'password123'));
      expect(clicked).toHaveLength(1);
      expect(clicked[0]).toContain('/downloads/once-1');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the dialog open and does not navigate when the password is refused', async () => {
      history();
      vi.spyOn(services.profile, 'download').mockRejectedValue(new Error('Password is incorrect'));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      page();
      await openMenu(1);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
      await userEvent.type(screen.getByLabelText('Your password'), 'nope');
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect');
      expect(click).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const openDelete = async (index: number) => {
      await openMenu(index);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      return screen.getByRole('dialog', { name: 'Delete this backup?' });
    };

    it('re-authenticates before deleting and removes the row', async () => {
      history();
      const remove = vi.spyOn(services.profile, 'remove').mockResolvedValue(undefined);
      page();
      const dialog = await openDelete(3);
      expect(dialog).not.toHaveTextContent('only restorable backup');
      await userEvent.type(within(dialog).getByLabelText('Confirm your password'), 'wrong');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Backup' }));
      expect(await within(dialog).findByText('Password is incorrect')).toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
      await userEvent.clear(within(dialog).getByLabelText('Confirm your password'));
      await userEvent.type(within(dialog).getByLabelText('Confirm your password'), 'password123');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Backup' }));
      await waitFor(() => expect(remove).toHaveBeenCalledWith('b3'));
      expect(await screen.findByText('Backup was deleted successfully.')).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(3);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('warns, but still allows it, when deleting the only ready backup', async () => {
      history({ items: [READY, FAILED] });
      const remove = vi.spyOn(services.profile, 'remove').mockResolvedValue(undefined);
      page();
      const dialog = await openDelete(1);
      expect(dialog).toHaveTextContent('This is your only restorable backup.');
      await userEvent.type(within(dialog).getByLabelText('Confirm your password'), 'password123');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Backup' }));
      await waitFor(() => expect(remove).toHaveBeenCalledWith('b1'));
    });

    it('does not warn about the only ready backup when a failed one is deleted', async () => {
      history({ items: [READY, FAILED] });
      page();
      expect(await openDelete(2)).not.toHaveTextContent('only restorable backup');
    });

    it('re-prompts when the server says the password confirmation lapsed', async () => {
      history();
      vi.spyOn(services.profile, 'remove').mockRejectedValue(new PasswordConfirmationRequiredError());
      page();
      const dialog = await openDelete(2);
      await userEvent.type(within(dialog).getByLabelText('Confirm your password'), 'password123');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Backup' }));
      expect(await within(dialog).findByText('Your password confirmation expired. Enter it again to delete this backup.')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Confirm your password')).toHaveValue('');
    });
  });

  describe('while an operation is running', () => {
    const running = (kind: 'backup' | 'restore', cancellable = true) => ({ id: 'job-1', kind, status: 'running' as const, ...(cancellable ? { cancellable } : {}) });

    it('blocks every row action and offers Cancel', async () => {
      history({ activeJob: running('backup') });
      page();
      await screen.findByRole('table');
      for (const index of [1, 2, 3]) expect(within(await row(index)).getByRole('button', { name: /Actions for backup/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Create Backup/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });

    it('hides Cancel when the server does not report the job as cancellable', async () => {
      history({ activeJob: running('backup', false) });
      page();
      await screen.findByText(/Creating backup/);
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('cancels a backup in one click, shows Cancelling… until polling ends, then says it was cancelled', async () => {
      history({ activeJob: running('backup') });
      const cancel = vi.spyOn(services.profile, 'cancelJob').mockResolvedValue(running('backup'));
      vi.spyOn(services.profile, 'job').mockResolvedValue({ id: 'job-1', kind: 'backup', status: 'cancelled' });
      page();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Stop the restore?')).not.toBeInTheDocument();
      expect(cancel).toHaveBeenCalledWith('job-1');
      expect(await screen.findByText(/Cancelling…/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(await screen.findByText('Backup cancelled.', {}, { timeout: 3000 })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(4);
      expect(within(await row(1)).getByRole('button', { name: /Actions for backup/ })).toBeEnabled();
    });

    it('asks before stopping a restore, and says the data was not changed', async () => {
      history({ activeJob: running('restore') });
      const cancel = vi.spyOn(services.profile, 'cancelJob').mockResolvedValue(running('restore'));
      vi.spyOn(services.profile, 'job').mockResolvedValue({ id: 'job-1', kind: 'restore', status: 'cancelled' });
      page();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      const dialog = screen.getByRole('dialog', { name: 'Stop the restore?' });
      expect(dialog).toHaveTextContent('Stop the restore? The database stays exactly as it was before the restore started.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Keep Restoring' }));
      expect(cancel).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop Restore' }));
      await waitFor(() => expect(cancel).toHaveBeenCalledWith('job-1'));
      expect(await screen.findByText('Restore cancelled; no data was changed.', {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it.each([
      ['backup', 'The backup had already finished.'],
      ['restore', 'The restore had already finished.'],
    ] as const)('says the %s had already finished when it succeeded despite the cancel', async (kind, text) => {
      history({ activeJob: running(kind) });
      vi.spyOn(services.profile, 'cancelJob').mockResolvedValue(running(kind));
      vi.spyOn(services.profile, 'job').mockResolvedValue({ id: 'job-1', kind, status: 'succeeded' });
      page();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      if (kind === 'restore') await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop Restore' }));
      expect(await screen.findByText(text, {}, { timeout: 3000 })).toBeInTheDocument();
    });

    it('lets the administrator try again when the cancel request fails', async () => {
      history({ activeJob: running('backup') });
      vi.spyOn(services.profile, 'cancelJob').mockRejectedValue(new Error('Cancel is unavailable.'));
      page();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Cancel is unavailable.');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });
  });

  it('cancels a fixture backup end to end without adding a history row', async () => {
    page();
    await screen.findByRole('table');
    const before = screen.getAllByRole('row').length;
    await userEvent.click(await screen.findByRole('button', { name: /Create Backup/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Backup cancelled.', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(before);
    expect(screen.getByRole('button', { name: /Create Backup/ })).toBeEnabled();
  });

  it('records fixture schedule changes in System Logs', async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: /Edit schedule/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await screen.findByText('Automatic backup settings saved.');
    const logs = await services.logs.list('System');
    expect(logs.items.some((entry) => entry.action === 'Changed Backup Schedule')).toBe(true);
  });
});
