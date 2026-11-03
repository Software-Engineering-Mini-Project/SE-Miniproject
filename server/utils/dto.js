import { User } from '../models/index.js';

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
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function projectDto(project) {
  const userIds = project.memberIds.map(String);
  const users = await User.find({ _id: { $in: userIds } });
  const membersById = new Map(users.map((user) => [user.id, memberDto(user)]));
  return {
    ...project.toJSON(),
    members: userIds.map((id) => membersById.get(id)).filter(Boolean),
  };
}

export async function projectDtos(projects) {
  return Promise.all(projects.map(projectDto));
}

export async function commentDto(comment) {
  const author = await User.findById(comment.authorId);
  return {
    ...comment.toJSON(),
    author: author ? memberDto(author) : null,
  };
}

export async function commentDtos(comments) {
  return Promise.all(comments.map(commentDto));
}
