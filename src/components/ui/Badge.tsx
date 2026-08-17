type Variant = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

const styles: Record<Variant, string> = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  neutral: 'bg-bg-hover text-text-secondary border-border',
  accent: 'bg-accent/10 text-accent border-accent/20',
};

export function Badge({ children, variant = 'neutral', className = '' }: { children: React.ReactNode; variant?: Variant; className?: string }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        styles[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
