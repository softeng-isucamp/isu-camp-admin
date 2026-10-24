import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { services } from '../../services/api';
import { canPerform } from '../../lib/permissions';
import type { Session } from '../../types';
afterEach(() => vi.restoreAllMocks());
it('ignores a profile response from a session that has signed out', async () => {
  vi.spyOn(services.auth, 'me').mockResolvedValue({ id: '1', username: 'original' });
  vi.spyOn(services.auth, 'logout').mockResolvedValue(undefined);
  let auth!: ReturnType<typeof useAuth>;
  function Consumer() { auth = useAuth(); return <p>{auth.loading ? 'Loading' : auth.session?.username ?? 'Signed out'}</p>; }
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('original');
  const staleUpdate = auth.updateSession;
  await act(async () => { await auth.logout(); });
  act(() => staleUpdate({ id: '1', username: 'stale' } as Session));
  expect(screen.getByText('Signed out')).toBeInTheDocument();
});

function mountConsumer() {
  const handle = {} as { auth: ReturnType<typeof useAuth> };
  function Consumer() {
    handle.auth = useAuth();
    return <p>{handle.auth.loading ? 'Loading' : handle.auth.session ? `${handle.auth.session.username}:${handle.auth.session.role ?? 'none'}` : 'Signed out'}</p>;
  }
  render(<AuthProvider><Consumer /></AuthProvider>);
  return handle;
}
describe('refreshSession', () => {
  it('reads the session again and shows the role the server now reports', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '1', username: 'justine', role: 'superadmin' });
    const handle = mountConsumer();
    await screen.findByText('justine:superadmin');

    me.mockResolvedValueOnce({ id: '1', username: 'justine', role: 'admin' });
    await act(async () => { await handle.auth.refreshSession(); });

    expect(screen.getByText('justine:admin')).toBeInTheDocument();
    expect(me).toHaveBeenCalledTimes(2);
  });
  it('signs out when the session no longer exists', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '1', username: 'justine', role: 'admin' });
    const handle = mountConsumer();
    await screen.findByText('justine:admin');

    me.mockResolvedValueOnce(null);
    await act(async () => { await handle.auth.refreshSession(); });

    expect(screen.getByText('Signed out')).toBeInTheDocument();
  });
  it('ignores an older refresh that arrives after a permission revocation', async () => {
    const full: Session = { id: '1', username: 'justine', role: 'admin', permissions: { add: true, edit: true, delete: true, changeUserStatus: true } };
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce(full);
    const handle = mountConsumer();
    await screen.findByText('justine:admin');
    let release!: (value: Session) => void;
    me.mockReturnValueOnce(new Promise<Session>((resolve) => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = handle.auth.refreshSession(); });
    me.mockResolvedValueOnce({ ...full, permissions: { ...full.permissions!, edit: false } });
    await act(async () => handle.auth.refreshSession());
    await act(async () => { release(full); await pending; });
    expect(canPerform(handle.auth.session, 'edit')).toBe(false);
  });
  it('keeps the current session when the refresh fails', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '1', username: 'justine', role: 'superadmin' });
    const handle = mountConsumer();
    await screen.findByText('justine:superadmin');

    me.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => { await handle.auth.refreshSession(); });

    expect(screen.getByText('justine:superadmin')).toBeInTheDocument();
  });
  it('does not bring back a session that signed out while the refresh was in flight', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '1', username: 'justine', role: 'admin' });
    vi.spyOn(services.auth, 'logout').mockResolvedValue(undefined);
    const handle = mountConsumer();
    await screen.findByText('justine:admin');

    let release!: (value: Session) => void;
    me.mockReturnValueOnce(new Promise<Session>((resolve) => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = handle.auth.refreshSession(); });
    await act(async () => { await handle.auth.logout(); });
    await act(async () => { release({ id: '1', username: 'justine', role: 'superadmin' }); await pending; });

    expect(screen.getByText('Signed out')).toBeInTheDocument();
  });
  it('does not sign out an account that signed in after the refresh began', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '1', username: 'justine', role: 'superadmin' });
    vi.spyOn(services.auth, 'logout').mockResolvedValue(undefined);
    vi.spyOn(services.auth, 'login').mockResolvedValue({ id: '2', username: 'registrar', role: 'admin' });
    const handle = mountConsumer();
    await screen.findByText('justine:superadmin');

    let release!: (value: null) => void;
    me.mockReturnValueOnce(new Promise<null>((resolve) => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = handle.auth.refreshSession(); });
    await act(async () => { await handle.auth.logout(); });
    await act(async () => { await handle.auth.login('registrar', 'password123'); });
    await act(async () => { release(null); await pending; });

    expect(screen.getByText('registrar:admin')).toBeInTheDocument();
  });
  it('does not sign out the same account that signed in again after the refresh began', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '1', username: 'justine', role: 'superadmin' });
    vi.spyOn(services.auth, 'logout').mockResolvedValue(undefined);
    vi.spyOn(services.auth, 'login').mockResolvedValue({ id: '1', username: 'justine', role: 'superadmin' });
    const handle = mountConsumer();
    await screen.findByText('justine:superadmin');

    let release!: (value: null) => void;
    me.mockReturnValueOnce(new Promise<null>((resolve) => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = handle.auth.refreshSession(); });
    await act(async () => { await handle.auth.logout(); });
    await act(async () => { await handle.auth.login('justine', 'password123'); });
    await act(async () => { release(null); await pending; });

    expect(screen.getByText('justine:superadmin')).toBeInTheDocument();
  });
});

