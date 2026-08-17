export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div className={['flex flex-col items-center select-none', className].join(' ')}>
      <span className="text-[11px] font-semibold tracking-[0.3em] text-accent">FREAT EDITZ</span>
      <span className="mt-0.5 text-[10px] tracking-[0.25em] text-text-muted">DOWNLOAD GATEWAY</span>
    </div>
  );
}
