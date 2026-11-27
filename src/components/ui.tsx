// Corel component kit. Semantic tokens only (see styles.css); Lucide icons; 28-32px
// controls for a dense desktop layout with visible focus rings.
import * as React from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RSelect from '@radix-ui/react-select';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RPopover from '@radix-ui/react-popover';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn, hueFor, initials } from '@/lib/format';

// ------------------------------------------------------------------ Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]',
  secondary: 'bg-raised text-fg border border-line-strong hover:bg-active',
  outline: 'border border-line-strong text-fg hover:bg-hover',
  ghost: 'text-fg-muted hover:text-fg hover:bg-hover',
  danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger/20',
};
const sizes: Record<Size, string> = {
  xs: 'h-6 px-2 text-[12px] gap-1 rounded-sm',
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-md',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,filter,border-color] duration-150 disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps & { label: string; tooltip?: boolean }>(function IconButton(
  { label, tooltip = true, size = 'sm', variant = 'ghost', className, children, ...rest },
  ref,
) {
  const btn = (
    <Button ref={ref} aria-label={label} variant={variant} size={size} className={cn(size === 'xs' ? 'w-6 px-0' : size === 'sm' ? 'w-7 px-0' : 'w-8 px-0', className)} {...rest}>
      {children}
    </Button>
  );
  return tooltip ? <Tooltip content={label}>{btn}</Tooltip> : btn;
});

// ------------------------------------------------------------------ Inputs

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode; invalid?: boolean }>(function Input(
  { className, icon, invalid, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-8 w-full rounded-md border bg-sunken px-2.5 text-[13px] text-fg placeholder:text-fg-subtle transition-colors duration-150',
        'border-line-strong hover:border-fg-subtle/40 focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent-soft',
        invalid && 'border-danger focus:border-danger focus:ring-danger-soft',
        icon && 'pl-8',
        className,
      )}
      {...rest}
    />
  );
  if (!icon) return input;
  return (
    <div className="relative w-full">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle [&>svg]:size-3.5">{icon}</span>
      {input}
    </div>
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[72px] w-full resize-y rounded-md border border-line-strong bg-sunken px-2.5 py-2 text-[13px] leading-relaxed text-fg placeholder:text-fg-subtle',
        'focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent-soft',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, error, children, htmlFor, className, optional }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; htmlFor?: string; className?: string; optional?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-fg-muted">
        {label}
        {optional && <span className="ml-1 font-normal text-fg-subtle">optional</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50', checked ? 'bg-accent' : 'bg-active border border-line-strong')}
    >
      <span className={cn('absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full shadow transition-transform duration-200', checked ? 'translate-x-[15px] bg-accent-fg' : 'translate-x-[2px] bg-fg-muted')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'sm', label }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]; size?: 'xs' | 'sm'; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors duration-150',
            size === 'xs' ? 'h-5 px-2 text-[11.5px]' : 'h-6 px-2.5 text-[12px]',
            value === o.value ? 'bg-raised text-fg shadow-sm ring-1 ring-line-strong' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Select

export interface Option<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}

