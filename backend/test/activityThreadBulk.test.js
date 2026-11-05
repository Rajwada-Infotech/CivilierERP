process.env.NODE_ENV = "test";

jest.mock("../db", () => ({ getPool: jest.fn(), sql: require("mssql") }));

const mockIo = { emit: jest.fn(), socketsLeave: jest.fn(), inCalls: [], rooms: new Map(), available: true };
jest.mock("../socket", () => ({
  getIo: () => {
    if (!mockIo.available) throw new Error("socket server not running");
    return {
      sockets: { adapter: { rooms: mockIo.rooms } },
      in: (room) => {
        mockIo.inCalls.push(room);
        return { emit: mockIo.emit, socketsLeave: mockIo.socketsLeave };
      },
    };
  },
}));

const { invalidateAllThreads, roomOf } = require("../services/activityThread");

beforeEach(() => {
  mockIo.emit.mockClear();
  mockIo.socketsLeave.mockClear();
  mockIo.inCalls = [];
  mockIo.rooms = new Map();
  mockIo.available = true;
});

describe("invalidateAllThreads (used by Bulk Assign)", () => {
  it("tells only the activity-thread rooms that exist to re-join", () => {
    mockIo.rooms = new Map([
      [roomOf(2), new Set(["a"])],
      [roomOf(4), new Set(["b"])],
      ["user:7", new Set(["c"])], // personal rooms and socket ids are left alone
      ["some-socket-id", new Set(["some-socket-id"])],
    ]);
    invalidateAllThreads();
    expect([...new Set(mockIo.inCalls)]).toEqual([roomOf(2), roomOf(4)]);
    expect(mockIo.emit).toHaveBeenCalledWith("activity-thread:rejoin", { rungId: 2 });
    expect(mockIo.emit).toHaveBeenCalledWith("activity-thread:rejoin", { rungId: 4 });
    expect(mockIo.socketsLeave).toHaveBeenCalledTimes(2);
  });

  it("does no socket work at all when nobody is in any thread", () => {
    invalidateAllThreads();
    expect(mockIo.inCalls).toHaveLength(0);
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  it("does not throw when the socket server is not running", () => {
    mockIo.available = false;
    expect(() => invalidateAllThreads()).not.toThrow();
  });

  it("is fast with a lot of rooms open", () => {
    for (let i = 1; i <= 20000; i++) mockIo.rooms.set(roomOf(i), new Set(["s"]));
    const start = Date.now();
    invalidateAllThreads();
    expect(Date.now() - start).toBeLessThan(2000);
    expect(mockIo.emit).toHaveBeenCalledTimes(20000);
  });
});
