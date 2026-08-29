import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ className = '', ...props }: ButtonProps) {
  return <button className={`action-btn ${className}`} {...props} />;
}