export function Select<T extends string>({ value, onChange, options, placeholder = 'Select…', className, size = 'md', label, disabled }: { value: T | '' | null | undefined; onChange: (v: T) => void; options: Option<T>[]; placeholder?: string; className?: string; size?: 'sm' | 'md'; label: string; disabled?: boolean }) {
  const current = options.find((o) => o.value === value);
  return (
    <RSelect.Root value={value || undefined} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <RSelect.Trigger
        aria-label={label}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-sunken text-left text-fg transition-colors hover:bg-hover disabled:opacity-50 data-[placeholder]:text-fg-subtle',
          size === 'sm' ? 'h-7 px-2 text-[12.5px]' : 'h-8 px-2.5 text-[13px]',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {current?.icon}
          <RSelect.Value placeholder={placeholder}>{current?.label}</RSelect.Value>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={4} className="z-[60] max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg bg-overlay p-1 shadow-pop animate-pop-in">
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-md pl-2 pr-7 text-[13px] text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover"
              >
                {o.icon}
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                {o.hint && <span className="ml-auto text-[11.5px] text-fg-subtle">{o.hint}</span>}
                <RSelect.ItemIndicator className="absolute right-2">
                  <Check className="size-3.5 text-accent-text" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

// ------------------------------------------------------------------ Menu

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({ children, align = 'end', className, side }: { children: React.ReactNode; align?: 'start' | 'end' | 'center'; className?: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} side={side} sideOffset={4} className={cn('z-[60] min-w-[190px] rounded-lg bg-overlay p-1 shadow-pop animate-pop-in', className)}>
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({ children, icon, onSelect, danger, shortcut, disabled }: { children: React.ReactNode; icon?: React.ReactNode; onSelect?: () => void; danger?: boolean; shortcut?: string; disabled?: boolean }) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&>svg]:size-3.5',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {icon && <span className={cn('[&>svg]:size-3.5', danger ? 'text-danger' : 'text-fg-muted')}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </RMenu.Item>
  );
}

export function MenuCheckItem({ children, checked, onChange }: { children: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <RMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onChange}
      onSelect={(e) => e.preventDefault()}
      className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-hover"
    >
      <span className="grid size-3.5 place-items-center rounded-[4px] border border-line-strong">{checked && <Check className="size-3 text-accent-text" />}</span>
      {children}
    </RMenu.CheckboxItem>
  );
}

export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <RMenu.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{children}</RMenu.Label>;

