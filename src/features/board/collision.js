import { pointerWithin } from '@dnd-kit/core';

/** The column that shares the largest area with the dragged card, or none. */
function mostOverlapped({ collisionRect, droppableRects, droppableContainers }) {
  let best = null;
  for (const droppableContainer of droppableContainers) {
    const rect = droppableRects.get(droppableContainer.id);
    if (!rect) continue;
    const width = Math.min(collisionRect.left + collisionRect.width, rect.left + rect.width) - Math.max(collisionRect.left, rect.left);
    const height = Math.min(collisionRect.top + collisionRect.height, rect.top + rect.height) - Math.max(collisionRect.top, rect.top);
    const value = width > 0 && height > 0 ? width * height : 0;
    if (value > (best?.data.value ?? 0)) best = { id: droppableContainer.id, data: { droppableContainer, value } };
  }
  return best ? [best] : [];
}

/**
 * Which column a dragged card is over. The column under the pointer wins; with the keyboard (no
 * pointer) or in the gap between columns, the column the card overlaps most.
 *
 * The board used closestCorners, which compares the card with all four corners of each column.
 * A column much taller than its neighbour (a long Done list next to a short In Progress) has
 * far-away bottom corners, so a card held at its top counted as "over" the short neighbour and
 * the drop did nothing. Area shared with the card does not depend on how tall the column is.
 */
export function columnCollision(args) {
  const underPointer = pointerWithin(args);
  return underPointer.length ? underPointer : mostOverlapped(args);
}
