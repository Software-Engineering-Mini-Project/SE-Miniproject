import { User } from '../models/index.js';
import { toApi } from './to-api.js';

export function userDto(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function memberDto(user) {
  return { id: String(user._id ?? user.id), name: user.name, email: user.email, role: user.role };
}

export async function projectDto(project) {
  const userIds = project.memberIds.map(String);
  const users = await User.find({ _id: { $in: userIds } }).select('_id name email role').lean();
  const membersById = new Map(users.map((user) => [String(user._id), memberDto(user)]));
  return {
    ...toApi(project),
    members: userIds.map((id) => membersById.get(id)).filter(Boolean),
  };
}

export async function projectDtos(projects) {
  const userIds = [...new Set(projects.flatMap((project) => project.memberIds.map(String)))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('_id name email role').lean()
    : [];
  const membersById = new Map(users.map((user) => [String(user._id), memberDto(user)]));
  return projects.map((project) => ({
    ...toApi(project),
    members: project.memberIds.map(String).map((id) => membersById.get(id)).filter(Boolean),
  }));
}

export async function commentDto(comment) {
  const author = await User.findById(comment.authorId).select('_id name email role').lean();
  return {
    ...toApi(comment),
    author: author ? memberDto(author) : null,
  };
}

export async function commentDtos(comments) {
  const authorIds = [...new Set(comments.map((comment) => String(comment.authorId)))];
  const authors = authorIds.length
    ? await User.find({ _id: { $in: authorIds } }).select('_id name email role').lean()
    : [];
  const authorsById = new Map(authors.map((author) => [String(author._id), memberDto(author)]));
  return comments.map((comment) => ({
    ...toApi(comment),
    author: authorsById.get(String(comment.authorId)) ?? null,
  }));
}
