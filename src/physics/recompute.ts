// 稳定校核编排：每次布局变更后自下而上逐块重算，结果写回 placement.check
import { Placement } from '../core/types';
import { store } from '../core/store';
import { checkStability, RockBody } from './solver';

export function recomputeAll(bodies: Map<string, RockBody>): void {
  const { project, settings } = store;
  // 自下而上：按落位高度排序，保证支撑石先校核
  const ordered = [...project.placements].sort(
    (a, b) => a.position[1] - b.position[1] || a.order - b.order);
  const topOrder = Math.max(0, ...project.placements.map(p => p.order));

  for (const p of ordered) {
    const body = bodies.get(p.id);
    if (!body) continue;
    const otherBodies = [...bodies.values()].filter(b => b.placement.id !== p.id);
    const isTop = p.order === topOrder && topOrder > 0;
    p.check = checkStability(otherBodies, body, {
      minContactRatio: settings.minContactRatio,
      safeOverturnFactor: settings.safeOverturnFactor,
      isTopStone: isTop
    });
  }
}

export function dangerCount(placements: Placement[]): number {
  return placements.filter(p => p.check?.status === 'danger').length;
}
export function warnCount(placements: Placement[]): number {
  return placements.filter(p => p.check?.status === 'warn').length;
}
