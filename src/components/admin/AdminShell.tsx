'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { signOut } from '@/app/actions/auth';
import { Button } from '@/components/ui';
import { Wordmark } from '@/components/brand/Wordmark';
import { showToast } from '@/components/ui/Toaster';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' as const },
  { href: '/admin/resources', label: 'Resources', icon: 'resources' as const },
];

function Icon({ name }: { name: 'dashboard' | 'resources' }) {
  const common = 'h-4 w-4';
  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={common}>
        <path d="M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={common}>
      <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
    </svg>
  );
}

export function AdminShell({ children, userEmail }: { children: React.ReactNode; userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSignOut() {
    startTransition(async () => {
      try {
        await signOut();
      } catch {
        // signOut redirects on success; only error path lands here.
        showToast('Could not sign out. Try again.', 'error');
      }
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border-subtle bg-bg-surface/40 backdrop-blur-sm">
        <div className="px-6 py-6 border-b border-border-subtle">
          <Wordmark />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                ].join(' ')}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border-subtle p-4">
          {userEmail ? (
            <div className="mb-3 px-1">
              <p className="text-xs text-text-muted">Signed in as</p>
              <p className="text-sm text-text-primary truncate">{userEmail}</p>
            </div>
          ) : null}
          <Button variant="secondary" size="sm" fullWidth onClick={onSignOut} loading={pending}>
            {pending ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed inset-x-0 top-0 z-30 border-b border-border-subtle bg-bg/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <Wordmark />
          <button
            onClick={() => setOpen((o) => !o)}
            className="h-9 w-9 rounded-lg border border-border text-text-secondary flex items-center justify-center"
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
        {open ? (
          <div className="border-t border-border-subtle bg-bg-surface px-3 py-2 space-y-1">
            {NAV.map((item) => {
              const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={[
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
                    active ? 'bg-accent/10 text-accent' : 'text-text-secondary',
                  ].join(' ')}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              );
            })}
            <div className="pt-2">
              <Button variant="secondary" size="sm" fullWidth onClick={onSignOut} loading={pending}>
                {pending ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <main className="flex-1 md:ml-0 pt-14 md:pt-0">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10 py-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}
