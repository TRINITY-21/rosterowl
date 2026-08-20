import { describe, expect, it } from 'vitest';
import { TEMPLATES, desksMatchTemplate } from '../src/lib/geometry';

// Regression (user report): layout landing pages must know whether the saved
// room already matches the promised template, so the "switch to this layout"
// banner shows exactly when it should.
describe('desksMatchTemplate', () => {
  it('matches every template against its own make()', () => {
    for (const tpl of TEMPLATES) {
      expect(desksMatchTemplate(tpl.make(), tpl.key)).toBe(true);
    }
  });

  it('does not match a different template', () => {
    expect(desksMatchTemplate(TEMPLATES[0]!.make(), 'u-26')).toBe(false);
  });

  it('stops matching once a desk moves a real grid step', () => {
    const desks = TEMPLATES.find((t) => t.key === 'u-26')!.make();
    desks[0]!.x += 1.5;
    expect(desksMatchTemplate(desks, 'u-26')).toBe(false);
  });

  // Regression (review): drag snapping rounds to the 0.5 grid while template
  // coordinates sit off it — a desk dragged away and dropped back must match.
  it('tolerates snap-grid drift: desks rounded to the 0.5 grid still match', () => {
    const desks = TEMPLATES.find((t) => t.key === 'groups4-6')!.make();
    for (const d of desks) {
      d.x = Math.round(d.x * 2) / 2;
      d.y = Math.round(d.y * 2) / 2;
    }
    expect(desksMatchTemplate(desks, 'groups4-6')).toBe(true);
  });

  it('tolerates floating-point drift below the grid step', () => {
    const desks = TEMPLATES.find((t) => t.key === 'u-26')!.make();
    desks[0]!.x += 0.0000001;
    desks[1]!.y -= 0.0000001;
    expect(desksMatchTemplate(desks, 'u-26')).toBe(true);
  });

  it('is false for unknown keys', () => {
    expect(desksMatchTemplate(TEMPLATES[0]!.make(), 'no-such-layout')).toBe(false);
  });
});
