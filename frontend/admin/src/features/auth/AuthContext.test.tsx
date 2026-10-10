import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { services } from '../../services/api';
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
});
