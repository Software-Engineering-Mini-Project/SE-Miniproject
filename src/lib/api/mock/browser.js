// Browser wiring for the mock API: seeds from fixtures and persists to localStorage
// so a refresh keeps demo changes. Loaded lazily, only in mock mode.

import users from '@fixtures/users.json';
import projects from '@fixtures/projects.json';
import tasks from '@fixtures/tasks.json';
import comments from '@fixtures/comments.json';
import notifications from '@fixtures/notifications.json';
import { createMockServer } from './server.js';

let server = null;

function safeStorage() {
  try {
    const storage = window.localStorage;
    const probe = '__taskline_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function getBrowserMockServer() {
  if (!server) {
    server = createMockServer({
      seed: { users, projects, tasks, comments, notifications },
      storage: typeof window === 'undefined' ? null : safeStorage(),
    });
  }
  return server;
}
