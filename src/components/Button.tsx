import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'live' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className = '',
  type = 'button',
  variant = 'secondary',
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={`button button--${variant}${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
})

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode
  label: string
  tone?: 'default' | 'danger' | 'success'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  children,
  className = '',
  label,
  tone = 'default',
  title = label,
  type = 'button',
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title}
      className={`icon-button-control icon-button-control--${tone}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {children}
    </button>
  )
})
