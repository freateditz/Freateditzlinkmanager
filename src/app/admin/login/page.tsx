import { LoginForm } from './LoginForm';
import { Wordmark } from '@/components/brand/Wordmark';

type SearchParams = Promise<{ next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm animate-fadeIn">
        <div className="flex justify-center mb-8">
          <Wordmark />
        </div>

        <div className="rounded-2xl border border-border-subtle bg-bg-surface/80 backdrop-blur-sm p-7 shadow-soft">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-text-primary">Welcome back</h1>
            <p className="mt-1 text-sm text-text-muted">Sign in to manage your download resources.</p>
          </div>
          <LoginForm next={next ?? '/admin'} />
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          Authorized access only. All activity is monitored.
        </p>
      </div>
    </main>
  );
}
