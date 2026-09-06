import { vi } from 'vitest';

/**
 * Mongoose-style query: supports `await Model.findOne(...)` and `.select(...)` chains.
 */
export function findOneQuery(value) {
  const promise = Promise.resolve(value);
  promise.select = vi.fn().mockResolvedValue(value);
  return promise;
}

function createModelMock() {
  return {
    findOne: vi.fn(() => findOneQuery(null)),
    findById: vi.fn(),
    find: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    countDocuments: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    bulkWrite: vi.fn(),
    deleteMany: vi.fn(),
  };
}

export const User = createModelMock();
export const Event = createModelMock();
export const Attendance = createModelMock();
export const Faq = createModelMock();

vi.mock('../../src/models/User.js', () => ({ User }));
vi.mock('../../src/models/Event.js', () => ({ Event }));
vi.mock('../../src/models/Attendance.js', () => ({ Attendance }));
vi.mock('../../src/models/Faq.js', () => ({ Faq }));

export function setFindOneResult(model, value) {
  model.findOne.mockImplementation(() => findOneQuery(value));
}

export function setFindOneImplementation(model, fn) {
  model.findOne.mockImplementation((query) => findOneQuery(fn(query)));
}

export function resetModelMocks() {
  for (const model of [User, Event, Attendance, Faq]) {
    for (const key of Object.keys(model)) {
      if (typeof model[key]?.mockReset === 'function') {
        model[key].mockReset();
      }
    }
    if (model.findOne) {
      model.findOne.mockImplementation(() => findOneQuery(null));
    }
  }
}
