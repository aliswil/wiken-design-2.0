const COLUMN_WIDTHS = [8.6, 10.2, 9.2];
const ROW_DEPTHS = [8.2, 7.4];
const WALL_THICKNESS = 0.5;
const PAINTINGS_PER_COLUMN = 5;
const MIN_FREE_WALL = 3.8;
/** Share of a room's depth between its outer wall and the doors along the row, so the doors line up. */
const DOOR_LINE = 0.32;

export const DOOR_WIDTH = 2.6;
export const DOOR_HEIGHT = 3.1;
export const WALL_MARGIN = 0.9;
const DOOR_MARGIN = 0.45;

export interface Point {
  x: number;
  z: number;
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Door {
  rooms: [number, number];
  /** The axis you travel along when going through. */
  crossing: 'x' | 'z';
  /** Middle of the wall gap, on the crossing axis. */
  plane: number;
  /** Middle of the opening, on the other axis. */
  center: number;
}

export interface Wall {
  room: number;
  /** One end of the wall, as seen from inside the room. */
  x: number;
  z: number;
  /** Unit vector along the wall. */
  dx: number;
  dz: number;
  length: number;
  /** Unit vector pointing out of the wall into the room. */
  nx: number;
  nz: number;
  /** The opening in this wall, as distances along it. */
  door: [number, number] | null;
}

export interface HangingSpot {
  wall: Wall;
  /** Distance along the wall to the middle of the picture. */
  along: number;
}

function inside(rect: Rect, x: number, z: number) {
  return x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
}

function grown(rect: Rect, by: number): Rect {
  return { x0: rect.x0 - by, x1: rect.x1 + by, z0: rect.z0 - by, z1: rect.z1 + by };
}

/** Rectangular rooms in two rows, joined by doors into one closed round. All distances are in metres. */
export class FloorPlan {
  readonly rooms: Rect[] = [];
  readonly doors: Door[] = [];
  readonly walls: Wall[] = [];
  readonly bounds: Rect;
  private readonly columns: number;
  /** What a line of sight can pass through. */
  private readonly openDoors: Rect[];
  /** Where the boat may be. */
  private readonly clearRooms: Rect[];
  private readonly clearDoors: Rect[];

  constructor(paintingCount: number) {
    this.columns = Math.max(2, Math.round(paintingCount / PAINTINGS_PER_COLUMN));
    this.layOutRooms();
    this.connectRooms();
    this.openDoors = this.doors.map((door) => this.doorRect(door, WALL_THICKNESS / 2, DOOR_WIDTH / 2));
    this.clearRooms = this.rooms.map((room) => grown(room, -WALL_MARGIN));
    this.clearDoors = this.doors.map((door) =>
      this.doorRect(door, WALL_THICKNESS / 2 + WALL_MARGIN, DOOR_WIDTH / 2 - DOOR_MARGIN),
    );
    this.buildWalls();
    this.bounds = {
      x0: Math.min(...this.rooms.map((room) => room.x0)),
      x1: Math.max(...this.rooms.map((room) => room.x1)),
      z0: Math.min(...this.rooms.map((room) => room.z0)),
      z1: Math.max(...this.rooms.map((room) => room.z1)),
    };
  }

  private layOutRooms() {
    const widths = Array.from({ length: this.columns }, (_, i) => COLUMN_WIDTHS[i % COLUMN_WIDTHS.length]);
    const lefts: number[] = [];
    let cursor = 0;
    widths.forEach((width) => {
      lefts.push(cursor);
      cursor += width + WALL_THICKNESS;
    });
    const row = (z0: number, depth: number): Rect[] =>
      widths.map((width, i) => ({ x0: lefts[i], x1: lefts[i] + width, z0, z1: z0 + depth }));
    const top = row(0, ROW_DEPTHS[0]);
    const bottom = row(ROW_DEPTHS[0] + WALL_THICKNESS, ROW_DEPTHS[1]);
    // Numbered as a walk: along the top row, then back along the bottom one.
    this.rooms.push(...top, ...bottom.reverse());
  }

  private connectRooms() {
    const count = this.rooms.length;
    const lastTop = this.columns - 1;
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      const a = this.rooms[i];
      const b = this.rooms[next];
      if (i === lastTop || next === 0) {
        const left = Math.max(a.x0, b.x0);
        const right = Math.min(a.x1, b.x1);
        this.doors.push({
          rooms: [i, next],
          crossing: 'z',
          plane: (Math.min(a.z1, b.z1) + Math.max(a.z0, b.z0)) / 2,
          center: (left + right) / 2,
        });
      } else {
        const onTopRow = i < this.columns;
        const depth = a.z1 - a.z0;
        this.doors.push({
          rooms: [i, next],
          crossing: 'x',
          plane: (Math.min(a.x1, b.x1) + Math.max(a.x0, b.x0)) / 2,
          center: onTopRow ? a.z0 + depth * DOOR_LINE : a.z1 - depth * DOOR_LINE,
        });
      }
    }
  }

  private doorRect(door: Door, halfDepth: number, halfWidth: number): Rect {
    return door.crossing === 'x'
      ? {
          x0: door.plane - halfDepth,
          x1: door.plane + halfDepth,
          z0: door.center - halfWidth,
          z1: door.center + halfWidth,
        }
      : {
          x0: door.center - halfWidth,
          x1: door.center + halfWidth,
          z0: door.plane - halfDepth,
          z1: door.plane + halfDepth,
        };
  }

