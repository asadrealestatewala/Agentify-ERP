import { useState } from 'react';
import Icon from './Icon.jsx';

/** Password box with an eye button that shows or hides what was typed; the value itself is never changed. */
export default function PasswordInput({ value, onChange, autoComplete = 'current-password', ...p }) {
  const [shown, setShown] = useState(false);
  const label = shown ? 'Hide password' : 'Show password';
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} style={{ paddingRight: 44 }} {...p} />
      <button type="button" className="btn ghost" title={label} aria-label={label} aria-pressed={shown} onClick={() => setShown((v) => !v)}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
      </button>
    </div>
  );
}
