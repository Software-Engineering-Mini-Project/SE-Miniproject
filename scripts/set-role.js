// Operator tool: sets a registered user's role, e.g. to create the first Admin of a new deployment.
//   npm run user:role -- someone@example.com Admin
// After that, Admins manage roles in the app (Users page) or with PATCH /api/users/:userId/role.
import mongoose from 'mongoose';
import { loadEnvironment } from '../server/config/env.js';
import { User } from '../server/models/index.js';
import { normalizeEmail } from '../server/utils/validation.js';

const ROLES = ['Admin', 'Lead', 'Member'];
const [email, role] = process.argv.slice(2);

if (!email || !ROLES.includes(role)) {
  console.error('Usage: npm run user:role -- <email> <Admin|Lead|Member>');
  process.exit(2);
}

try {
  const { mongoUri } = loadEnvironment();
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, autoIndex: false });
  const user = await User.findOne({ emailNormalized: normalizeEmail(email) });
  if (!user) {
    console.error(JSON.stringify({ event: 'user_role_change_failed', reason: 'no registered user has that email' }));
    process.exitCode = 1;
  } else if (user.role !== 'Admin' || role === 'Admin' || await User.countDocuments({ role: 'Admin' }) > 1) {
    const from = user.role;
    user.role = role;
    await user.save();
    console.info(JSON.stringify({ event: 'user_role_changed', actor: 'operator-script', userId: user.id, from, to: role }));
  } else {
    console.error(JSON.stringify({ event: 'user_role_change_failed', reason: 'cannot demote the last admin' }));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'user_role_change_failed', errorType: error?.name, variable: error?.variable }));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
