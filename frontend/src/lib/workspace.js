'use client';

// Workspace-level data shared by the shell and pages: the user's projects and unread count.

import { create } from 'zustand';
import { api } from './api/client.js';

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
      const page = await api.notifications.list(1);
      set({ unreadCount: page.unreadCount ?? page.items.filter((n) => !n.read).length });
      return page;
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
