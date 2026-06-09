export const DEEP_DIVE_MODES = [
  { id: 'explain', labelDe: 'Verstehen', labelEn: 'Understand', descDe: 'Idee und Zusammenhang', descEn: 'Idea and context' },
  { id: 'example', labelDe: 'Beispiel', labelEn: 'Example', descDe: 'Ein durchgerechnetes Beispiel', descEn: 'One worked example' },
  { id: 'trap', labelDe: 'Prüfungsfalle', labelEn: 'Exam trap', descDe: 'Typischer Fehler', descEn: 'Typical mistake' },
  { id: 'compare', labelDe: 'Kursbezug', labelEn: 'Course link', descDe: 'Vergleich mit Vorlesung davor', descEn: 'Compare to prior lecture' },
];

export function modeLabel(mode, isGerman) {
  const m = DEEP_DIVE_MODES.find((x) => x.id === mode) || DEEP_DIVE_MODES[0];
  return isGerman ? m.labelDe : m.labelEn;
}
