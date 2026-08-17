'use client';

import { useState } from 'react';
import { Input } from './Input';
import type { ComponentProps } from 'react';

type InputProps = ComponentProps<typeof Input>;

export function PasswordInput(props: Omit<InputProps, 'type' | 'endAdornment'>) {
  const [show, setShow] = useState(false);
  return (
    <Input
      {...props}
      type={show ? 'text' : 'password'}
      autoComplete="current-password"
      endAdornment={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="text-text-muted hover:text-text-primary text-xs px-2 h-8 rounded-md"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      }
    />
  );
}
