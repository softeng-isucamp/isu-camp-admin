/** The show/hide password glyph: an eye while hidden, a struck-through eye while shown. Decorative; the button carries the name. */
export function PasswordVisibilityIcon({ shown }: { shown: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shown ? (
        <>
          <path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2" />
          <path d="M6.6 6.6C3.6 8.6 2 12 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
