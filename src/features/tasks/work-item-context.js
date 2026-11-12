'use client';

import { createContext, useContext } from 'react';
import { epicProgress, projectLabels } from '@/lib/work-items';

/**
 * What cards, rows and the task sheet need to know about a project's other work items: its
 * epics (with progress and items), and the labels it uses. Built once per task list by
 * `buildWorkItemIndex` and shared through `WorkItemContext`, so the board needs no extra props.
 */
export function buildWorkItemIndex(tasks = []) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const epics = tasks.filter((task) => task.type === 'Epic');
  const items = new Map(epics.map((epic) => [epic.id, tasks.filter((task) => task.epicId === epic.id)]));
  const progress = new Map(epics.map((epic) => [epic.id, epicProgress(epic.id, tasks)]));
  return { byId, epics, items, progress, labels: projectLabels(tasks).map(({ label }) => label) };
}

const EMPTY = buildWorkItemIndex([]);

export const WorkItemContext = createContext(EMPTY);

export const useWorkItems = () => useContext(WorkItemContext);
