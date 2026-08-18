'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Card, Spinner } from '@/components/ui';
import { showToast } from '@/components/ui/Toaster';
import { completeStep, getOrCreateSession, startStep } from '@/app/actions/gateway/sessionActions';
import { MIN_STEP_WAIT_MS, YOUTUBE } from '@/lib/site';

type Download = {
  id: string;
  name: string;
  slug: string;
  require_subscribe: boolean;
  require_like: boolean;
};

type SessionState = {
  subscribe_completed: boolean;
  subscribe_started_at: string | null;
  like_completed: boolean;
  like_started_at: string | null;
  unlocked: boolean;
  expires_at: string;
};

type StepKey = 'subscribe' | 'like';
type StepStatus = 'locked' | 'available' | 'verifying' | 'completed';

function Icon({ name }: { name: 'subscribe' | 'like' | 'download' | 'check' | 'lock' | 'spinner' }) {
  const cls = 'h-4 w-4';
  if (name === 'check') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'subscribe') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.5 0 4.77 1.02 6.4 2.66" strokeLinecap="round" />
        <path d="M17 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'like') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M7 10v11M21 11.5c0-1.1-.9-2-2-2h-5.5l.9-4.27a1.5 1.5 0 00-1.45-1.85c-.66 0-1.24.4-1.49 1L9 10v11h9.05c.83 0 1.55-.55 1.78-1.34l1.13-4.5A2 2 0 0021 11.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'lock') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M6 10V7a6 6 0 0112 0v3M5 10h14v10H5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'spinner') {
    return (
      <span
        className="inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Gateway({ download }: { download: Download }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // verifying = the user clicked the action, the external tab was opened, and
  // the client is now polling (until server says ok) without any further input.
  const [verifying, setVerifying] = useState<Record<StepKey, boolean>>({ subscribe: false, like: false });

  // Refs to coordinate in-flight probes and timers across renders.
  const inFlight = useRef<Record<StepKey, boolean>>({ subscribe: false, like: false });
  const abortProbe = useRef<Record<StepKey, boolean>>({ subscribe: false, like: false });
  const pollTimer = useRef<Record<StepKey, ReturnType<typeof setTimeout> | null>>({
    subscribe: null,
    like: null,
  });
  const retriedSoon = useRef<Record<StepKey, boolean>>({ subscribe: false, like: false });

  const refresh = useCallback(async () => {
    const res = await getOrCreateSession(download.id);
    if (!res.ok) {
      setBootError(res.error);
      return;
    }
    setState({
      subscribe_completed: !!res.data!.subscribe_completed,
      subscribe_started_at: res.data!.subscribe_started_at ?? null,
      like_completed: !!res.data!.like_completed,
      like_started_at: res.data!.like_started_at ?? null,
      unlocked: !!res.data!.unlocked,
      expires_at: res.data!.expires_at,
    });
  }, [download.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stopProbing = useCallback((step: StepKey) => {
    abortProbe.current[step] = true;
    if (pollTimer.current[step]) {
      clearTimeout(pollTimer.current[step]);
      pollTimer.current[step] = null;
    }
  }, []);

  // Probe the server for completion. Idempotent and rate-limited: the server
  // returns "please wait Ns" until MIN_STEP_WAIT_MS has elapsed, and we back off
  // to that hint. Stops as soon as the server reports success or the session is
  // gone — never infinite polls.
  const probe = useCallback(
    async (step: StepKey) => {
      if (inFlight.current[step]) return;
      inFlight.current[step] = true;
      try {
        const res = await completeStep(step);
        if (!res.ok) {
          // Parse the suggested wait time from the error message if it matches
          // the form "Verification in progress — please wait Ns." so we can
          // back off cleanly. Falling back to MIN_STEP_WAIT_MS.
          const match = res.error?.match(/wait (\d+)s/);
          const waitSeconds = match ? Math.max(1, parseInt(match[1], 10)) : MIN_STEP_WAIT_MS / 1000;
          if (abortProbe.current[step]) return;
          pollTimer.current[step] = setTimeout(() => probe(step), waitSeconds * 1000);
          return;
        }
        // Success: server has confirmed completion. Stop polling for this step.
        stopProbing(step);
        setVerifying((v) => ({ ...v, [step]: false }));
        await refresh();
      } catch {
        if (!abortProbe.current[step]) {
          // Network blip — try again in a moment, but bail if the user navigated.
          pollTimer.current[step] = setTimeout(() => probe(step), 2000);
        }
      } finally {
        inFlight.current[step] = false;
      }
    },
    [refresh, stopProbing]
  );

  // When the tab becomes visible/focused again, kick off an immediate probe.
  // The server will refuse to complete early if MIN_STEP_WAIT_MS hasn't
  // elapsed, so a quick return doesn't lead to early unlock.
  useEffect(() => {
    function onReturn(step: StepKey) {
      if (!verifying[step]) return;
      if (retriedSoon.current[step]) return;
      retriedSoon.current[step] = true;
      // Reset the one-shot flag so a later genuine return (e.g. mobile Safari
      // delivering multiple visibility events) still gets a fresh probe.
      setTimeout(() => {
        retriedSoon.current[step] = false;
      }, 4000);
      probe(step);
    }

    function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      onReturn('subscribe');
      onReturn('like');
    }

    function onFocus() {
      onReturn('subscribe');
      onReturn('like');
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [verifying, probe]);

  // Cleanup any pending timers when the component unmounts.
  useEffect(() => {
    return () => {
      (['subscribe', 'like'] as StepKey[]).forEach((s) => {
        if (pollTimer.current[s]) clearTimeout(pollTimer.current[s]);
      });
    };
  }, []);

  function handleStart(step: StepKey) {
    const url = step === 'subscribe' ? YOUTUBE.channelUrl : YOUTUBE.videoUrl;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    abortProbe.current[step] = false;
    setVerifying((v) => ({ ...v, [step]: true }));
    startTransition(async () => {
      const res = await startStep(step);
      if (!res.ok) {
        showToast(res.error, 'error');
        setVerifying((v) => ({ ...v, [step]: false }));
        stopProbing(step);
        return;
      }
      // Kick off the first probe immediately — the server will refuse if 10s
      // haven't elapsed yet, so this can never complete early. After that we
      // rely on the server's hint to schedule the next attempt.
      await refresh();
      probe(step);
    });
  }

  if (bootError) {
    return (
      <Card>
        <div className="text-center py-6">
          <h2 className="text-base font-semibold text-text-primary">Something went wrong</h2>
          <p className="mt-1 text-sm text-text-muted">{bootError}</p>
        </div>
      </Card>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted">
        <Spinner />
      </div>
    );
  }

  const showSubscribe = download.require_subscribe;
  const showLike = download.require_like;
  const total = (showSubscribe ? 1 : 0) + (showLike ? 1 : 0) + 1; // +1 for download step
  const done = (showSubscribe && state.subscribe_completed ? 1 : 0) + (showLike && state.like_completed ? 1 : 0) + (state.unlocked ? 1 : 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // If subscribe isn't required, treat it as effectively completed for UX
  // purposes so the like/download flow is unlocked immediately.
  const subscribeStatus: StepStatus = !showSubscribe
    ? 'completed'
    : state.subscribe_completed
    ? 'completed'
    : verifying.subscribe || state.subscribe_started_at
    ? 'verifying'
    : 'available';

  const likeStatus: StepStatus = !showLike
    ? 'completed'
    : state.like_completed
    ? 'completed'
    : subscribeStatus !== 'completed'
    ? 'locked'
    : verifying.like || state.like_started_at
    ? 'verifying'
    : 'available';

  return (
    <div className="space-y-5">
      <ProgressBar percent={pct} done={done} total={total} />

      <div className="space-y-3">
        {showSubscribe ? (
          <Step
            index={1}
            status={subscribeStatus}
            title="Subscribe to our channel"
            onStart={() => handleStart('subscribe')}
          />
        ) : null}

        {showLike ? (
          <Step
            index={2}
            status={likeStatus}
            title="Like the video"
            onStart={() => handleStart('like')}
          />
        ) : null}

        {/* Final step — Download */}
        <DownloadStep unlocked={state.unlocked} slug={download.slug} name={download.name} />
      </div>
    </div>
  );
}

function ProgressBar({ percent, done, total }: { percent: number; done: number; total: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-text-muted mb-2">
        <span>Progress</span>
        <span className="tabular-nums">
          {done} / {total}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        />
      </div>
    </div>
  );
}

function Step({
  index,
  status,
  title,
  onStart,
}: {
  index: number;
  status: StepStatus;
  title: string;
  onStart: () => void;
}) {
  const isLocked = status === 'locked';
  const isCompleted = status === 'completed';
  const isVerifying = status === 'verifying';

  let description = '';
  if (isCompleted) {
    description = 'Step completed.';
  } else if (isLocked) {
    description = 'Unlocks when the previous step finishes.';
  } else if (isVerifying) {
    description = 'Verification in progress — finishing on its own.';
  } else {
    description = 'Tap the button to open it in a new tab. The next step starts automatically.';
  }

  // Header label reflects the V1 auto-state: "STEP 1", "Verifying…", or "Done".
  const header =
    isCompleted
      ? `STEP ${String(index).padStart(2, '0')} — DONE`
      : isVerifying
      ? `STEP ${String(index).padStart(2, '0')} — VERIFYING`
      : `STEP ${String(index).padStart(2, '0')}`;

  return (
    <Card className={['transition-all duration-300 motion-reduce:transition-none', isLocked ? 'opacity-60' : ''].join(' ')}>
      <div className="flex items-start gap-4">
        <div
          className={[
            'flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold',
            isCompleted
              ? 'bg-success/15 text-success border border-success/30'
              : isLocked
              ? 'bg-bg-elevated text-text-muted border border-border'
              : isVerifying
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'bg-accent/15 text-accent border border-accent/30',
          ].join(' ')}
          aria-hidden="true"
        >
          {isCompleted ? <Icon name="check" /> : <span className="tabular-nums">{String(index).padStart(2, '0')}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted">{header}</p>
          <h3 className="mt-0.5 text-sm sm:text-base font-semibold text-text-primary">{title}</h3>
          <p className="mt-1 text-sm text-text-muted">{description}</p>
          <div className="mt-4">
            {isLocked ? (
              <button
                disabled
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-bg-elevated text-text-muted text-sm font-medium cursor-not-allowed motion-reduce:transition-none"
                aria-label="Step locked"
              >
                <Icon name="lock" />
                Locked
              </button>
            ) : isCompleted ? (
              <button
                disabled
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-success/10 text-success border border-success/20 text-sm font-medium cursor-default motion-reduce:transition-none"
              >
                <Icon name="check" />
                Completed
              </button>
            ) : isVerifying ? (
              <button
                disabled
                aria-live="polite"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-bg-elevated border border-border text-text-secondary text-sm font-medium motion-reduce:transition-none"
              >
                <Icon name="spinner" />
                Verifying…
              </button>
            ) : (
              <button
                onClick={onStart}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent-hover motion-reduce:transition-none"
              >
                <Icon name={index === 1 ? 'subscribe' : 'like'} />
                {index === 1 ? 'Subscribe' : 'Like Video'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DownloadStep({ unlocked, slug, name }: { unlocked: boolean; slug: string; name: string }) {
  const header = unlocked ? 'DOWNLOAD READY' : 'DOWNLOAD';
  return (
    <Card
      className={[
        'transition-all duration-500 motion-reduce:transition-none',
        unlocked ? 'border-accent/30 shadow-glow' : 'opacity-70',
      ].join(' ')}
    >
      <div className="flex items-start gap-4">
        <div
          className={[
            'flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center border',
            unlocked
              ? 'bg-accent/15 text-accent border-accent/30'
              : 'bg-bg-elevated text-text-muted border-border',
          ].join(' ')}
        >
          <Icon name="download" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted">{header}</p>
          <h3 className="mt-0.5 text-sm sm:text-base font-semibold text-text-primary">
            {unlocked ? 'All steps completed' : 'Download'}
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            {unlocked
              ? 'Your download is ready.'
              : 'Unlocks once every step above is complete.'}
          </p>
          <div className="mt-4">
            {unlocked ? (
              <a
                href={`/api/download/${slug}`}
                className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent-hover transition-colors motion-reduce:transition-none animate-slideIn"
              >
                <Icon name="download" />
                Download {name}
              </a>
            ) : (
              <button
                disabled
                className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg bg-bg-elevated border border-border text-text-muted text-sm font-medium cursor-not-allowed"
              >
                <Icon name="lock" />
                Locked
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
