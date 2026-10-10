import type { AccentPreset, AppTheme } from '@/shared/types';

export interface AccentTone {
  name: string;
  value: AccentPreset;
  hex: string;
}

export interface ThemeColorTokens {
  background: string;
  border: string;
  borderStrong: string;
  canvasBackground: string;
  overlay: string;
  danger: string;
  dangerBackground: string;
  dangerBorderSoft: string;
  dangerHighlight: string;
  dangerHighlightBorder: string;
  dangerHighlightSoft: string;
  dangerText: string;
  faint: string;
  muted: string;
  onPrimary: string;
  panel: string;
  panelMuted: string;
  primary: string;
  primaryBorder: string;
  primaryHover: string;
  primaryPressed: string;
  primarySoft: string;
  scrollbar: string;
  scrollbarTrack: string;
  scrollbarHover: string;
  shadowFloating: string;
  shadowSubtle: string;
  success: string;
  successBackground: string;
  surface: string;
  surfaceActive: string;
  surfaceHover: string;
  text: string;
  textSoft: string;
  warning: string;
  warningBackground: string;
  warningBorder: string;
}

export const THEME_TOKEN_MAP = {
  '--color-bg': 'background',
  '--color-overlay': 'overlay',
  '--color-panel': 'panel',
  '--color-panel-muted': 'panelMuted',
  '--color-surface': 'surface',
  '--color-surface-hover': 'surfaceHover',
  '--color-surface-active': 'surfaceActive',
  '--color-border': 'border',
  '--color-border-strong': 'borderStrong',
  '--color-text': 'text',
  '--color-text-soft': 'textSoft',
  '--color-muted': 'muted',
  '--color-faint': 'faint',
  '--color-primary': 'primary',
  '--color-primary-hover': 'primaryHover',
  '--color-primary-pressed': 'primaryPressed',
  '--color-primary-soft': 'primarySoft',
  '--color-primary-border': 'primaryBorder',
  '--color-on-primary': 'onPrimary',
  '--color-warning': 'warning',
  '--color-warning-bg': 'warningBackground',
  '--color-warning-border': 'warningBorder',
  '--color-danger': 'danger',
  '--color-success': 'success',
  '--color-success-bg': 'successBackground',
  '--color-danger-bg': 'dangerBackground',
  '--color-danger-text': 'dangerText',
  '--color-danger-border-soft': 'dangerBorderSoft',
  '--color-danger-highlight-soft': 'dangerHighlightSoft',
  '--color-danger-highlight': 'dangerHighlight',
  '--color-danger-highlight-border': 'dangerHighlightBorder',
  '--color-canvas-bg': 'canvasBackground',
  '--scrollbar-thumb': 'scrollbar',
  '--scrollbar-track': 'scrollbarTrack',
  '--scrollbar-thumb-hover': 'scrollbarHover',
  '--shadow-floating': 'shadowFloating',
  '--shadow-subtle': 'shadowSubtle',
} as const satisfies Record<string, keyof ThemeColorTokens>;

export const ACCENT_PRESETS: AccentTone[] = [
  { name: '蓝', value: 'blue', hex: '#2563eb' },
  { name: '橙', value: 'orange', hex: '#ea580c' },
  { name: '绿', value: 'green', hex: '#16a34a' },
  { name: '青', value: 'cyan', hex: '#0891b2' },
  { name: '粉', value: 'pink', hex: '#db2777' },
  { name: '紫', value: 'purple', hex: '#7c3aed' },
  { name: '灰', value: 'gray', hex: '#64748b' },
];

export function createThemeColors(hex: string, themeValue: AppTheme): ThemeColorTokens {
  const isDarkTheme = themeValue === 'dark';
  const neutralColors = isDarkTheme ? darkThemeColors(hex) : lightThemeColors(hex);
  const primaryHover = mixHex(hex, isDarkTheme ? '#ffffff' : '#000000', isDarkTheme ? 0.18 : 0.12);
  const primaryPressed = mixHex(hex, '#000000', isDarkTheme ? 0.18 : 0.22);
  const primarySoft = mixHex(hex, isDarkTheme ? '#0f1115' : '#ffffff', isDarkTheme ? 0.78 : 0.88);
  const primaryBorder = mixHex(hex, isDarkTheme ? '#0f1115' : '#ffffff', isDarkTheme ? 0.52 : 0.62);

  return {
    background: neutralColors['--color-bg'],
    border: neutralColors['--color-border'],
    borderStrong: neutralColors['--color-border-strong'],
    canvasBackground: neutralColors['--color-canvas-bg'],
    overlay: isDarkTheme ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.42)',
    danger: isDarkTheme ? '#f87171' : '#dc2626',
    dangerBackground: isDarkTheme ? '#450a0a' : '#fee2e2',
    dangerBorderSoft: isDarkTheme ? 'rgba(248, 113, 113, 0.28)' : 'rgba(220, 38, 38, 0.28)',
    dangerHighlight: isDarkTheme ? 'rgba(248, 113, 113, 0.16)' : 'rgba(220, 38, 38, 0.16)',
    dangerHighlightBorder: isDarkTheme ? 'rgba(248, 113, 113, 0.35)' : 'rgba(220, 38, 38, 0.35)',
    dangerHighlightSoft: isDarkTheme ? 'rgba(248, 113, 113, 0.12)' : 'rgba(220, 38, 38, 0.12)',
    dangerText: isDarkTheme ? '#fca5a5' : '#991b1b',
    faint: neutralColors['--color-faint'],
    muted: neutralColors['--color-muted'],
    onPrimary: '#ffffff',
    panel: neutralColors['--color-panel'],
    panelMuted: neutralColors['--color-panel-muted'],
    primary: hex,
    primaryBorder,
    primaryHover,
    primaryPressed,
    primarySoft,
    scrollbar: neutralColors['--scrollbar-thumb'],
    scrollbarTrack: 'transparent',
    scrollbarHover: neutralColors['--scrollbar-thumb-hover'],
    shadowFloating: neutralColors['--shadow-floating'],
    shadowSubtle: neutralColors['--shadow-subtle'],
    success: isDarkTheme ? '#86efac' : '#166534',
    successBackground: isDarkTheme ? '#14532d' : '#dcfce7',
    surface: neutralColors['--color-surface'],
    surfaceActive: neutralColors['--color-surface-active'],
    surfaceHover: neutralColors['--color-surface-hover'],
    text: isDarkTheme ? '#e6e7eb' : '#1f2328',
    textSoft: neutralColors['--color-text-soft'],
    warning: isDarkTheme ? '#fbbf24' : '#b7791f',
    warningBackground: isDarkTheme ? '#3b2d13' : '#fff7df',
    warningBorder: isDarkTheme ? '#6b4d16' : '#f4d58d',
  };
}

