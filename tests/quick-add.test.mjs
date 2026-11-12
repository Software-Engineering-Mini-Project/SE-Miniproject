// Quick add (src/lib/quick-add.js) and the Upcoming agenda (src/lib/upcoming.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchMember, parseQuickAdd } from '../src/lib/quick-add.js';
import { groupUpcoming } from '../src/lib/upcoming.js';

const TODAY = '2026-11-06'; // a Friday
const members = [
  { id: 'mina', name: 'Mina Member', email: 'member@example.test' },
  { id: 'lead', name: 'Synthetic Lead', email: 'lead@example.test' },
  { id: 'second', name: 'Second Synthetic Member', email: 'member2@example.test' },
];
const parse = (text, extra = {}) => parseQuickAdd(text, { today: TODAY, members, currentUserId: 'lead', ...extra });

test('title, priority, assignee and date come out of one line', () => {
  const result = parse('Fix the login redirect tomorrow !high @mina');
  assert.equal(result.title, 'Fix the login redirect');
  assert.equal(result.priority, 'High');
  assert.equal(result.dueDate, '2026-11-07');
  assert.deepEqual(result.assigneeIds, ['mina']);
  assert.deepEqual(result.parts.map((part) => part.kind).sort(), ['assignee', 'due', 'priority']);
});

test('date phrases', () => {
  const due = (text) => parse(`Task ${text}`).dueDate;
  assert.equal(due('today'), TODAY);
  assert.equal(due('tmr'), '2026-11-07');
  assert.equal(due('by friday'), '2026-11-13', 'a weekday is the next one, never today');
  assert.equal(due('on mon'), '2026-11-09');
  assert.equal(due('Thursday'), '2026-11-12');
  assert.equal(due('next week'), '2026-11-09', 'next week is next Monday');
  assert.equal(due('in 3 days'), '2026-11-09');
  assert.equal(due('in 2 weeks'), '2026-11-20');
  assert.equal(due('nov 20'), '2026-11-20');
  assert.equal(due('20th November'), '2026-11-20');
  assert.equal(due('5 jan'), '2027-01-05', 'a day and month already past this year means next year');
  assert.equal(due('due 2026-12-01'), '2026-12-01');
  assert.equal(due('2026-02-30'), null, 'impossible dates are left as text');
  assert.equal(parse('Task 2026-02-30').title, 'Task 2026-02-30');
  assert.equal(parse('Ship release by friday').title, 'Ship release', 'the lead word goes with the date');
});

test('priorities and their aliases; unknown ones stay in the title', () => {
  assert.equal(parse('A !h').priority, 'High');
  assert.equal(parse('A !2').priority, 'Medium');
  assert.equal(parse('A !low').priority, 'Low');
  const unknown = parse('Pay !urgent');
  assert.equal(unknown.priority, null);
  assert.equal(unknown.title, 'Pay !urgent');
  assert.equal(parse('A !high !low').priority, 'High', 'the first priority wins');
});

test('assignees: names, email local parts, unique prefixes and @me', () => {
  assert.equal(matchMember('mina', members)?.id, 'mina');
  assert.equal(matchMember('member2', members)?.id, 'second', 'email local part');
  assert.equal(matchMember('secondsyntheticmember', members)?.id, 'second', 'full name without spaces');
  assert.equal(matchMember('sec', members)?.id, 'second', 'unique prefix');
  assert.equal(matchMember('member', members)?.id, 'mina', 'an exact match wins over prefixes');
  assert.equal(matchMember('mem', members), null, 'ambiguous: two emails start with "mem"');
  assert.equal(matchMember('me', members, 'lead')?.id, 'lead');
  const result = parse('Pair on it @mina @me @nobody @mina');
  assert.deepEqual(result.assigneeIds, ['mina', 'lead'], 'each person once, in order');
  assert.deepEqual(result.unknownHandles, ['@nobody']);
  assert.equal(result.title, 'Pair on it @nobody', 'an unknown handle stays in the title');
  // Viewers are not passed as members, so they can't be assigned.
  assert.deepEqual(parse('Look @viewer').assigneeIds, []);
});

