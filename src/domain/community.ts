export type ContributorLevel = {
  level: number;
  name: string;
  floor: number;
  ceiling: number | null;
  progress: number;
  pointsToNext: number;
};

const LEVELS = [
  {level: 1, name: 'New Scout', floor: 0},
  {level: 2, name: 'Queue Scout', floor: 250},
  {level: 3, name: 'Radar Regular', floor: 750},
  {level: 4, name: 'Local Expert', floor: 1500},
  {level: 5, name: 'WashRadar Hero', floor: 3000},
] as const;

export function contributorLevel(points: number): ContributorLevel {
  const safePoints = Math.max(0, Math.floor(Number.isFinite(points) ? points : 0));
  let index = LEVELS.findLastIndex((item) => safePoints >= item.floor);
  if (index < 0) index = 0;
  const current = LEVELS[index];
  const next = LEVELS[index + 1];
  if (!next) {
    return {level: current.level, name: current.name, floor: current.floor, ceiling: null, progress: 1, pointsToNext: 0};
  }
  const span = next.floor - current.floor;
  const progress = Math.min(1, Math.max(0, (safePoints - current.floor) / span));
  return {
    level: current.level,
    name: current.name,
    floor: current.floor,
    ceiling: next.floor,
    progress,
    pointsToNext: Math.max(0, next.floor - safePoints),
  };
}

export function initials(displayName: string | null | undefined, email: string | null | undefined) {
  const source = displayName?.trim() || email?.split('@')[0] || 'WR';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
