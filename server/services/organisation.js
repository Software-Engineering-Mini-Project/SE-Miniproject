import { generateJoinCode, normalizeJoinCode } from '../../src/lib/organisation.js';
import { Organisation } from '../models/index.js';

/** The caller's organisation as the session shows it. */
export async function getOrganisationSummary(organisationId) {
  if (!organisationId) return null;
  const organisation = await Organisation.findById(organisationId).select('name').lean();
  return organisation ? { id: String(organisation._id), name: organisation.name } : null;
}

export async function findOrganisationByJoinCode(rawCode) {
  const code = normalizeJoinCode(rawCode);
  return code ? Organisation.findOne({ joinCode: code }).select('_id name').lean() : null;
}

/** A join code no other organisation uses. Collisions are astronomically rare; the unique index is the real guarantee. */
export async function uniqueJoinCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    if (!await Organisation.exists({ joinCode: code })) return code;
  }
  throw new Error('Could not generate a unique invite code.');
}
