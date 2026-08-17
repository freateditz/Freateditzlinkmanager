'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/app/actions/auth';
import { Input, PasswordInput, Button } from '@/components/ui';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await signIn(formData);
      if (res.ok) {
        router.replace(next.startsWith('/admin') ? next : '/admin');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4" noValidate>
      <Input
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        placeholder="you@example.com"
        required
        disabled={pending}
      />
      <PasswordInput
        name="password"
        label="Password"
        placeholder="••••••••"
        required
        disabled={pending}
      />
      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}
      <Button type="submit" loading={pending} fullWidth size="lg">
        {pending ? 'Signing in…' : 'Sign In'}
      </Button>
    </form>
  );
}
