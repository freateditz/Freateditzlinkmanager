'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resourceSchema } from '@/lib/validations';
import { Input, Button, Card } from '@/components/ui';
import { showToast } from '@/components/ui/Toaster';
import { createResource, updateResource } from '@/app/actions/resourceActions';

type FormValues = {
  name: string;
  mediafire_url: string;
  require_subscribe: boolean;
  require_like: boolean;
  active: boolean;
};

const defaults: FormValues = {
  name: '',
  mediafire_url: '',
  require_subscribe: true,
  require_like: true,
  active: true,
};

// Production site origin is exposed via NEXT_PUBLIC_SITE_URL at build time.
// Falls back to the current window origin in development.
function getGatewayOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function ResourceForm({ mode, initial, createdSlug }: { mode: 'create' | 'edit'; initial?: any; createdSlug?: string }) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [generatedSlug, setGeneratedSlug] = useState<string | null>(createdSlug ?? null);

  const form = useForm<FormValues>({
    resolver: zodResolver(resourceSchema) as any,
    defaultValues: initial
      ? {
          name: initial.name,
          mediafire_url: initial.mediafire_url,
          require_subscribe: !!initial.require_subscribe,
          require_like: !!initial.require_like,
          active: !!initial.active,
        }
      : defaults,
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    startTransition(async () => {
      const res = mode === 'create' ? await createResource(values) : await updateResource(initial.id, values);
      if (!res.ok) {
        setServerError(res.error);
        showToast(res.error, 'error');
        return;
      }
      showToast(mode === 'create' ? 'Resource created' : 'Changes saved', 'success');
      if (mode === 'create' && res.data) {
        setGeneratedSlug((res.data as any).slug);
      }
    });
  }

  if (generatedSlug) {
    const link = `${getGatewayOrigin()}/d/${generatedSlug}`;
    return (
      <Card className="animate-fadeIn">
        <div className="text-center py-2">
          <div className="mx-auto h-10 w-10 rounded-full bg-success/15 text-success flex items-center justify-center mb-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text-primary">Resource created</h2>
          <p className="mt-1 text-sm text-text-muted">Your gateway link is ready below.</p>
        </div>
        <div className="mt-5">
          <p className="text-xs uppercase tracking-wider text-text-muted">Your gateway link</p>
          <div className="mt-2 rounded-lg border border-border bg-bg-elevated p-3 flex items-center gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 bg-transparent text-sm text-text-primary font-mono outline-none truncate"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  .writeText(link)
                  .then(() => showToast('Link copied', 'success'))
                  .catch(() => showToast('Copy failed', 'error'));
              }}
            >
              Copy Link
            </Button>
            <a
              href={`/d/${generatedSlug}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-bg-elevated px-3 text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              View Gateway
            </a>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Input
          label="File Name"
          placeholder="AE 2023 Ultimate Pack"
          hint="The download link will be generated automatically."
          {...form.register('name')}
          error={form.formState.errors.name?.message}
        />
        <Input
          label="MediaFire URL"
          placeholder="https://www.mediafire.com/file/…"
          {...form.register('mediafire_url')}
          error={form.formState.errors.mediafire_url?.message}
        />

        <fieldset className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4 space-y-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-text-muted">Requirements</legend>
          <p className="text-xs text-text-muted -mt-1">
            Turn on whichever steps visitors must complete. The YouTube links
            themselves are site-wide and configured in the environment.
          </p>
          <Checkbox
            label="Subscribe to YouTube"
            description="Visitors must visit the channel before unlocking the download."
            {...form.register('require_subscribe')}
          />
          <Checkbox
            label="Like the video"
            description="Visitors must visit the video before unlocking the download."
            {...form.register('require_like')}
          />
          <Checkbox
            label="Active"
            description="When off, the resource returns a 404 to visitors."
            {...form.register('active')}
          />
        </fieldset>

        {serverError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
          >
            {serverError}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" loading={pending} size="lg">
            {pending ? 'Saving…' : mode === 'create' ? 'Create Resource' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Checkbox({ label, description, ...rest }: { label: string; description?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-border bg-bg-elevated accent-accent"
        {...rest}
      />
      <span>
        <span className="text-sm font-medium text-text-primary">{label}</span>
        {description ? <span className="block text-xs text-text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
