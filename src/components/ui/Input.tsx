import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label?: string;
  hint?: string;
  error?: string;
  endAdornment?: React.ReactNode;
  id?: string;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, endAdornment, className = '', id, type = 'text', ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? `inp-${generatedId}`;
  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-text-secondary mb-1.5">
          {label}
        </label>
      ) : null}
      <div
        className={[
          'group relative flex items-center rounded-lg border bg-bg-surface transition-colors',
          error ? 'border-danger/60' : 'border-border hover:border-border-strong focus-within:border-accent',
        ].join(' ')}
      >
        <input
          ref={ref}
          id={inputId}
          type={type}
          className={[
            'w-full bg-transparent px-3.5 h-10 text-sm text-text-primary placeholder:text-text-muted outline-none',
            className,
          ].join(' ')}
          {...rest}
        />
        {endAdornment ? <div className="pr-2">{endAdornment}</div> : null}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
});
