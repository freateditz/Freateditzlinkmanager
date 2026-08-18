'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState } from '@/components/ui';
import {
  deleteResource,
  toggleResourceStatus,
} from '@/app/actions/resourceActions';
import { showToast } from '@/components/ui/Toaster';
import { formatDate } from '@/lib/date';
import type { Platform } from '@/lib/validations';

export type ListResource = {
  id: string;
  name: string;
  slug: string;
  platform: Platform;
  active: boolean;
  download_count: number;
  require_subscribe: boolean;
  require_like: boolean;
  created_at: string;
  counterpart_id: string | null;
  counterpart_slug: string | null;
  counterpart_name: string | null;
};

function getGatewayOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.replace(/\/+$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function ResourcesList({
  resources,
  platform,
}: {
  resources: ListResource[];
  platform: Platform;
}) {
  const [pending, startTransition] = useTransition();

  function copyLink(slug: string) {
    const url = `${getGatewayOrigin()}/d/${slug}`;
    navigator.clipboard
      .writeText(url)
      .then(() => showToast('Gateway link copied', 'success'))
      .catch(() => showToast('Copy failed', 'error'));
  }

  function onToggle(id: string, active: boolean) {
    startTransition(async () => {
      const res = await toggleResourceStatus(id, !active);
      if (!res.ok) showToast(res.error, 'error');
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? It will be soft-deleted and hidden from visitors.`)) return;
    startTransition(async () => {
      const res = await deleteResource(id);
      if (!res.ok) showToast(res.error, 'error');
      else showToast('Resource deleted', 'success');
    });
  }

  if (resources.length === 0) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-bg-surface/40 p-10">
        <EmptyState
          title={`No ${platform === 'windows' ? 'Windows' : 'Mac'} resources yet`}
          description={`Create your first ${platform === 'windows' ? 'Windows' : 'Mac'} resource to start sharing.`}
          action={
            <Link href={`/admin/${platform}/new`}>
              <Button>{`+ Add ${platform === 'windows' ? 'Windows' : 'Mac'} Resource`}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-border-subtle bg-bg-surface/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th className="px-5 py-3 font-medium">File</th>
              <th className="px-5 py-3 font-medium">Slug</th>
              <th className="px-5 py-3 font-medium">Counterpart</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right">Downloads</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {resources.map((r) => (
              <tr key={r.id} className="hover:bg-bg-hover/40">
                <td className="px-5 py-3.5">
                  <div className="font-medium text-text-primary">{r.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {r.require_subscribe ? <Badge variant="accent">Subscribe</Badge> : null}
                    {r.require_like ? <Badge variant="accent">Like</Badge> : null}
                    {!r.require_subscribe && !r.require_like ? (
                      <span className="text-xs text-text-muted">No steps</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-text-secondary font-mono text-xs">/d/{r.slug}</td>
                <td className="px-5 py-3.5">
                  {r.counterpart_slug ? (
                    <span className="text-xs text-text-secondary">
                      <span className="text-text-muted">↔</span> {r.counterpart_name ?? r.counterpart_slug}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <Badge variant={r.active ? 'success' : 'warning'}>
                    {r.active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-right tabular-nums text-text-secondary">
                  {r.download_count}
                </td>
                <td className="px-5 py-3.5 text-xs text-text-muted tabular-nums">
                  {formatDate(r.created_at)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <Link
                      href={`/admin/${platform}/${r.id}/edit`}
                      className="h-8 px-2.5 text-xs rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated inline-flex items-center"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => copyLink(r.slug)}
                      className="h-8 px-2.5 text-xs rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
                    >
                      Copy Link
                    </button>
                    <button
                      onClick={() => onToggle(r.id, r.active)}
                      disabled={pending}
                      className="h-8 px-2.5 text-xs rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated disabled:opacity-50"
                    >
                      {r.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => onDelete(r.id, r.name)}
                      disabled={pending}
                      className="h-8 px-2.5 text-xs rounded-md text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="md:hidden space-y-3">
        {resources.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border-subtle bg-bg-surface/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text-primary truncate">{r.name}</p>
                <p className="text-xs text-text-muted font-mono truncate">/d/{r.slug}</p>
              </div>
              <Badge variant={r.active ? 'success' : 'warning'}>
                {r.active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {r.require_subscribe ? <Badge variant="accent">Subscribe</Badge> : null}
              {r.require_like ? <Badge variant="accent">Like</Badge> : null}
              <span className="text-xs text-text-muted ml-auto">{r.download_count} downloads</span>
            </div>
            <div className="text-xs text-text-muted">
              Counterpart:{' '}
              {r.counterpart_slug ? (
                <span className="text-text-secondary">{r.counterpart_name ?? r.counterpart_slug}</span>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/admin/${platform}/${r.id}/edit`}>
                <Button variant="secondary" size="sm" fullWidth>Edit</Button>
              </Link>
              <Button variant="secondary" size="sm" fullWidth onClick={() => copyLink(r.slug)}>
                Copy Link
              </Button>
              <Button variant="secondary" size="sm" fullWidth onClick={() => onToggle(r.id, r.active)} disabled={pending}>
                {r.active ? 'Disable' : 'Enable'}
              </Button>
              <Button variant="danger" size="sm" fullWidth onClick={() => onDelete(r.id, r.name)} disabled={pending}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
