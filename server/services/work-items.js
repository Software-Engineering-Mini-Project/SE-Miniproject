import { Project } from '../models/index.js';
import { formatTaskKey, normalizeProjectKey, projectKeyError, suggestProjectKey, withWorkItemDefaults } from '../../src/lib/work-items.js';
import { HttpError } from '../utils/http-error.js';
import { toApi } from '../utils/to-api.js';

/** Every key used in the organisation, now or before, except by `exceptProjectId`. */
export async function takenProjectKeys(organisationId, exceptProjectId) {
  const filter = { organisationId };
  if (exceptProjectId) filter._id = { $ne: exceptProjectId };
  const projects = await Project.find(filter).select('key previousKeys').lean();
  return new Set(projects.flatMap((project) => [project.key, ...(project.previousKeys ?? [])]).filter(Boolean));
}

function keyTaken() {
  return new HttpError(409, 'KEY_TAKEN', 'Another project in your organisation uses that key.', {
    key: 'This key is taken. Choose another.',
  });
}

/** Validates a key someone typed; throws a 400 with a field error when it is not usable. */
export function readProjectKey(body) {
  const key = normalizeProjectKey(body.key);
  const error = projectKeyError(key);
  if (error) throw new HttpError(400, 'VALIDATION_ERROR', error, { key: error });
  return key;
}

export const isDuplicateKeyError = (error) => error?.code === 11000 && Boolean(error.keyPattern?.key);

/**
 * Creates a project with a key: the requested one (409 when taken), or one suggested from the
 * name. Two projects created at once can pick the same suggestion; the unique index rejects the
 * second, which then retries with a fresh suggestion.
 */
export async function createProjectWithKey(fields, requestedKey) {
  for (let attempt = 0; ; attempt += 1) {
    const taken = await takenProjectKeys(fields.organisationId);
    if (requestedKey && taken.has(requestedKey)) throw keyTaken();
    const key = requestedKey ?? suggestProjectKey(fields.name, taken);
    try {
      return await Project.create({ ...fields, key, previousKeys: [], taskCounter: 0 });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      if (requestedKey || attempt >= 4) throw keyTaken();
    }
  }
}

/**
 * Gives `project` (a document) the key `nextKey`. The old key is kept in previousKeys so links
 * and searches that use it keep working; going back to an old key takes it out of that list.
 */
export async function changeProjectKey(project, nextKey) {
  if (nextKey === project.key) return;
  const taken = await takenProjectKeys(project.organisationId, project.id);
  if (taken.has(nextKey)) throw keyTaken();
  const previous = new Set(project.previousKeys ?? []);
  if (project.key) previous.add(project.key);
  previous.delete(nextKey);
  project.key = nextKey;
  project.previousKeys = [...previous];
}

/** Reserves the next task number in a project. Atomic, so simultaneous creates never share one. */
export async function nextTaskNumber(projectId) {
  const updated = await Project.findOneAndUpdate(
    { _id: projectId },
    { $inc: { taskCounter: 1 } },
    { returnDocument: 'after', projection: { taskCounter: 1 } },
  ).lean();
  if (!updated) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  return updated.taskCounter;
}

/** A task in API shape with its `key` (null until it has a number) and work-item fields. */
export function taskDto(task, projectKey) {
  const dto = withWorkItemDefaults(toApi(task));
  dto.number = Number.isInteger(dto.number) ? dto.number : null;
  dto.key = formatTaskKey(projectKey, dto.number);
  return dto;
}

/** Tasks from any projects, each with its key; loads the keys of the projects involved. */
export async function taskDtos(tasks, knownKeys = new Map()) {
  const missing = [...new Set(tasks.map((task) => String(task.projectId)))].filter((id) => !knownKeys.has(id));
  const keys = new Map(knownKeys);
  if (missing.length) {
    const projects = await Project.find({ _id: { $in: missing } }).select('_id key').lean();
    for (const project of projects) keys.set(String(project._id), project.key ?? null);
  }
  return tasks.map((task) => taskDto(task, keys.get(String(task.projectId)) ?? null));
}
