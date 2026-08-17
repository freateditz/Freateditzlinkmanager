type Props = {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
};

export function Card({ children, className = '', padded = true }: Props) {
  return (
    <div
      className={[
        'rounded-2xl border border-border-subtle bg-bg-surface/80 backdrop-blur-sm shadow-soft',
        padded ? 'p-6' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}