// ------------------------------------------------------------------ Popover / Tooltip

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export function PopoverContent({ children, className, align = 'end' }: { children: React.ReactNode; className?: string; align?: 'start' | 'end' | 'center' }) {
  return (
    <RPopover.Portal>
      <RPopover.Content align={align} sideOffset={6} className={cn('z-[60] rounded-lg bg-overlay shadow-pop animate-pop-in', className)}>
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[70] max-w-[260px] rounded-md bg-overlay px-2 py-1 text-[12px] text-fg shadow-pop animate-fade-in">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
export const TooltipProvider = RTooltip.Provider;

// ------------------------------------------------------------------ Dialog

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 480, trigger }: { open?: boolean; onOpenChange?: (v: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; width?: number; trigger?: React.ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] animate-fade-in" />
        <RDialog.Content
          style={{ width }}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] max-w-[calc(100vw-48px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-pop animate-pop-in"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RDialog.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-[12.5px] text-fg-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close" tooltip={false} size="xs">
                <X className="size-3.5" />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Sheet({ open, onOpenChange, children, width = 560, label }: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode; width?: number; label: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/35 animate-fade-in" />
        <RDialog.Content style={{ width }} className="fixed bottom-2 right-2 top-[42px] z-40 flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-pop animate-slide-in">
          <RDialog.Title className="sr-only">{label}</RDialog.Title>
          <RDialog.Description className="sr-only">{label}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Imperative confirm dialog: `const ok = await confirm({...})`. */
type ConfirmOpts = { title: string; body?: React.ReactNode; confirm?: string; danger?: boolean; typeToConfirm?: string };
let confirmImpl: ((o: ConfirmOpts) => Promise<boolean>) | null = null;
export const confirm = (o: ConfirmOpts) => (confirmImpl ? confirmImpl(o) : Promise.resolve(window.confirm(o.title)));

export function ConfirmHost() {
  const [state, setState] = React.useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => {
    confirmImpl = (o) =>
      new Promise((resolve) => {
        setTyped('');
        setState({ ...o, resolve });
      });
    return () => {
      confirmImpl = null;
    };
  }, []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const blocked = !!state?.typeToConfirm && typed !== state.typeToConfirm;
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ''}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)} autoFocus>
            {state?.confirm ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-fg-muted">
        {state?.body}
        {state?.typeToConfirm && (
          <Field label={`Type "${state.typeToConfirm}" to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Display

export function Badge({ children, tone = 'neutral', className, dot }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'; className?: string; dot?: boolean }) {
  const tones = {
    neutral: 'bg-active text-fg-muted',
    accent: 'bg-accent-soft text-accent-text',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  } as const;
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-sunken px-1 font-mono text-[10.5px] text-fg-subtle">{children}</kbd>;
}

export function Card({ children, className, title, action, padded = true, description }: { children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode; padded?: boolean; description?: React.ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-panel shadow-card', className)}>
      {(title || action) && (
        <header className="flex min-h-[42px] items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold">{title}</h3>
            {description && <p className="truncate text-[12px] text-fg-subtle">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, body, action, compact }: { icon: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16')}>
      <div className="grid size-10 place-items-center rounded-lg border border-line bg-raised text-fg-muted [&>svg]:size-[18px]">{icon}</div>
      <div className="space-y-1">
        <p className="text-[13.5px] font-medium">{title}</p>
        {body && <p className="mx-auto max-w-[380px] text-[12.5px] text-fg-muted">{body}</p>}
      </div>
      {action && <div className="mt-1 flex gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-active', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-fg-subtle', className)} aria-label="Loading" />;
}

export function Avatar({ name, url, id, size = 24, online, className }: { name: string; url?: string | null; id?: string; size?: number; online?: boolean; className?: string }) {
  const [broken, setBroken] = React.useState(false);
  const h = hueFor(id || name);
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {url && !broken ? (
        <img src={url} alt="" onError={() => setBroken(true)} className="size-full rounded-full object-cover ring-1 ring-line" />
      ) : (
        <span
          className="grid size-full place-items-center rounded-full font-semibold"
          style={{ background: `hsl(${h} 45% 30%)`, color: `hsl(${h} 80% 88%)`, fontSize: Math.max(9, size * 0.4) }}
          aria-hidden
        >
          {initials(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={cn('absolute -bottom-px -right-px rounded-full ring-2 ring-panel', online ? 'bg-success' : 'bg-fg-subtle')}
          style={{ width: Math.max(7, size * 0.32), height: Math.max(7, size * 0.32) }}
          aria-label={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}

export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  const color = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-active', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions, icon }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone, onClick }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: 'danger' | 'success' | 'warning'; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-panel px-4 py-3 text-left transition-colors', onClick && 'hover:border-line-strong hover:bg-raised')}>
      <div className="flex items-center justify-between gap-2 text-[12px] text-fg-muted">
        <span className="truncate">{label}</span>
        {icon && <span className="text-fg-subtle [&>svg]:size-3.5">{icon}</span>}
      </div>
      <div className={cn('tabular truncate text-[22px] font-semibold tracking-[-0.02em]', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</div>
      {hint && <div className="truncate text-[12px] text-fg-subtle">{hint}</div>}
    </Comp>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode; count?: number; icon?: React.ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'relative -mb-px inline-flex h-9 items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors [&>svg]:size-3.5',
            value === t.value ? 'text-fg after:absolute after:inset-x-1.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-accent' : 'text-fg-muted hover:text-fg',
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className="tabular rounded-[4px] bg-active px-1 text-[11px] text-fg-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="xs" variant="ghost" onClick={onRetry} className="text-danger">
          Retry
        </Button>
      )}
    </div>
  );
}

export function Notice({ children, tone = 'info', icon, action }: { children: React.ReactNode; tone?: 'info' | 'warning' | 'neutral' | 'success'; icon?: React.ReactNode; action?: React.ReactNode }) {
  const tones = { info: 'border-info/25 bg-info-soft', warning: 'border-warning/25 bg-warning-soft', neutral: 'border-line bg-raised', success: 'border-success/25 bg-success-soft' };
  const iconTone = { info: 'text-info', warning: 'text-warning', neutral: 'text-fg-muted', success: 'text-success' };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] text-fg', tones[tone])}>
      {icon && <span className={cn('mt-0.5 [&>svg]:size-3.5', iconTone[tone])}>{icon}</span>}
      <div className="min-w-0 flex-1 text-fg-muted">{children}</div>
      {action}
    </div>
  );
}
