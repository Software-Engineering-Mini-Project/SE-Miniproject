export { Comment } from './comment.js';
export { LoginAttempt } from './login-attempt.js';
export { Notification } from './notification.js';
export { Project } from './project.js';
export { Task } from './task.js';
export { User } from './user.js';

import { Comment } from './comment.js';
import { LoginAttempt } from './login-attempt.js';
import { Notification } from './notification.js';
import { Project } from './project.js';
import { Task } from './task.js';
import { User } from './user.js';

export const models = [User, Project, Task, Comment, Notification, LoginAttempt];
