export function toApi(value) {
  if (typeof value.toJSON === 'function') value = value.toJSON();
  const result = { ...value, id: String(value._id ?? value.id) };
  delete result._id;
  delete result.__v;
  delete result.passwordHash;
  if (Object.hasOwn(result, 'dueDate')) {
    result.dueDate = result.dueDate instanceof Date
      ? result.dueDate.toISOString().slice(0, 10)
      : result.dueDate ?? null;
  }
  return result;
}
