import type { AccentId } from '../../shared/types';

export interface AccentTheme {
  id: AccentId;
  label: string;
  hex: string;
  rgb: string;
}

export const ACCENTS: Record<AccentId, AccentTheme> = {
  teal: { id: 'teal', label: 'Reactor Teal', hex: '#43f5cf', rgb: '67, 245, 207' },
  cyan: { id: 'cyan', label: 'Cold Cyan', hex: '#5fd8ff', rgb: '95, 216, 255' },
  amber: { id: 'amber', label: 'Solar Amber', hex: '#ffbe63', rgb: '255, 190, 99' },
  violet: { id: 'violet', label: 'Ion Violet', hex: '#b490ff', rgb: '180, 144, 255' },
  rose: { id: 'rose', label: 'Alert Rose', hex: '#ff7f9f', rgb: '255, 127, 159' },
};

export const ACCENT_LIST = Object.values(ACCENTS);

export function accentHex(id: AccentId | undefined): string {
  return ACCENTS[id ?? 'teal']?.hex ?? ACCENTS.teal.hex;
}

export function applyAccent(id: AccentId): void {
  const theme = ACCENTS[id] ?? ACCENTS.teal;
  const root = document.documentElement;
  root.dataset.accent = theme.id;
  root.style.setProperty('--accent', theme.hex);
  root.style.setProperty('--accent-rgb', theme.rgb);
}