  private doorInWall(room: number, crossing: Door['crossing'], plane: number) {
    return this.doors.find(
      (door) =>
        door.rooms.includes(room) && door.crossing === crossing && Math.abs(door.plane - plane) <= WALL_THICKNESS,
    );
  }

  private buildWalls() {
    this.rooms.forEach((room, index) => {
      const width = room.x1 - room.x0;
      const depth = room.z1 - room.z0;
      const opening = (door: Door | undefined, start: number, direction: 1 | -1): [number, number] | null => {
        if (!door) return null;
        const middle = (door.center - start) * direction;
        return [middle - DOOR_WIDTH / 2, middle + DOOR_WIDTH / 2];
      };
      this.walls.push(
        {
          room: index, x: room.x0, z: room.z0, dx: 1, dz: 0, length: width, nx: 0, nz: 1,
          door: opening(this.doorInWall(index, 'z', room.z0), room.x0, 1),
        },
        {
          room: index, x: room.x1, z: room.z0, dx: 0, dz: 1, length: depth, nx: -1, nz: 0,
          door: opening(this.doorInWall(index, 'x', room.x1), room.z0, 1),
        },
        {
          room: index, x: room.x1, z: room.z1, dx: -1, dz: 0, length: width, nx: 0, nz: -1,
          door: opening(this.doorInWall(index, 'z', room.z1), room.x1, -1),
        },
        {
          room: index, x: room.x0, z: room.z1, dx: 0, dz: -1, length: depth, nx: 1, nz: 0,
          door: opening(this.doorInWall(index, 'x', room.x0), room.z1, -1),
        },
      );
    });
  }

  /** Places for paintings in a room: whole walls first, then what is left beside a door. */
  hangingSpots(room: number): HangingSpot[] {
    const walls = this.walls.filter((wall) => wall.room === room);
    const whole = walls.filter((wall) => !wall.door).sort((a, b) => b.length - a.length);
    const spots: HangingSpot[] = whole.map((wall) => ({ wall, along: wall.length / 2 }));
    for (const wall of walls) {
      if (!wall.door) continue;
      const [from, to] = wall.door;
      if (from >= MIN_FREE_WALL) spots.push({ wall, along: from / 2 });
      else if (wall.length - to >= MIN_FREE_WALL) spots.push({ wall, along: (to + wall.length) / 2 });
    }
    return spots;
  }

  /** Whether a position is on the water, for testing lines of sight. */
  contains(x: number, z: number) {
    return this.rooms.some((room) => inside(room, x, z)) || this.openDoors.some((door) => inside(door, x, z));
  }

  /** Whether the boat fits at a position. */
  isClear(x: number, z: number) {
    return this.clearRooms.some((room) => inside(room, x, z)) || this.clearDoors.some((door) => inside(door, x, z));
  }

  roomAt(x: number, z: number) {
    let best = 0;
    let bestDistance = Infinity;
    this.rooms.forEach((room, index) => {
      const dx = Math.max(room.x0 - x, 0, x - room.x1);
      const dz = Math.max(room.z0 - z, 0, z - room.z1);
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  /** The nearest place the boat fits, within the room or door the position belongs to. */
  nearestClear(x: number, z: number): Point {
    if (this.isClear(x, z)) return { x, z };
    const room = this.clearRooms[this.roomAt(x, z)];
    return { x: Math.max(room.x0, Math.min(room.x1, x)), z: Math.max(room.z0, Math.min(room.z1, z)) };
  }

  areNeighbours(a: number, b: number) {
    return a === b || this.doors.some((door) => door.rooms.includes(a) && door.rooms.includes(b));
  }

  /** Waypoints between two positions, going through the doors of the shorter way round. */
  route(from: Point, to: Point): Point[] {
    const count = this.rooms.length;
    const start = this.roomAt(from.x, from.z);
    const end = this.roomAt(to.x, to.z);
    const forward = (end - start + count) % count;
    const direction = forward <= count - forward ? 1 : -1;
    const steps = direction === 1 ? forward : count - forward;
    const points: Point[] = [from];
    const reach = WALL_THICKNESS / 2 + WALL_MARGIN;

    for (let step = 0, room = start; step < steps; step++) {
      const next = (room + direction + count) % count;
      const door = this.doors[direction === 1 ? room : next];
      const here = this.rooms[room];
      const sign = door.crossing === 'x' ? (here.x1 <= door.plane ? 1 : -1) : here.z1 <= door.plane ? 1 : -1;
      points.push(
        door.crossing === 'x'
          ? { x: door.plane - sign * reach, z: door.center }
          : { x: door.center, z: door.plane - sign * reach },
        door.crossing === 'x'
          ? { x: door.plane + sign * reach, z: door.center }
          : { x: door.center, z: door.plane + sign * reach },
      );
      room = next;
    }
    points.push(to);
    return points;
  }

  /** Steers towards a door the boat is pushing against, so openings are easy to hit. */
  doorPull(x: number, z: number, headingX: number, headingZ: number): Point {
    for (const door of this.doors) {
      const across = door.crossing === 'x' ? x - door.plane : z - door.plane;
      const along = door.crossing === 'x' ? z - door.center : x - door.center;
      const heading = door.crossing === 'x' ? headingX : headingZ;
      const towardsWall = Math.abs(across) < 2.4 && heading * across < 0 && Math.abs(heading) > 0.5;
      if (!towardsWall || Math.abs(along) > 2.6 || Math.abs(along) < 0.3) continue;
      const pull = -Math.sign(along);
      return door.crossing === 'x' ? { x: 0, z: pull } : { x: pull, z: 0 };
    }
    return { x: 0, z: 0 };
  }
}