test('kept phrases stay as text, and the next date phrase is not used instead', () => {
  const plain = parse('Review the Monday report');
  assert.equal(plain.dueDate, '2026-11-09');
  assert.equal(plain.title, 'Review the report');
  const kept = parse('Review the Monday report', { keep: ['Monday'] });
  assert.equal(kept.dueDate, null);
  assert.equal(kept.title, 'Review the Monday report');
  assert.equal(parse('Plan @mina sync', { keep: ['@mina'] }).title, 'Plan @mina sync');
});

test('words that merely contain a keyword are not parsed', () => {
  const result = parse('Update the satisfaction survey and todays notes');
  assert.equal(result.dueDate, null);
  assert.equal(result.title, 'Update the satisfaction survey and todays notes');
  assert.equal(parse('email@mina.example').assigneeIds.length, 0);
  assert.equal(parse('').title, '');
  assert.equal(parse('tomorrow !high').title, '', 'only details, no title');
});

test('the Upcoming agenda groups open tasks by when they are due', () => {
  const task = (id, dueDate, extra = {}) => ({ id, title: id, status: 'To Do', priority: 'Medium', dueDate, ...extra });
  const groups = groupUpcoming([
    task('late-2', '2026-11-04'),
    task('late-1', '2026-10-30'),
    task('today-low', TODAY, { priority: 'Low' }),
    task('today-high', TODAY, { priority: 'High' }),
    task('tomorrow', '2026-11-07'),
    task('wednesday', '2026-11-11'),
    task('next-friday', '2026-11-13'),
    task('far', '2026-12-25'),
    task('undated', null),
    task('finished', TODAY, { status: 'Done' }),
  ], TODAY);
  assert.deepEqual(groups.map((group) => group.key), ['overdue', 'today', 'tomorrow', '2026-11-11', 'later', 'none']);
  assert.deepEqual(groups[0].tasks.map((t) => t.id), ['late-1', 'late-2'], 'overdue: oldest first');
  assert.deepEqual(groups[1].tasks.map((t) => t.id), ['today-high', 'today-low'], 'a day: most important first');
  assert.equal(groups[0].tone, 'overdue');
  assert.match(groups[3].label, /Wednesday/);
  assert.deepEqual(groups[4].tasks.map((t) => t.id), ['next-friday', 'far'], 'seven days or more ahead is later');
  assert.ok(!groups.flatMap((group) => group.tasks).some((t) => t.id === 'finished'));
  assert.deepEqual(groupUpcoming([task('done', TODAY, { status: 'Done' })], TODAY), []);
});

test('#type, #labels and story points (issue #74)', () => {
  const result = parse('Fix the login redirect #bug #Frontend #auth 3pts !high');
  assert.equal(result.title, 'Fix the login redirect');
  assert.equal(result.type, 'Bug');
  assert.deepEqual(result.labels, ['frontend', 'auth']);
  assert.equal(result.storyPoints, 3);
  assert.equal(result.priority, 'High');

  // The first type wins; later type words and points stay in the title, as does 4pts (not allowed).
  const twice = parse('Plan the launch #story #epic 4pts 8pt');
  assert.equal(twice.type, 'Story');
  assert.equal(twice.storyPoints, 8);
  assert.equal(twice.title, 'Plan the launch #epic 4pts');

  // A piece kept as text stays in the title; a word glued to text is not a tag.
  const kept = parse('Ship #epic notes', { keep: ['#epic'] });
  assert.equal(kept.type, null);
  assert.equal(kept.title, 'Ship #epic notes');
  assert.deepEqual(parse('Fix issue#12 and C#').labels, []);
  assert.equal(parse('Release 3pts').storyPoints, 3);
  assert.equal(parse('Nothing special').type, null, 'no #type means the API default (Task)');
});
