'use client';

// Workspace-level data shared by the shell and pages after sign-in.

import { localToday } from './dates.js';
import { create } from 'zustand';
import { api } from './api/client.js';
import { prefetchQuery } from './hooks/useQuery.js';

export const useWorkspace = create((set, get) => ({
  projects: null,
  projectsError: null,
  unreadCount: 0,

  async loadProjects() {
    try {
      const projects = await api.projects.list();
      set({ projects, projectsError: null });
      return projects;
    } catch (error) {
      set({ projectsError: error });
      return get().projects;
    }
  },

  upsertProject(project) {
    const list = get().projects || [];
    const exists = list.some((p) => p.id === project.id);
    set({ projects: exists ? list.map((p) => (p.id === project.id ? project : p)) : [...list, project] });
  },

  removeProject(projectId) {
    set({ projects: (get().projects || []).filter((p) => p.id !== projectId) });
  },

  async loadUnread() {
    try {
      const page = await api.notifications.unreadCount();
      set({ unreadCount: page.unreadCount ?? page.items.filter((n) => !n.read).length });
      return page;
    } catch {
      return null;
    }
  },

  async loadDashboard(userId) {
    if (!userId) return null;
    try {
      const today = localToday();
      return await prefetchQuery(`dashboard:${userId}:${today}`, () => api.dashboard.get(today));
    } catch {
      return null;
    }
  },

  setUnread(unreadCount) {
    set({ unreadCount: Math.max(0, unreadCount) });
  },

  clear() {
    set({ projects: null, projectsError: null, unreadCount: 0 });
  },
}));
