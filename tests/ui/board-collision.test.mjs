// Which column a dragged card counts as being over (src/features/board/collision.js).
import { describe, expect, it } from 'vitest';
import { closestCorners } from '@dnd-kit/core';
import { columnCollision } from '@/features/board/collision';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// Three columns side by side; Done holds many cards, so it is far taller than In Progress.
const columns = { 'To Do': rect(0, 450, 500, 650), 'In Progress': rect(520, 450, 500, 420), Done: rect(1040, 450, 500, 1620) };
const droppableRects = new Map(Object.entries(columns));
const droppableContainers = Object.keys(columns).map((id) => ({ id, rect: { current: columns[id] }, data: { current: {} }, disabled: false }));
const over = (collisionRect, pointerCoordinates = null) =>
  columnCollision({ active: { id: 'task' }, collisionRect, droppableRects, droppableContainers, pointerCoordinates })[0]?.id;

describe('columnCollision', () => {
  // The keyboard puts the card at the top of the target column, 56px down, centred.
  const atTopOfDone = rect(1040 + 250 - 235, 450 + 56, 470, 200);

  it('keyboard: a card at the top of a long column is over that column', () => {
    expect(over(atTopOfDone)).toBe('Done');
    // The detection the board used before picked the short neighbour, so the drop did nothing.
    expect(closestCorners({ active: { id: 'task' }, collisionRect: atTopOfDone, droppableRects, droppableContainers, pointerCoordinates: null })[0].id).toBe('In Progress');
  });

  it('pointer: the column under the pointer wins, wherever the card was grabbed', () => {
    expect(over(rect(900, 480, 470, 200), { x: 1300, y: 570 })).toBe('Done');
    expect(over(rect(560, 480, 470, 200), { x: 700, y: 560 })).toBe('In Progress');
  });

  it('pointer in the gap between columns: the column the card overlaps most', () => {
    expect(over(rect(700, 480, 470, 200), { x: 1030, y: 560 })).toBe('In Progress');
    expect(over(rect(900, 480, 470, 200), { x: 1030, y: 560 })).toBe('Done');
  });

  it('a card held away from every column is over nothing', () => {
    expect(over(rect(0, 0, 470, 200), { x: 200, y: 100 })).toBeUndefined();
  });
});
