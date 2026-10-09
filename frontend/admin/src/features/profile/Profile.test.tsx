import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  await userEvent.type(screen.getByLabelText('New password'), 'newpassword123');
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'different123');
  await userEvent.click(screen.getByRole('button', { name: 'Update Password' }));
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
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
