import { User } from '../models/index.js';
import { projectRoleOf } from '../../src/lib/permissions.js';
import { toApi } from './to-api.js';

/** User fields the member and author DTOs need; one constant so every query selects the same set. */
export const MEMBER_FIELDS = '_id name email role deactivatedAt';

export function userDto(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: !user.deactivatedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function memberDto(user, project) {
  const id = String(user._id ?? user.id);
  const dto = { id, name: user.name, email: user.email, role: user.role, active: !user.deactivatedAt };
  if (project) dto.projectRole = projectRoleOf(project, id);
  return dto;
}

/** Members of `project` in membership order, each with their project role. */
export async function projectMembers(project) {
  const users = await User.find({ _id: { $in: project.memberIds } }).select(MEMBER_FIELDS).lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  return project.memberIds.map(String).filter((id) => usersById.has(id)).map((id) => memberDto(usersById.get(id), project));
}

export async function projectDto(project) {
  return (await projectDtos([project]))[0];
}

export async function projectDtos(projects) {
  const userIds = [...new Set(projects.flatMap((project) => project.memberIds.map(String)))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select(MEMBER_FIELDS).lean()
    : [];
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  return projects.map((project) => {
    const dto = toApi(project);
    dto.managerIds = (dto.managerIds ?? []).map(String);
    dto.viewerIds = (dto.viewerIds ?? []).map(String);
    dto.visibility = dto.visibility ?? 'private';
    dto.members = project.memberIds.map(String).filter((id) => usersById.has(id)).map((id) => memberDto(usersById.get(id), project));
    return dto;
  });
}

export async function commentDto(comment) {
  return (await commentDtos([comment]))[0];
}

export async function commentDtos(comments) {
  const authorIds = [...new Set(comments.map((comment) => String(comment.authorId)))];
  const authors = authorIds.length
    ? await User.find({ _id: { $in: authorIds } }).select(MEMBER_FIELDS).lean()
    : [];
  const authorsById = new Map(authors.map((author) => [String(author._id), memberDto(author)]));
  return comments.map((comment) => ({
    ...toApi(comment),
    author: authorsById.get(String(comment.authorId)) ?? null,
  }));
}
