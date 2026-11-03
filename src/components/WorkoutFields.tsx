import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

/** Lista suspensa própria (o <select> nativo ignora o tema escuro do app). */
export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { id: T; label: string }[]; onChange(value: T): void; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const openList = () => { setActive(selectedIndex); setOpen(true); };
  const choose = (index: number) => { onChange(options[index].id); setOpen(false); };
  const onKey = (event: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openList(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return <div className={`select${open ? ' is-open' : ''}`} ref={root}>
    <button type="button" className="select__button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={label} onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}>
      <span>{options[selectedIndex].label}</span><Icon name="down" size={16} />
    </button>
    {open && <ul className="select__list" id={listId} role="listbox" aria-label={label}>
      {options.map((option, index) => <li key={option.id} role="option" aria-selected={option.id === value} className={`${index === active ? 'is-active' : ''}${option.id === value ? ' is-selected' : ''}`}
        onPointerEnter={() => setActive(index)} onPointerDown={(event) => { event.preventDefault(); choose(index); }}>
        <span>{option.label}</span>{option.id === value && <Icon name="check" size={16} />}
      </li>)}
    </ul>}
  </div>;
}

function Stepper({ value, max, step, unit, onChange }: { value: number; max: number; step: number; unit: string; onChange(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const set = (next: number) => onChange(Math.min(Math.max(next, 0), max));
  return <div className="stepper">
    <button type="button" className="stepper__btn" onClick={() => set(value - step)} disabled={value <= 0} aria-label={`Diminuir ${unit}`}><span aria-hidden="true">−</span></button>
    <input className="stepper__input" inputMode="numeric" value={draft ?? String(value)} aria-label={unit}
      onFocus={(event) => event.target.select()}
      onChange={(event) => { const digits = event.target.value.replace(/\D/g, '').slice(0, 2); setDraft(digits); if (digits !== '') set(Number(digits)); }}
      onBlur={() => setDraft(null)} />
    <span className="stepper__unit">{unit}</span>
    <button type="button" className="stepper__btn" onClick={() => set(value + step)} disabled={value >= max} aria-label={`Aumentar ${unit}`}><Icon name="plus" size={16} /></button>
  </div>;
}

const PRESETS = [15, 30, 45, 60, 90, 120];

/** Duração em minutos totais: contadores de horas/minutos e atalhos comuns. */
export function DurationField({ minutes, onChange }: { minutes: number; onChange(minutes: number): void }) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return <div className="duration-field">
    <div className="duration-field__steppers">
      <Stepper value={hours} max={24} step={1} unit="h" onChange={(h) => onChange(Math.min(h * 60 + rest, 1440))} />
      <Stepper value={rest} max={59} step={5} unit="min" onChange={(m) => onChange(Math.min(hours * 60 + m, 1440))} />
    </div>
    <div className="chips" role="group" aria-label="Durações rápidas">{PRESETS.map((preset) => <button key={preset} type="button" className={`chip${minutes === preset ? ' is-active' : ''}`} aria-pressed={minutes === preset} onClick={() => onChange(preset)}>{preset < 60 ? `${preset}min` : preset % 60 === 0 ? `${preset / 60}h` : `${Math.floor(preset / 60)}h30`}</button>)}</div>
  </div>;
}

/** Data com atalhos Hoje/Ontem; o seletor nativo fica estilizado no tema escuro. */
export function DateField({ value, max, onChange, today, yesterday }: { value: string; max: string; onChange(value: string): void; today: string; yesterday: string }) {
  return <div className="date-field">
    <input className="input date-field__input" type="date" value={value} max={max} onChange={(event) => onChange(event.target.value)} required />
    <div className="chips" role="group" aria-label="Atalhos de data">
      <button type="button" className={`chip${value === today ? ' is-active' : ''}`} onClick={() => onChange(today)}>Hoje</button>
      <button type="button" className={`chip${value === yesterday ? ' is-active' : ''}`} onClick={() => onChange(yesterday)}>Ontem</button>
    </div>
  </div>;
}