type NeutralColorName =
  | '--color-bg'
  | '--color-panel'
  | '--color-panel-muted'
  | '--color-surface'
  | '--color-surface-hover'
  | '--color-surface-active'
  | '--color-border'
  | '--color-border-strong'
  | '--color-text-soft'
  | '--color-muted'
  | '--color-faint'
  | '--color-canvas-bg'
  | '--scrollbar-thumb'
  | '--scrollbar-thumb-hover'
  | '--shadow-floating'
  | '--shadow-subtle';

type NeutralColors = Record<NeutralColorName, string>;

function lightThemeColors(hex: string): NeutralColors {
  const hue = hueFromHex(hex);
  return {
    '--color-bg': themedGray(hue, 3, 97),
    '--color-panel': themedGray(hue, 2, 100),
    '--color-panel-muted': themedGray(hue, 3, 95),
    '--color-surface': themedGray(hue, 5, 93),
    '--color-surface-hover': themedGray(hue, 7, 90),
    '--color-surface-active': themedGray(hue, 9, 87),
    '--color-border': themedGray(hue, 6, 85),
    '--color-border-strong': themedGray(hue, 8, 75),
    '--color-text-soft': themedGray(hue, 4, 14),
    '--color-muted': themedGray(hue, 4, 46),
    '--color-faint': themedGray(hue, 3, 64),
    '--color-canvas-bg': themedGray(hue, 7, 5),
    '--scrollbar-thumb': themedGray(hue, 6, 84),
    '--scrollbar-thumb-hover': themedGray(hue, 7, 66),
    '--shadow-floating': `0 24px 70px ${hexToRgba(themedGray(hue, 6, 10), 0.18)}`,
    '--shadow-subtle': `0 1px 2px ${hexToRgba(themedGray(hue, 4, 10), 0.04)}`,
  };
}

function darkThemeColors(hex: string): NeutralColors {
  const hue = hueFromHex(hex);
  return {
    '--color-bg': themedGray(hue, 4, 3),
    '--color-panel': themedGray(hue, 5, 8),
    '--color-panel-muted': themedGray(hue, 5, 6),
    '--color-surface': themedGray(hue, 7, 12),
    '--color-surface-hover': themedGray(hue, 9, 16),
    '--color-surface-active': themedGray(hue, 11, 21),
    '--color-border': themedGray(hue, 8, 19),
    '--color-border-strong': themedGray(hue, 10, 26),
    '--color-text-soft': themedGray(hue, 4, 75),
    '--color-muted': themedGray(hue, 4, 61),
    '--color-faint': themedGray(hue, 4, 43),
    '--color-canvas-bg': themedGray(hue, 7, 5),
    '--scrollbar-thumb': themedGray(hue, 7, 28),
    '--scrollbar-thumb-hover': themedGray(hue, 8, 40),
    '--shadow-floating': '0 24px 80px rgba(0, 0, 0, 0.42)',
    '--shadow-subtle': '0 1px 2px rgba(0, 0, 0, 0.22)',
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function mixHex(hex: string, target: string, ratio: number): string {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);
  const mix = {
    r: Math.round(from.r + (to.r - from.r) * ratio),
    g: Math.round(from.g + (to.g - from.g) * ratio),
    b: Math.round(from.b + (to.b - from.b) * ratio),
  };
  return rgbToHex(mix.r, mix.g, mix.b);
}

function themedGray(hue: number, saturation: number, lightness: number): string {
  return hslToHex(hue, saturation, lightness);
}

function hueFromHex(hex: string): number {
  const rgb = hexToRgb(hex);
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 220;
  if (max === r) return normalizeHue(60 * (((g - b) / delta) % 6));
  if (max === g) return normalizeHue(60 * ((b - r) / delta + 2));
  return normalizeHue(60 * ((r - g) / delta + 4));
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function hexToRgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
