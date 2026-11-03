import mongoose from 'mongoose';

function transformToApi(_document, value) {
  value.id = String(value._id);
  delete value._id;
  delete value.__v;
  delete value.passwordHash;
  if (Object.hasOwn(value, 'dueDate')) {
    value.dueDate = value.dueDate instanceof Date
      ? value.dueDate.toISOString().slice(0, 10)
      : value.dueDate ?? null;
  }
  return value;
}

export function createSchema(definition, options = {}) {
  return new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    ...definition,
  }, {
    timestamps: true,
    versionKey: false,
    id: true,
    toJSON: { transform: transformToApi },
    ...options,
  });
}
