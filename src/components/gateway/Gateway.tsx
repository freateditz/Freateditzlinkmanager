'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Card, Spinner } from '@/components/ui';
import { showToast } from '@/components/ui/Toaster';
import { completeStep, getOrCreateSession, startStep } from '@/app/actions/gateway/sessionActions';

type Download = {
  id: string;
  name: string;
  slug: string;
  require_subscribe: boolean;
  require_like: boolean;
  youtube_channel_url: string | null;
  youtube_video_url: string | null;
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
type StepStatus = 'locked' | 'available' | 'waiting_for_return' | 'checking' | 'completed';

function Icon({ name }: { name: 'subscribe' | 'like' | 'download' | 'check' | 'lock' }) {
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
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Gateway({ download }: { download: Download }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // waitingForReturn = the user clicked the action button and the external
  // tab has been opened; we're waiting for them to come back so we can run
  // the server-side check.
  const [waitingForReturn, setWaitingForReturn] = useState<Record<StepKey, boolean>>({ subscribe: false, like: false });
  // checking = the server-side minimum wait is in flight (after return detected).
  const [checking, setChecking] = useState<Record<StepKey, boolean>>({ subscribe: false, like: false });

  // Refs to debounce return events and to abort in-flight transitions.
  const returnDetectedAt = useRef<Record<StepKey, number>>({ subscribe: 0, like: 0 });
  const inFlight = useRef<Record<StepKey, boolean>>({ subscribe: false, like: false });

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

  // Triggered when the user returns to the gateway tab. The server's
  // SimpleWaitVerifier is the source of truth for whether the step can be
  // marked complete; this just kicks off the request.
  const runCheck = useCallback(
    (step: StepKey) => {
      if (inFlight.current[step]) return;
      inFlight.current[step] = true;
      setChecking((c) => ({ ...c, [step]: true }));

      startTransition(async () => {
        try {
          // Client-side 600ms feels natural before the server response.
          await new Promise((r) => setTimeout(r, 600));
          const res = await completeStep(step);
          if (!res.ok) {
            showToast(res.error, 'error');
          } else {
            showToast('Step completed', 'success');
          }
          await refresh();
        } finally {
          inFlight.current[step] = false;
          setChecking((c) => ({ ...c, [step]: false }));
          setWaitingForReturn((w) => ({ ...w, [step]: false }));
        }
      });
    },
    [refresh]
  );

  // Set up listeners for detecting return. The user must have explicitly
  // started a step (waitingForReturn=true) for the return to matter, and
  // we debounce so a flurry of events only triggers one check.
  useEffect(() => {
    function onReturn(step: StepKey) {
      const now = Date.now();
      if (now - returnDetectedAt.current[step] < 1000) return;
      returnDetectedAt.current[step] = now;
      runCheck(step);
    }

    function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      if (waitingForReturn.subscribe) onReturn('subscribe');
      if (waitingForReturn.like) onReturn('like');
    }

    function onFocus() {
      if (waitingForReturn.subscribe) onReturn('subscribe');
      if (waitingForReturn.like) onReturn('like');
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [waitingForReturn, runCheck]);

  function handleStart(step: StepKey) {
    const url = step === 'subscribe' ? download.youtube_channel_url : download.youtube_video_url;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    startTransition(async () => {
      const res = await startStep(step);
      if (!res.ok) {
        showToast(res.error, 'error');
        return;
      }
      // Mark that we're waiting for the user to come back. The visibility/
      // focus listeners will fire the server-side check automatically.
      returnDetectedAt.current[step] = 0;
      setWaitingForReturn((w) => ({ ...w, [step]: true }));
      await refresh();
    });
  }

  // Fallback: if the browser doesn't fire visibility/focus reliably, the user
  // can click the "I'm back" affordance. This still goes through the same
  // server-side timing enforcement — it is NOT a manual completion button.
  function handleImBack(step: StepKey) {
    runCheck(step);
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

  const subscribeStatus: StepStatus = !showSubscribe
    ? 'completed'
    : state.subscribe_completed
    ? 'completed'
    : checking.subscribe
    ? 'checking'
    : waitingForReturn.subscribe || state.subscribe_started_at
    ? 'waiting_for_return'
    : 'available';

  const likeStatus: StepStatus = !showLike
    ? 'completed'
    : state.like_completed
    ? 'completed'
    : checking.like
    ? 'checking'
    : !state.subscribe_completed
    ? 'locked'
    : waitingForReturn.like || state.like_started_at
    ? 'waiting_for_return'
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
            onReturn={() => handleImBack('subscribe')}
            checking={checking.subscribe}
            disabled={pending}
          />
        ) : null}

        {showLike ? (
          <Step
            index={2}
            status={likeStatus}
            title="Like the video"
            onStart={() => handleStart('like')}
            onReturn={() => handleImBack('like')}
            checking={checking.like}
            disabled={pending || likeStatus === 'locked'}
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
          className="h-full bg-accent transition-all duration-500 ease-out"
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
  onReturn,
  checking,
  disabled,
}: {
  index: number;
  status: StepStatus;
  title: string;
  onStart: () => void;
  onReturn: () => void;
  checking: boolean;
  disabled: boolean;
}) {
  const isLocked = status === 'locked';
  const isCompleted = status === 'completed';
  const isChecking = status === 'checking' || checking;
  const isWaiting = status === 'waiting_for_return';

  let description = '';
  if (isCompleted) {
    description = 'Step completed.';
  } else if (isLocked) {
    description = 'Complete the previous step to unlock this one.';
  } else if (isChecking) {
    description = 'Step completed once the server confirms.';
  } else if (isWaiting) {
    description = 'Come back to this tab when you’re done — we’ll detect the return automatically.';
  } else {
    description = 'Tap the button to open it in a new tab. The next step starts when you return.';
  }

  return (
    <Card className={['transition-all duration-300', isLocked ? 'opacity-60' : ''].join(' ')}>
      <div className="flex items-start gap-4">
        <div
          className={[
            'flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold',
            isCompleted
              ? 'bg-success/15 text-success border border-success/30'
              : isLocked
              ? 'bg-bg-elevated text-text-muted border border-border'
              : 'bg-accent/15 text-accent border border-accent/30',
          ].join(' ')}
          aria-hidden="true"
        >
          {isCompleted ? <Icon name="check" /> : <span className="tabular-nums">{String(index).padStart(2, '0')}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm sm:text-base font-semibold text-text-primary">{title}</h3>
          <p className="mt-1 text-sm text-text-muted">{description}</p>
          <div className="mt-4">
            {isLocked ? (
              <button
                disabled
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-bg-elevated text-text-muted text-sm font-medium cursor-not-allowed"
                aria-label="Step locked"
              >
                <Icon name="lock" />
                Locked
              </button>
            ) : isCompleted ? (
              <button
                disabled
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-success/10 text-success border border-success/20 text-sm font-medium cursor-default"
              >
                <Icon name="check" />
                Step completed
              </button>
            ) : isChecking ? (
              <button
                disabled
                aria-live="polite"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-bg-elevated border border-border text-text-secondary text-sm font-medium"
              >
                <Spinner />
                Checking…
              </button>
            ) : isWaiting ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  disabled
                  aria-live="polite"
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-bg-elevated border border-border text-text-secondary text-sm font-medium"
                >
                  <Spinner />
                  Checking…
                </button>
                <button
                  type="button"
                  onClick={onReturn}
                  disabled={disabled}
                  className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-bg-elevated border border-border text-text-secondary text-sm font-medium hover:bg-bg-hover disabled:opacity-50"
                >
                  I’m back
                </button>
              </div>
            ) : (
              <button
                onClick={onStart}
                disabled={disabled}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent-hover disabled:opacity-50"
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
  return (
    <Card
      className={[
        'transition-all duration-500',
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
          <h3 className="text-sm sm:text-base font-semibold text-text-primary">
            {unlocked ? '✓ All steps completed' : 'Download'}
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            {unlocked
              ? 'Your download is ready.'
              : 'The download unlocks once every step above is complete.'}
          </p>
          <div className="mt-4">
            {unlocked ? (
              <a
                href={`/api/download/${slug}`}
                className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg bg-accent text-bg text-sm font-semibold hover:bg-accent-hover transition-colors animate-slideIn"
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
