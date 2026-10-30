const COLUMN_WIDTHS = [8.6, 10.2, 9.2];
const ROW_DEPTHS = [8.2, 7.4];
const WALL_THICKNESS = 0.5;
const PAINTINGS_PER_COLUMN = 5;
const PATH_WIDTH = 1.5;
const LANDING_SIZE = 2.6;
/** How far from the edge of the boards the visitor stays. */
const EDGE_MARGIN = 0.2;

export const DOOR_WIDTH = 2.6;
export const DOOR_HEIGHT = 3.1;

export interface Point {
  x: number;
  z: number;
}

export interface Rect {
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

/** A place at the edge of the boards, for looking into the water. */
export interface WaterEdge extends Point {
  /** Unit vector from the boards out over the water. */
  dx: number;
  dz: number;
}

export interface DeckPiece extends Rect {
  /** The axis the boards are laid across, which is the way you walk on them. */
  walkAlong: 'x' | 'z';
}

function inside(rect: Rect, x: number, z: number) {
  return x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
}

function centerOf(rect: Rect): Point {
  return { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
}

/**
 * Rectangular rooms in two rows, joined by doors into one closed round. A boardwalk runs through
 * the middle of every room and door, and that is where the visitor can be. Distances are in metres.
 */
export class FloorPlan {
  readonly rooms: Rect[] = [];
  readonly doors: Door[] = [];
  readonly walls: Wall[] = [];
  readonly deck: DeckPiece[] = [];
  readonly bounds: Rect;
  private readonly columns: number;
  /** What a line of sight can pass through. */
  private readonly openDoors: Rect[];
  /** Where the visitor can stand, room by room. */
  private readonly walkable: Rect[][];

  constructor(paintingCount: number) {
    this.columns = Math.max(2, Math.round(paintingCount / PAINTINGS_PER_COLUMN));
    this.layOutRooms();
    this.connectRooms();
    this.openDoors = this.doors.map((door) => this.doorRect(door));
    this.buildWalls();
    this.walkable = this.rooms.map((_, room) => this.layPath(room));
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
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      const a = this.rooms[i];
      const b = this.rooms[next];
      const here = centerOf(a);
      if (Math.abs(here.x - centerOf(b).x) < 0.01) {
        this.doors.push({
          rooms: [i, next],
          crossing: 'z',
          plane: (Math.min(a.z1, b.z1) + Math.max(a.z0, b.z0)) / 2,
          center: here.x,
        });
      } else {
        this.doors.push({
          rooms: [i, next],
          crossing: 'x',
          plane: (Math.min(a.x1, b.x1) + Math.max(a.x0, b.x0)) / 2,
          center: here.z,
        });
      }
    }
  }

  private doorRect(door: Door): Rect {
    const halfDepth = WALL_THICKNESS / 2;
    const halfWidth = DOOR_WIDTH / 2;
    return door.crossing === 'x'
      ? { x0: door.plane - halfDepth, x1: door.plane + halfDepth, z0: door.center - halfWidth, z1: door.center + halfWidth }
      : { x0: door.center - halfWidth, x1: door.center + halfWidth, z0: door.plane - halfDepth, z1: door.plane + halfDepth };
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

  /** Lays the boards of one room, and returns where the visitor can stand on them. */
  private layPath(room: number) {
    const center = centerOf(this.rooms[room]);
    const landing = LANDING_SIZE / 2;
    this.deck.push({
      x0: center.x - landing,
      x1: center.x + landing,
      z0: center.z - landing,
      z1: center.z + landing,
      walkAlong: 'x',
    });
    const standing: Rect[] = [
      {
        x0: center.x - landing + EDGE_MARGIN,
        x1: center.x + landing - EDGE_MARGIN,
        z0: center.z - landing + EDGE_MARGIN,
        z1: center.z + landing - EDGE_MARGIN,
      },
    ];

    const half = PATH_WIDTH / 2;
    for (const door of this.doors.filter((candidate) => candidate.rooms.includes(room))) {
      if (door.crossing === 'x') {
        const toDoor = door.plane > center.x ? 1 : -1;
        const from = center.x + toDoor * landing;
        this.deck.push({
          x0: Math.min(from, door.plane),
          x1: Math.max(from, door.plane),
          z0: door.center - half,
          z1: door.center + half,
          walkAlong: 'x',
        });
        standing.push({
          x0: Math.min(center.x, door.plane),
          x1: Math.max(center.x, door.plane),
          z0: door.center - half + EDGE_MARGIN,
          z1: door.center + half - EDGE_MARGIN,
        });
      } else {
        const toDoor = door.plane > center.z ? 1 : -1;
        const from = center.z + toDoor * landing;
        this.deck.push({
          x0: door.center - half,
          x1: door.center + half,
          z0: Math.min(from, door.plane),
          z1: Math.max(from, door.plane),
          walkAlong: 'z',
        });
        standing.push({
          x0: door.center - half + EDGE_MARGIN,
          x1: door.center + half - EDGE_MARGIN,
          z0: Math.min(center.z, door.plane),
          z1: Math.max(center.z, door.plane),
        });
      }
    }
    return standing;
  }

  /** Places for paintings in a room, on its walls without doors. A crowded room hangs two on its longest wall. */
  hangingSpots(room: number, count: number): HangingSpot[] {
    const whole = this.walls.filter((wall) => wall.room === room && !wall.door).sort((a, b) => b.length - a.length);
    const spots: HangingSpot[] = [];
    whole.forEach((wall, index) => {
      if (index === 0 && count > whole.length) {
        spots.push({ wall, along: wall.length * 0.25 }, { wall, along: wall.length * 0.75 });
      } else {
        spots.push({ wall, along: wall.length / 2 });
      }
    });
    return spots;
  }

  /** The sides of a room's landing that have water beyond them rather than a path. */
  waterEdges(room: number): WaterEdge[] {
    const center = centerOf(this.rooms[room]);
    const landing = LANDING_SIZE / 2;
    const doors = this.doors.filter((door) => door.rooms.includes(room));
    const hasPath = (dx: number, dz: number) =>
      doors.some((door) =>
        door.crossing === 'x'
          ? dx !== 0 && Math.sign(door.plane - center.x) === dx
          : dz !== 0 && Math.sign(door.plane - center.z) === dz,
      );
    return [
      { dx: 1, dz: 0 },
      { dx: -1, dz: 0 },
      { dx: 0, dz: 1 },
      { dx: 0, dz: -1 },
    ]
      .filter(({ dx, dz }) => !hasPath(dx, dz))
      .map(({ dx, dz }) => ({ x: center.x + dx * landing, z: center.z + dz * landing, dx, dz }));
  }

  /** Whether a position is open water in the given room, clear of the walls and boards. */
  isOpenWater(room: number, x: number, z: number) {
    const { x0, x1, z0, z1 } = this.rooms[room];
    const margin = 0.5;
    const inRoom = x > x0 + margin && x < x1 - margin && z > z0 + margin && z < z1 - margin;
    if (!inRoom) return false;
    const clearance = 0.3;
    return !this.deck.some(
      (piece) =>
        x > piece.x0 - clearance && x < piece.x1 + clearance && z > piece.z0 - clearance && z < piece.z1 + clearance,
    );
  }

  /** Whether a position is within a room or door, for testing lines of sight. */
  contains(x: number, z: number) {
    return this.rooms.some((room) => inside(room, x, z)) || this.openDoors.some((door) => inside(door, x, z));
  }

  /** Whether the visitor can stand at a position. */
  isClear(x: number, z: number) {
    return this.walkable.some((rects) => rects.some((rect) => inside(rect, x, z)));
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

  /** The nearest place to stand, on the path in the room the position belongs to. */
  nearestClear(x: number, z: number): Point {
    if (this.isClear(x, z)) return { x, z };
    let best: Point = { x, z };
    let bestDistance = Infinity;
    for (const rect of this.walkable[this.roomAt(x, z)]) {
      const nearX = Math.max(rect.x0, Math.min(rect.x1, x));
      const nearZ = Math.max(rect.z0, Math.min(rect.z1, z));
      const distance = (nearX - x) ** 2 + (nearZ - z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: nearX, z: nearZ };
      }
    }
    return best;
  }

  areNeighbours(a: number, b: number) {
    return a === b || this.doors.some((door) => door.rooms.includes(a) && door.rooms.includes(b));
  }

  private isOnDoorLine(door: Door, point: Point) {
    const offLine = door.crossing === 'x' ? point.z - door.center : point.x - door.center;
    return Math.abs(offLine) < PATH_WIDTH / 2;
  }

  /** Waypoints along the path between two positions, going the shorter way round. */
  route(from: Point, to: Point): Point[] {
    const count = this.rooms.length;
    const start = this.roomAt(from.x, from.z);
    const end = this.roomAt(to.x, to.z);

    if (start === end) {
      const sameLine = Math.abs(from.x - to.x) < PATH_WIDTH / 2 || Math.abs(from.z - to.z) < PATH_WIDTH / 2;
      return sameLine ? [from, to] : [from, centerOf(this.rooms[start]), to];
    }

    const forward = (end - start + count) % count;
    const direction = forward <= count - forward ? 1 : -1;
    const steps = direction === 1 ? forward : count - forward;
    const points: Point[] = [from];
    let room = start;
    for (let step = 0; step < steps; step++) {
      const next = (room + direction + count) % count;
      const door = this.doors[direction === 1 ? room : next];
      if (step > 0 || !this.isOnDoorLine(door, from)) points.push(centerOf(this.rooms[room]));
      points.push(door.crossing === 'x' ? { x: door.plane, z: door.center } : { x: door.center, z: door.plane });
      if (step === steps - 1 && !this.isOnDoorLine(door, to)) points.push(centerOf(this.rooms[next]));
      room = next;
    }
    points.push(to);
    return points;
  }

  /** Eases someone crossing a landing onto the line of the path they are heading for. */
  pathPull(x: number, z: number, headingX: number, headingZ: number): Point {
    const room = this.roomAt(x, z);
    for (const door of this.doors) {
      if (!door.rooms.includes(room)) continue;
      const heading = door.crossing === 'x' ? headingX : headingZ;
      const towards = door.plane - (door.crossing === 'x' ? x : z);
      if (Math.abs(heading) < 0.5 || heading * towards < 0) continue;
      const offLine = door.crossing === 'x' ? z - door.center : x - door.center;
      if (Math.abs(offLine) < 0.05) continue;
      const pull = -Math.sign(offLine);
      return door.crossing === 'x' ? { x: 0, z: pull } : { x: pull, z: 0 };
    }
    return { x: 0, z: 0 };
  }
}
