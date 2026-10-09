import { render, screen, act } from '@testing-library/react';
import { expect, it, vi, afterEach } from 'vitest';
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
