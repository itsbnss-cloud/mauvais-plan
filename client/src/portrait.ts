// Portraits SVG des cambrioleurs pour l'accueil et le salon.
const COLORS = [
  { main: '#8b5cf6', dark: '#5b34c4', light: '#c9b6ff' },
  { main: '#f97316', dark: '#c2410c', light: '#ffc48f' },
];

export function thiefSvg(seat: number): string {
  const c = COLORS[seat] ?? COLORS[0];
  return `<svg viewBox="0 0 84 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="42" cy="95" rx="24" ry="5" fill="#000" opacity=".2"/>
  <circle cx="60" cy="68" r="15" fill="#c99a5b" stroke="#2a1f3d" stroke-width="3"/>
  <ellipse cx="60" cy="55" rx="5" ry="3" fill="#93683a"/>
  <rect x="26" y="56" width="32" height="32" rx="12" fill="#3a3450" stroke="#2a1f3d" stroke-width="3"/>
  <rect x="26" y="74" width="32" height="5" fill="${c.main}"/>
  <ellipse cx="33" cy="91" rx="7" ry="5" fill="#231d30"/>
  <ellipse cx="51" cy="91" rx="7" ry="5" fill="#231d30"/>
  <circle cx="22" cy="72" r="6" fill="#2b2638" stroke="#2a1f3d" stroke-width="2.5"/>
  <circle cx="42" cy="36" r="27" fill="${c.dark}" stroke="#2a1f3d" stroke-width="3.5"/>
  <circle cx="40" cy="33.5" r="24" fill="${c.main}"/>
  <ellipse cx="31" cy="20" rx="9" ry="5" fill="${c.light}" opacity=".8"/>
  <circle cx="42" cy="8" r="6.5" fill="${c.light}" stroke="#2a1f3d" stroke-width="3"/>
  <rect x="21" y="27" width="42" height="18" rx="9" fill="#f2c4a0" stroke="#2a1f3d" stroke-width="2.5"/>
  <ellipse cx="33" cy="36" rx="4" ry="5" fill="#2a1f3d"/>
  <ellipse cx="51" cy="36" rx="4" ry="5" fill="#2a1f3d"/>
  <circle cx="34.5" cy="34" r="1.5" fill="#fff"/>
  <circle cx="52.5" cy="34" r="1.5" fill="#fff"/>
  <path d="M26 27 L37 30 M58 27 L47 30" stroke="#2a1f3d" stroke-width="3" stroke-linecap="round"/>
  <rect x="35" y="49" width="14" height="8" rx="4" fill="#f2c4a0" stroke="#2a1f3d" stroke-width="2.2"/>
  <path d="M38.5 52 Q42 55.5 45.5 52" fill="none" stroke="#2a1f3d" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;
}

export const ICON_SOUND_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="#2a1f3d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="#ffd34d"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>`;
export const ICON_SOUND_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="#2a1f3d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="#e6dccb"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`;
