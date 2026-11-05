import assert from 'node:assert/strict';
import test from 'node:test';
import { User } from '../models/index.js';
import { commentDto, commentDtos, projectDto, projectDtos } from '../utils/dto.js';

function mockUserFind(rows) {
  let calls = 0;
  const original = User.find;
  User.find = (filter) => {
    calls += 1;
    assert.deepEqual(filter, { _id: { $in: ['user-1', 'user-2'] } });
    return {
      select(fields) {
        assert.equal(fields, '_id name email role deactivatedAt');
        return { lean: async () => rows };
      },
    };
  };
  return { getCalls: () => calls, restore: () => { User.find = original; } };
}

test('projectDtos loads member details in one query for the full project list', async () => {
  const query = mockUserFind([
    { _id: 'user-1', name: 'First User', email: 'first@example.test', role: 'Lead' },
    { _id: 'user-2', name: 'Second User', email: 'second@example.test', role: 'Member' },
  ]);
  try {
    const projects = await projectDtos([
      { _id: 'project-1', name: 'One', memberIds: ['user-1'], createdAt: new Date(0), updatedAt: new Date(0) },
      { _id: 'project-2', name: 'Two', memberIds: ['user-1', 'user-2'], createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    assert.equal(query.getCalls(), 1);
    assert.deepEqual(projects.map((project) => project.members.map((member) => member.id)), [['user-1'], ['user-1', 'user-2']]);
    assert.equal(projects[0].id, 'project-1');
    assert.equal('_id' in projects[0], false);
  } finally {
    query.restore();
  }
});

test('commentDtos loads all authors in one query and preserves the safe DTO shape', async () => {
  const query = mockUserFind([
    { _id: 'user-1', name: 'First User', email: 'first@example.test', role: 'Lead' },
    { _id: 'user-2', name: 'Second User', email: 'second@example.test', role: 'Member' },
  ]);
  try {
    const comments = await commentDtos([
      { _id: 'comment-1', taskId: 'task-1', authorId: 'user-1', text: 'First', createdAt: new Date(0), updatedAt: new Date(0) },
      { _id: 'comment-2', taskId: 'task-1', authorId: 'user-2', text: 'Second', createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    assert.equal(query.getCalls(), 1);
    assert.deepEqual(comments.map((comment) => [comment.id, comment.author.id]), [['comment-1', 'user-1'], ['comment-2', 'user-2']]);
    assert.equal(comments[0].passwordHash, undefined);
  } finally {
    query.restore();
  }
});


test('single DTOs use the same serialization as batch DTOs', async () => {
  const original = User.find;
  const users = [{ _id: 'user-1', name: 'First', email: 'first@example.test', role: 'Member' }];
  User.find = () => ({ select: () => ({ lean: async () => users }) });
  try {
    const project = { _id: 'p', memberIds: ['user-1'] };
    const comment = { _id: 'c', authorId: 'user-1', text: 'Hello' };
    assert.deepEqual(await projectDto(project), (await projectDtos([project]))[0]);
    assert.deepEqual(await commentDto(comment), (await commentDtos([comment]))[0]);
  } finally { User.find = original; }
});
