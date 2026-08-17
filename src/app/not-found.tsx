import Link from 'next/link';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md animate-fadeIn">
        <Wordmark className="mb-8" />
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary">Not found</h1>
        <p className="mt-2 text-sm text-text-muted">The page or resource you're looking for doesn't exist.</p>
        <div className="mt-6">
          <Link href="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
