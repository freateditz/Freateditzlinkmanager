import Link from 'next/link';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button } from '@/components/ui';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md animate-fadeIn">
        <Wordmark className="mb-10" />
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-text-primary">
          Download Gateway
        </h1>
        <p className="mt-3 text-sm sm:text-base text-text-muted leading-relaxed">
          Secure, simple access to Freat Editz resources.
        </p>
        <div className="mt-8 flex items-center justify-center">
          <Link href="/admin/login">
            <Button size="lg">Admin Login</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