describe('updateSession', () => {
  it('keeps the role and permissions of a restricted administrator when a saved profile replaces their identity', async () => {
    const permissions = { add: true, edit: false, delete: false, changeUserStatus: false };
    vi.spyOn(services.auth, 'me').mockResolvedValueOnce({ id: '2', username: 'staff', role: 'admin', permissions });
    const handle = mountConsumer();
    await screen.findByText('staff:admin');

    // The profile service answers with an account profile, which carries no permissions.
    act(() => handle.auth.updateSession({ id: '2', username: 'staff.renamed', email: 'staff@isu.edu.ph' }));

    expect(screen.getByText('staff.renamed:admin')).toBeInTheDocument();
    expect(handle.auth.session?.permissions).toEqual(permissions);
    expect(canPerform(handle.auth.session, 'edit')).toBe(false);
    expect(canPerform(handle.auth.session, 'add')).toBe(true);
  });
});


describe('permission revalidation', () => {
  const full = { id: '2', username: 'staff', role: 'admin' as const,
    permissions: { add: true, edit: true, delete: true, changeUserStatus: true } };
  const restricted = { ...full, permissions: { ...full.permissions, edit: false } };

  it('refreshes permissions on focus and throttles repeated focus and visibility events', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce(full).mockResolvedValue(restricted);
    const handle = mountConsumer();
    await screen.findByText('staff:admin');
    expect(canPerform(handle.auth.session, 'edit')).toBe(true);

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(canPerform(handle.auth.session, 'edit')).toBe(false));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(me).toHaveBeenCalledTimes(2);

    clock.mockReturnValue(131_000);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(me).toHaveBeenCalledTimes(3));
  });

  it('refreshes after a permission refusal even inside the focus throttle', async () => {
    const me = vi.spyOn(services.auth, 'me').mockResolvedValueOnce(full).mockResolvedValueOnce(full).mockResolvedValue(restricted);
    const handle = mountConsumer();
    await screen.findByText('staff:admin');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(me).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event('isu-camp:permission-denied')));
    await waitFor(() => expect(canPerform(handle.auth.session, 'edit')).toBe(false));
    expect(me).toHaveBeenCalledTimes(3);
  });
});
