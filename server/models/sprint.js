import mongoose from 'mongoose';
import { createSchema } from './schema.js';
import { SPRINT_GOAL_MAX, SPRINT_NAME_MAX, SPRINT_STATES } from '../../src/lib/sprints.js';

/**
 * A time-boxed sprint in a project (issue #76; rules in src/lib/sprints.js). Planned, then active,
 * then completed. `committed` is what the sprint held when it started; `report` is what it
 * finished and what moved on when it completed, so the record survives later edits.
 */
const sprintSchema = createSchema({
  projectId: { type: String, ref: 'Project', required: true },
  // Order within the project (Sprint 1, Sprint 2 ...); taken from Project.sprintCounter.
  number: { type: Number, min: 1, required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: SPRINT_NAME_MAX },
  goal: { type: String, default: '', maxlength: SPRINT_GOAL_MAX },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  state: { type: String, enum: SPRINT_STATES, default: 'planned', required: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  committed: { type: mongoose.Schema.Types.Mixed, default: null },
  report: { type: mongoose.Schema.Types.Mixed, default: null },
}, { minimize: false });

sprintSchema.index({ projectId: 1, number: 1 }, { unique: true });
// At most one active sprint per project, enforced by the database as well as the route.
sprintSchema.index({ projectId: 1, state: 1 }, { unique: true, partialFilterExpression: { state: 'active' } });

export const Sprint = mongoose.models.Sprint || mongoose.model('Sprint', sprintSchema);
