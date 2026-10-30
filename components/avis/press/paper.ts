/** A seamless tile of paper grain: soft mottling with short fibres, averaging 128. */
export function grainTile(size: number): Uint8Array {
  let seed = 90127;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const field = new Float32Array(size * size);

  for (const [cells, weight] of [[24, 0.5], [64, 0.7]]) {
    const lattice = Float32Array.from({ length: cells * cells }, random);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const at = (cx: number, cy: number) => lattice[(cy % cells) * cells + (cx % cells)];
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        field[y * size + x] += (top * (1 - sy) + bottom * sy - 0.5) * weight;
      }
    }
  }

  for (let f = 0; f < size * 3; f++) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    const ink = random() < 0.35 ? -0.22 : 0.16;
    for (let step = 0; step < 14; step++) {
      field[(Math.floor(y) & (size - 1)) * size + (Math.floor(x) & (size - 1))] += ink;
      angle += (random() - 0.5) * 0.5;
      x += Math.cos(angle) + size;
      y += Math.sin(angle) + size;
      x %= size;
      y %= size;
    }
  }

  const mean = field.reduce((sum, v) => sum + v, 0) / field.length;
  return Uint8Array.from(field, (v) => Math.min(Math.max(128 + (v - mean) * 110, 0), 255));
}
