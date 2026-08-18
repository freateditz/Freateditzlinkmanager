'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resourceSchema, type Platform } from '@/lib/validations';
import { Input, Button, Card } from '@/components/ui';
import { showToast } from '@/components/ui/Toaster';
import { createResource, listCounterpartCandidates, updateResource } from '@/app/actions/resourceActions';

type FormValues = {
  name: string;
  mediafire_url: string;
  platform: Platform;
  counterpart_id: string;
  require_subscribe: boolean;
  require_like: boolean;
  active: boolean;
};

const defaults: FormValues = {
  name: '',
  mediafire_url: '',
  platform: 'windows',
  counterpart_id: '',
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

export function ResourceForm({
  mode,
  platform,
  initial,
  createdSlug,
}: {
  mode: 'create' | 'edit';
  platform: Platform;
  initial?: any;
  createdSlug?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [generatedSlug, setGeneratedSlug] = useState<string | null>(createdSlug ?? null);
  const [counterpartSearch, setCounterpartSearch] = useState('');

  const opposite: Platform = platform === 'windows' ? 'mac' : 'windows';

  const form = useForm<FormValues>({
    resolver: zodResolver(resourceSchema) as any,
    defaultValues: initial
      ? {
          name: initial.name,
          mediafire_url: initial.mediafire_url,
          // On edit, platform is locked. We always pull from `initial.platform`
          // (so the form sends it back unchanged in the payload) — the server
          // action refuses to change it regardless.
          platform: (initial.platform as Platform) ?? platform,
          counterpart_id: initial.counterpart_id ?? '',
          require_subscribe: !!initial.require_subscribe,
          require_like: !!initial.require_like,
          active: !!initial.active,
        }
      : { ...defaults, platform },
  });

  // Counterpart candidates are fetched on the server via the admin action.
  // We pull once on mount and after a successful save.
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string; slug: string; platform: Platform }>>([]);
  useEffect(() => {
    listCounterpartCandidates(platform, initial?.id).then(setCandidates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, initial?.id]);

  const filteredCandidates = useMemo(() => {
    const s = counterpartSearch.trim().toLowerCase();
    if (!s) return candidates;
    return candidates.filter(
      (c) => c.name.toLowerCase().includes(s) || c.slug.toLowerCase().includes(s)
    );
  }, [candidates, counterpartSearch]);

  function onSubmit(values: FormValues) {
    setServerError(null);
    startTransition(async () => {
      // Always serialise counterpart_id as "" when none picked; the schema
      // already converts empty strings to null.
      const payload = { ...values, counterpart_id: values.counterpart_id ?? '' };
      const res =
        mode === 'create' ? await createResource(payload) : await updateResource(initial.id, payload);
      if (!res.ok) {
        setServerError(res.error);
        showToast(res.error, 'error');
        return;
      }
      showToast(mode === 'create' ? 'Resource created' : 'Changes saved', 'success');
      if (mode === 'create' && res.data) {
        setGeneratedSlug((res.data as any).slug);
        // After creating, refresh candidates so the new row appears for future
        // linking from the opposite platform.
        const fresh = await listCounterpartCandidates(platform, (res.data as any).id);
        setCandidates(fresh);
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
          <p className="mt-4 text-xs text-text-muted">
            You can attach or change the {opposite === 'windows' ? 'Windows' : 'Mac'} counterpart from the edit page.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="rounded-md border border-border bg-bg-elevated px-2 py-1 font-medium uppercase tracking-wider">
            Platform: {platform === 'windows' ? 'Windows' : 'Mac'}
          </span>
          <span>— platform is locked once chosen.</span>
          <input type="hidden" {...form.register('platform')} value={platform} />
        </div>

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
          <legend className="px-1 text-xs uppercase tracking-wider text-text-muted">
            Counterpart
          </legend>
          <p className="text-xs text-text-muted -mt-1">
            Optional: link this {platform === 'windows' ? 'Windows' : 'Mac'} resource to a {opposite === 'windows' ? 'Windows' : 'Mac'} counterpart so visitors can switch between platforms.
          </p>
          <input
            type="text"
            value={counterpartSearch}
            onChange={(e) => setCounterpartSearch(e.target.value)}
            placeholder={`Search ${opposite} resources…`}
            className="w-full h-9 rounded-lg bg-bg-elevated border border-border px-3 text-sm placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <select
            className="w-full h-10 rounded-lg bg-bg-elevated border border-border px-3 text-sm focus:border-accent focus:outline-none"
            value={form.watch('counterpart_id')}
            onChange={(e) => form.setValue('counterpart_id', e.target.value, { shouldDirty: true })}
          >
            <option value="">— No counterpart yet —</option>
            {filteredCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.slug})
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4 space-y-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-text-muted">Requirements</legend>
          <p className="text-xs text-text-muted -mt-1">
            Turn on whichever steps visitors must complete. The YouTube links
            themselves are site-wide and configured in the environment.
          </p>
          <Checkbox
            label={platform === 'windows' ? 'Subscribe to YouTube' : 'Subscribe to YouTube'}
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
            {pending
              ? 'Saving…'
              : mode === 'create'
              ? `Create ${platform === 'windows' ? 'Windows' : 'Mac'} Resource`
              : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Checkbox({
  label,
  description,
  ...rest
}: {
  label: string;
  description?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
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
