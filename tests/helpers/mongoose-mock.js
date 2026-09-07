import { vi } from 'vitest';

const mockConnection = {
  readyState: 1,
  name: 'choir-test',
  db: {
    admin: vi.fn(() => ({
      ping: vi.fn().mockResolvedValue(undefined),
    })),
  },
};

let objectIdCounter = 0;

export const mongooseMock = {
  connection: mockConnection,
  set: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  isValidObjectId: vi.fn((id) => /^[a-f0-9]{24}$/i.test(String(id))),
  Types: {
    ObjectId: class ObjectId {
      constructor(id) {
        this.id =
          id ||
          `${(++objectIdCounter).toString(16).padStart(6, '0')}${'0'.repeat(18)}`.slice(0, 24);
      }
      toString() {
        return String(this.id);
      }
    },
  },
};

vi.mock('mongoose', () => ({
  default: mongooseMock,
}));

export function setDbPingFails() {
  mockConnection.readyState = 1;
  mockConnection.db.admin.mockReturnValue({
    ping: vi.fn().mockRejectedValue(new Error('db down')),
  });
}

export function setDbConnected(connected = true) {
  mockConnection.readyState = connected ? 1 : 0;
  mockConnection.db.admin.mockReturnValue({
    ping: connected
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('db down')),
  });
}

export function resetMongooseMock() {
  objectIdCounter = 0;
  mockConnection.readyState = 1;
  mongooseMock.connect.mockClear();
  mongooseMock.disconnect.mockClear();
  mongooseMock.set.mockClear();
  setDbConnected(true);
}
