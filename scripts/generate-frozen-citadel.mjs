import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const assetsRoot = path.join(root, "assets");
const scenesRoot = path.join(root, "editor", "scenes");

const TILE = {
  ice: 0,
  darkIce: 1,
  crackedFloor: 2,
  icicles: 3,
  gothic: 4,
  blackRock: 5,
  crystal: 6,
  crackedStone: 7,
  gate: 8,
  mountain: 9,
  paleIce: 10,
  iceWall: 11,
  carvedStone: 12,
  chain: 13,
  arch: 14,
  runes: 15,
};

const COLOR = {
  floor: [0.34, 0.48, 0.60],
  floorDark: [0.16, 0.25, 0.34],
  stone: [0.34, 0.40, 0.45],
  stoneDark: [0.13, 0.17, 0.22],
  stoneLight: [0.48, 0.57, 0.64],
  ice: [0.43, 0.70, 0.87],
  iceDark: [0.12, 0.28, 0.43],
  crystal: [0.35, 0.88, 1.0],
  chain: [0.13, 0.12, 0.12],
  fireStone: [0.42, 0.30, 0.22],
  abyss: [0.025, 0.045, 0.075],
};

function p(x, y, z) {
  return { x, y, z };
}

function shade(color, amount) {
  return color.map((component) => Math.max(0, Math.min(1, component * amount)));
}

class Mesh {
  constructor(name) {
    this.name = name;
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.tiles = [];
  }

  vertex(point, normal, color, tile) {
    this.positions.push(point.x, point.y, point.z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(color[0], color[1], color[2]);
    this.tiles.push(tile);
  }

  triangle(a, b, c, color, tile) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const normal = p(nx, ny, nz);
    this.vertex(a, normal, color, tile);
    this.vertex(b, normal, color, tile);
    this.vertex(c, normal, color, tile);
  }

  quad(a, b, c, d, color, tile) {
    this.triangle(a, b, c, color, tile);
    this.triangle(a, c, d, color, tile);
  }

  get vertexCount() {
    return this.positions.length / 3;
  }
}

function addBox(mesh, x, y, z, width, height, depth, color = COLOR.stone, tile = TILE.crackedStone) {
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const y0 = y;
  const y1 = y + height;
  const z0 = z - depth / 2;
  const z1 = z + depth / 2;
  mesh.quad(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), shade(color, 1.14), tile);
  mesh.quad(p(x0, y0, z1), p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), shade(color, 0.44), tile);
  mesh.quad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), shade(color, 0.72), tile);
  mesh.quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), shade(color, 0.91), tile);
  mesh.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), color, tile);
  mesh.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), shade(color, 0.62), tile);
}

function rotateY(x, z, yaw) {
  return { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
}

function addRotatedBox(mesh, x, y, z, width, height, depth, yaw, color, tile) {
  const local = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ];
  const bottom = local.map(([lx, lz]) => {
    const q = rotateY(lx, lz, yaw);
    return p(x + q.x, y, z + q.z);
  });
  const top = bottom.map((point) => p(point.x, y + height, point.z));
  mesh.quad(top[0], top[1], top[2], top[3], shade(color, 1.14), tile);
  mesh.quad(bottom[3], bottom[2], bottom[1], bottom[0], shade(color, 0.45), tile);
  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    mesh.quad(bottom[side], bottom[next], top[next], top[side], shade(color, 0.63 + side * 0.10), tile);
  }
}

function addCylinder(mesh, x, y, z, radius, height, sides, color, tile) {
  const bottom = p(x, y, z);
  const top = p(x, y + height, z);
  for (let side = 0; side < sides; side++) {
    const a0 = Math.PI * 2 * side / sides;
    const a1 = Math.PI * 2 * (side + 1) / sides;
    const p0 = p(x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius);
    const p1 = p(x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius);
    const p2 = p(p1.x, y + height, p1.z);
    const p3 = p(p0.x, y + height, p0.z);
    mesh.quad(p0, p1, p2, p3, shade(color, 0.65 + 0.28 * (0.5 + Math.sin(a0) * 0.5)), tile);
    mesh.triangle(top, p3, p2, shade(color, 1.15), tile);
    mesh.triangle(bottom, p1, p0, shade(color, 0.45), tile);
  }
}

function addFrustum(mesh, x, y, z, lowerRadius, upperRadius, height, sides, color, tile) {
  for (let side = 0; side < sides; side++) {
    const a0 = Math.PI * 2 * side / sides;
    const a1 = Math.PI * 2 * (side + 1) / sides;
    const p0 = p(x + Math.cos(a0) * lowerRadius, y, z + Math.sin(a0) * lowerRadius);
    const p1 = p(x + Math.cos(a1) * lowerRadius, y, z + Math.sin(a1) * lowerRadius);
    const p2 = p(x + Math.cos(a1) * upperRadius, y + height, z + Math.sin(a1) * upperRadius);
    const p3 = p(x + Math.cos(a0) * upperRadius, y + height, z + Math.sin(a0) * upperRadius);
    mesh.quad(p0, p1, p2, p3, shade(color, 0.70 + side / sides * 0.30), tile);
  }
}

function addSpire(mesh, x, y, z, radius, height, sides, color, tile, leanX = 0, leanZ = 0) {
  const apex = p(x + leanX, y + height, z + leanZ);
  const center = p(x, y, z);
  for (let side = 0; side < sides; side++) {
    const a0 = Math.PI * 2 * side / sides;
    const a1 = Math.PI * 2 * (side + 1) / sides;
    const p0 = p(x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius);
    const p1 = p(x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius);
    mesh.triangle(p0, p1, apex, shade(color, 0.66 + side / sides * 0.42), tile);
    mesh.triangle(center, p1, p0, shade(color, 0.45), tile);
  }
}

function addArch(mesh, x, y, z, innerRadius, outerRadius, depth, segments, color, tile) {
  const front = z + depth / 2;
  const back = z - depth / 2;
  for (let segment = 0; segment < segments; segment++) {
    const a0 = Math.PI * segment / segments;
    const a1 = Math.PI * (segment + 1) / segments;
    const i0 = { x: x + Math.cos(a0) * innerRadius, y: y + Math.sin(a0) * innerRadius };
    const i1 = { x: x + Math.cos(a1) * innerRadius, y: y + Math.sin(a1) * innerRadius };
    const o0 = { x: x + Math.cos(a0) * outerRadius, y: y + Math.sin(a0) * outerRadius };
    const o1 = { x: x + Math.cos(a1) * outerRadius, y: y + Math.sin(a1) * outerRadius };
    mesh.quad(p(i0.x, i0.y, front), p(i1.x, i1.y, front), p(o1.x, o1.y, front), p(o0.x, o0.y, front), color, tile);
    mesh.quad(p(o0.x, o0.y, back), p(o1.x, o1.y, back), p(i1.x, i1.y, back), p(i0.x, i0.y, back), shade(color, 0.62), tile);
    mesh.quad(p(o0.x, o0.y, front), p(o1.x, o1.y, front), p(o1.x, o1.y, back), p(o0.x, o0.y, back), shade(color, 0.82), tile);
    mesh.quad(p(i0.x, i0.y, back), p(i1.x, i1.y, back), p(i1.x, i1.y, front), p(i0.x, i0.y, front), shade(color, 0.68), tile);
  }
}

function addTiledPlatform(mesh, x, surfaceY, z, width, depth, thickness, cell = 2, topTile = TILE.crackedFloor, sideTile = TILE.iceWall) {
  const x0 = x - width / 2;
  const z0 = z - depth / 2;
  const columns = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(depth / cell));
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const ax = x0 + width * column / columns;
      const bx = x0 + width * (column + 1) / columns;
      const az = z0 + depth * row / rows;
      const bz = z0 + depth * (row + 1) / rows;
      const tint = shade(COLOR.floor, 0.90 + ((row * 7 + column * 11) % 4) * 0.035);
      mesh.quad(p(ax, surfaceY, az), p(ax, surfaceY, bz), p(bx, surfaceY, bz), p(bx, surfaceY, az), tint, topTile);
    }
  }
  const bottom = surfaceY - thickness;
  const side = COLOR.floorDark;
  mesh.quad(p(x0, bottom, z0), p(x0, bottom, z0 + depth), p(x0, surfaceY, z0 + depth), p(x0, surfaceY, z0), side, sideTile);
  mesh.quad(p(x0 + width, bottom, z0 + depth), p(x0 + width, bottom, z0), p(x0 + width, surfaceY, z0), p(x0 + width, surfaceY, z0 + depth), shade(side, 0.78), sideTile);
  mesh.quad(p(x0 + width, bottom, z0), p(x0, bottom, z0), p(x0, surfaceY, z0), p(x0 + width, surfaceY, z0), shade(side, 0.68), sideTile);
  mesh.quad(p(x0, bottom, z0 + depth), p(x0 + width, bottom, z0 + depth), p(x0 + width, surfaceY, z0 + depth), p(x0, surfaceY, z0 + depth), shade(side, 0.90), sideTile);
}

function addOctagonalPlatform(mesh, x, surfaceY, z, radiusX, radiusZ, thickness, topTile = TILE.crackedFloor) {
  const ring = [];
  for (let index = 0; index < 8; index++) {
    const angle = Math.PI * 2 * index / 8 + Math.PI / 8;
    ring.push(p(x + Math.cos(angle) * radiusX, surfaceY, z + Math.sin(angle) * radiusZ));
  }
  const center = p(x, surfaceY, z);
  for (let index = 0; index < ring.length; index++) {
    const next = (index + 1) % ring.length;
    mesh.triangle(center, ring[index], ring[next], shade(COLOR.floor, 0.92 + (index % 3) * 0.06), topTile);
    mesh.quad(
      p(ring[next].x, surfaceY - thickness, ring[next].z),
      p(ring[index].x, surfaceY - thickness, ring[index].z),
      ring[index], ring[next],
      shade(COLOR.floorDark, 0.78 + (index % 3) * 0.08), TILE.iceWall,
    );
  }
}

function addPillar(mesh, x, surfaceY, z, height, scale = 1, broken = false) {
  addBox(mesh, x, surfaceY, z, 2.9 * scale, 0.48 * scale, 2.9 * scale, COLOR.stoneDark, TILE.carvedStone);
  addBox(mesh, x, surfaceY + 0.48 * scale, z, 2.25 * scale, 0.52 * scale, 2.25 * scale, COLOR.stone, TILE.gothic);
  addCylinder(mesh, x, surfaceY + scale, z, 0.72 * scale, Math.max(1, height - 1.8 * scale), 6, COLOR.stone, TILE.carvedStone);
  const capY = surfaceY + height - 0.8 * scale;
  addBox(mesh, x, capY, z, 1.9 * scale, 0.35 * scale, 1.9 * scale, COLOR.stone, TILE.gothic);
  if (broken) {
    addSpire(mesh, x + 0.12, capY + 0.32, z - 0.10, 0.58 * scale, 0.95 * scale, 5, COLOR.stoneDark, TILE.blackRock, 0.26, -0.12);
  } else {
    addBox(mesh, x, capY + 0.35 * scale, z, 2.45 * scale, 0.42 * scale, 2.45 * scale, COLOR.stoneLight, TILE.gothic);
    addSpire(mesh, x, capY + 0.77 * scale, z, 0.72 * scale, 1.55 * scale, 5, COLOR.iceDark, TILE.icicles, 0.08, -0.05);
  }
}

function addBrazier(mesh, x, surfaceY, z, scale = 1) {
  addBox(mesh, x, surfaceY, z, 1.6 * scale, 0.35 * scale, 1.6 * scale, COLOR.stoneDark, TILE.carvedStone);
  addCylinder(mesh, x, surfaceY + 0.35 * scale, z, 0.46 * scale, 1.25 * scale, 6, COLOR.fireStone, TILE.chain);
  addFrustum(mesh, x, surfaceY + 1.6 * scale, z, 0.95 * scale, 0.62 * scale, 0.42 * scale, 8, COLOR.stone, TILE.gothic);
}

function addChain(mesh, x0, y0, z0, x1, y1, z1, links, sag = 1.4) {
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  for (let index = 0; index < links; index++) {
    const t = (index + 0.5) / links;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * sag;
    const z = z0 + (z1 - z0) * t;
    addRotatedBox(mesh, x, y, z, 0.20, 0.28, 0.72, yaw + (index % 2 ? Math.PI / 2 : 0), COLOR.chain, TILE.chain);
  }
}

function buildApproach() {
  const mesh = new Mesh("approach");
  addTiledPlatform(mesh, 0, 0, 35, 11, 10, 3.2, 2);
  addBox(mesh, -5.7, 0, 38.5, 2.2, 7.5, 2.8, COLOR.stoneDark, TILE.carvedStone);
  addBox(mesh, 5.7, 0, 38.5, 2.2, 7.5, 2.8, COLOR.stoneDark, TILE.carvedStone);
  addArch(mesh, 0, 6.7, 38.4, 3.8, 5.7, 2.3, 8, COLOR.stone, TILE.arch);
  addSpire(mesh, -5.8, 7.2, 38.5, 0.8, 3.7, 5, COLOR.iceDark, TILE.icicles, -0.4, 0);
  addSpire(mesh, 5.8, 7.2, 38.5, 0.8, 3.7, 5, COLOR.iceDark, TILE.icicles, 0.4, 0);

  addRotatedBox(mesh, -0.25, -1.7, 26.4, 7.1, 1.7, 4.8, -0.035, COLOR.floor, TILE.crackedFloor);
  addRotatedBox(mesh, 0.55, -1.45, 20.7, 6.4, 1.7, 4.6, 0.055, COLOR.floor, TILE.crackedFloor);
  addRotatedBox(mesh, -0.35, -1.65, 15.3, 8.6, 1.7, 5.6, -0.025, COLOR.floor, TILE.crackedStone);
  addBox(mesh, -3.0, 0.02, 26.2, 0.16, 0.05, 3.2, COLOR.abyss, TILE.blackRock);
  addBox(mesh, 2.1, 0.27, 20.6, 0.13, 0.05, 2.8, COLOR.abyss, TILE.blackRock);
  addPillar(mesh, -4.4, 0, 31.7, 5.4, 0.72, true);
  addPillar(mesh, 4.2, 0, 31.5, 6.8, 0.78, false);
  addPillar(mesh, -4.7, 0, 15.2, 5.1, 0.68, true);
  addPillar(mesh, 4.8, 0, 14.8, 6.3, 0.72, false);
  addChain(mesh, -5.3, 3.4, 34, -4.2, 2.0, 21, 18, 2.2);
  addChain(mesh, 5.1, 4.2, 33, 4.1, 1.6, 18.5, 19, 2.5);
  for (const [x, z, h] of [[-4.4, 28.8, 2.1], [3.8, 23.4, 2.8], [-4.0, 18.2, 2.4]]) {
    addSpire(mesh, x, -1.2, z, 0.7, h, 5, COLOR.ice, TILE.icicles, x * 0.02, -0.1);
  }
  return mesh;
}

function buildArena() {
  const mesh = new Mesh("arena");
  addOctagonalPlatform(mesh, 0, 0, 0.5, 15.5, 13.8, 4.8);
  addCylinder(mesh, 0, 0.01, 0, 5.2, 0.18, 12, shade(COLOR.floor, 1.12), TILE.runes);
  addCylinder(mesh, 0, 0.19, 0, 2.7, 0.42, 10, COLOR.stone, TILE.carvedStone);
  addSpire(mesh, 0, 0.62, 0, 1.2, 4.8, 7, COLOR.ice, TILE.crystal, 0.25, -0.18);

  const pillars = [
    [-11.8, 7.0, 7.2, 0.95, false], [11.8, 6.7, 5.4, 0.82, true],
    [-13.0, -2.8, 5.7, 0.82, true], [13.2, -3.0, 8.2, 1.0, false],
    [-8.7, -10.0, 6.6, 0.88, false], [8.4, -10.2, 5.1, 0.76, true],
  ];
  for (const [x, z, height, scale, broken] of pillars) addPillar(mesh, x, 0, z, height, scale, broken);

  addTiledPlatform(mesh, 17.4, 0.65, 1.0, 6.2, 7.5, 3.4, 2, TILE.paleIce, TILE.iceWall);
  addRotatedBox(mesh, 14.7, -0.2, 2.0, 5.2, 0.85, 2.3, -0.18, COLOR.floor, TILE.crackedStone);
  addPillar(mesh, 18.6, 0.65, -0.4, 5.7, 0.72, true);
  addSpire(mesh, 16.4, 0.65, 2.5, 0.85, 3.5, 6, COLOR.crystal, TILE.crystal, -0.2, 0.12);
  addSpire(mesh, 19.0, 0.65, 2.2, 0.55, 2.2, 5, COLOR.ice, TILE.paleIce, 0.15, -0.1);
  addChain(mesh, 14.0, 3.2, 4.2, 19.8, 3.8, 4.0, 11, 1.1);

  for (const [x, z, h] of [[-5.5, 5.8, 2.6], [6.1, 4.2, 2.2], [-7.0, -4.2, 3.0], [5.7, -5.4, 2.7]]) {
    addSpire(mesh, x, 0, z, 0.62, h, 5, COLOR.iceDark, TILE.icicles, x > 0 ? 0.12 : -0.12, -0.08);
  }
  addBrazier(mesh, -9.4, 0, 1.2, 0.9);
  addBrazier(mesh, 9.2, 0, 0.4, 0.9);
  return mesh;
}

function buildAscent() {
  const mesh = new Mesh("ascent");
  const steps = [
    [0, 0.75, -13.2, 9.0, 3.0],
    [0, 1.5, -16.2, 8.6, 3.0],
    [0.2, 2.25, -19.2, 8.2, 3.0],
    [-0.2, 3.0, -22.4, 7.8, 3.4],
  ];
  for (const [x, surfaceY, z, width, depth] of steps) {
    addTiledPlatform(mesh, x, surfaceY, z, width, depth, 2.8, 1.8, TILE.crackedStone, TILE.iceWall);
  }
  addRotatedBox(mesh, 0.6, 1.2, -27.2, 7.4, 2.4, 4.0, 0.055, COLOR.floor, TILE.crackedFloor);
  addTiledPlatform(mesh, 0, 4.2, -31.0, 12.0, 6.0, 4.5, 2, TILE.crackedStone, TILE.iceWall);

  addTiledPlatform(mesh, -11.0, 1.2, -7.0, 4.8, 5.2, 3.0, 2, TILE.paleIce, TILE.iceWall);
  addRotatedBox(mesh, -10.8, -0.3, -12.3, 4.4, 2.0, 7.0, -0.05, COLOR.floor, TILE.crackedStone);
  addTiledPlatform(mesh, -8.4, 2.65, -18.2, 6.0, 5.8, 3.5, 2, TILE.paleIce, TILE.iceWall);
  addRotatedBox(mesh, -5.3, 0.4, -22.2, 5.4, 2.8, 3.0, -0.15, COLOR.floor, TILE.crackedStone);
  addChain(mesh, -12.8, 5.2, -6.0, -9.0, 5.7, -18.0, 18, 2.2);

  addPillar(mesh, -5.2, 3.0, -22.2, 8.0, 0.82, false);
  addPillar(mesh, 5.1, 3.0, -22.1, 5.5, 0.74, true);
  addPillar(mesh, -6.0, 4.2, -31.4, 7.0, 0.82, false);
  addPillar(mesh, 6.0, 4.2, -31.3, 6.0, 0.78, true);
  addSpire(mesh, 3.2, 3.0, -25.5, 0.62, 2.7, 5, COLOR.ice, TILE.crystal, 0.12, -0.08);
  addSpire(mesh, -2.8, 4.2, -30.2, 0.56, 2.3, 5, COLOR.iceDark, TILE.icicles, -0.1, 0.05);
  return mesh;
}

function buildSanctum() {
  const mesh = new Mesh("sanctum");
  addTiledPlatform(mesh, 0, 4.8, -38.8, 17.0, 12.5, 7.0, 2, TILE.crackedStone, TILE.iceWall);
  addBox(mesh, 0, 4.8, -38.7, 5.2, 0.5, 4.0, COLOR.stoneDark, TILE.carvedStone);
  addBox(mesh, 0, 5.3, -39.0, 4.0, 0.55, 3.0, COLOR.stone, TILE.gothic);
  addBox(mesh, 0, 5.85, -39.4, 2.6, 1.25, 1.8, COLOR.stoneLight, TILE.runes);
  addBrazier(mesh, -5.8, 4.8, -38.5, 1.0);
  addBrazier(mesh, 5.8, 4.8, -38.5, 1.0);

  addBox(mesh, -7.0, 4.8, -45.0, 4.2, 12.0, 4.2, COLOR.stoneDark, TILE.carvedStone);
  addBox(mesh, 7.0, 4.8, -45.0, 4.2, 12.0, 4.2, COLOR.stoneDark, TILE.carvedStone);
  addBox(mesh, -7.0, 6.0, -44.3, 3.2, 11.5, 3.2, COLOR.stone, TILE.gothic);
  addBox(mesh, 7.0, 6.0, -44.3, 3.2, 11.5, 3.2, COLOR.stone, TILE.gothic);
  addArch(mesh, 0, 13.5, -44.2, 4.2, 7.0, 3.2, 10, COLOR.stone, TILE.arch);
  addBox(mesh, 0, 19.4, -45.0, 16.5, 1.5, 5.0, COLOR.stoneDark, TILE.gate);
  addSpire(mesh, -7.2, 17.2, -45.0, 1.4, 7.0, 6, COLOR.iceDark, TILE.icicles, -0.7, -0.1);
  addSpire(mesh, 7.2, 17.2, -45.0, 1.4, 7.0, 6, COLOR.iceDark, TILE.icicles, 0.7, -0.1);
  addChain(mesh, -8.2, 16.5, -43.0, 8.2, 16.5, -43.0, 25, 4.0);
  return mesh;
}

function buildTitan() {
  const mesh = new Mesh("titan");
  addFrustum(mesh, 0, 9.0, -51.5, 9.5, 6.8, 12.5, 8, COLOR.stoneDark, TILE.blackRock);
  addRotatedBox(mesh, -8.0, 12.5, -50.4, 10.0, 5.0, 5.0, -0.18, COLOR.stoneDark, TILE.carvedStone);
  addRotatedBox(mesh, 8.0, 12.5, -50.4, 10.0, 5.0, 5.0, 0.18, COLOR.stoneDark, TILE.carvedStone);
  addFrustum(mesh, 0, 20.5, -49.6, 4.8, 4.0, 6.0, 7, COLOR.stone, TILE.gothic);
  addBox(mesh, 0, 25.2, -49.3, 6.8, 3.6, 5.0, COLOR.stoneDark, TILE.gate);
  addSpire(mesh, -3.6, 25.5, -49.2, 1.15, 8.0, 6, COLOR.iceDark, TILE.icicles, -3.0, 0.3);
  addSpire(mesh, 3.6, 25.5, -49.2, 1.15, 8.0, 6, COLOR.iceDark, TILE.icicles, 3.0, 0.3);
  addSpire(mesh, 0, 28.4, -49.2, 1.4, 7.5, 6, COLOR.stoneDark, TILE.gothic, 0, -0.2);
  addBox(mesh, -2.0, 26.3, -46.7, 1.25, 0.65, 0.5, COLOR.crystal, TILE.crystal);
  addBox(mesh, 2.0, 26.3, -46.7, 1.25, 0.65, 0.5, COLOR.crystal, TILE.crystal);
  addSpire(mesh, -13.0, 8.0, -52.0, 3.6, 19.0, 6, COLOR.iceDark, TILE.mountain, -1.5, 0.4);
  addSpire(mesh, 13.0, 8.0, -52.0, 3.6, 19.0, 6, COLOR.iceDark, TILE.mountain, 1.5, 0.4);
  return mesh;
}

function buildBackdrop() {
  const mesh = new Mesh("backdrop");
  addTiledPlatform(mesh, 0, -11.5, -6, 90, 110, 1.0, 10, TILE.blackRock, TILE.blackRock);
  for (let index = 0; index < 15; index++) {
    const z = 39 - index * 7.0;
    const wobble = Math.sin(index * 2.13) * 2.8;
    addSpire(mesh, -30 + wobble, -11, z, 6 + index % 3, 20 + (index * 7) % 15, 6, shade(COLOR.iceDark, 0.66 + (index % 3) * 0.08), TILE.mountain, 1.2, -0.5);
    addSpire(mesh, 31 - wobble * 0.7, -11, z - 2, 6.5 + (index + 1) % 3, 22 + (index * 5) % 17, 6, shade(COLOR.iceDark, 0.62 + (index % 4) * 0.07), TILE.mountain, -1.2, 0.4);
  }
  for (let index = 0; index < 9; index++) {
    const x = -30 + index * 7.5;
    addSpire(mesh, x, -11, -61 + Math.sin(index) * 2, 7, 24 + (index * 9) % 16, 6, shade(COLOR.iceDark, 0.58 + (index % 4) * 0.06), TILE.mountain, Math.sin(index * 1.7), 0.3);
  }
  return mesh;
}

function buildRelic() {
  const mesh = new Mesh("relic");
  addSpire(mesh, 17.2, 1.1, 1.0, 0.72, 2.8, 6, COLOR.crystal, TILE.crystal, 0.12, -0.08);
  addSpire(mesh, 16.4, 1.0, 1.3, 0.38, 1.6, 5, COLOR.ice, TILE.paleIce, -0.08, 0.05);
  addSpire(mesh, 18.0, 1.0, 1.2, 0.34, 1.4, 5, COLOR.ice, TILE.paleIce, 0.06, -0.04);
  return mesh;
}

function fixed(value) {
  const clean = Math.abs(value) < 0.000001 ? 0 : value;
  return clean.toFixed(6).replace(/\.?0+$/, "");
}

function uvFor(tile, vertexIndex) {
  const column = tile % 4;
  const row = Math.floor(tile / 4);
  const margin = 0.008;
  const u0 = column * 0.25 + margin;
  const u1 = (column + 1) * 0.25 - margin;
  const v0 = 1 - (row + 1) * 0.25 + margin;
  const v1 = 1 - row * 0.25 - margin;
  const corners = [
    [u0, v1], [u1, v1], [u1, v0],
    [u0, v1], [u1, v0], [u0, v0],
  ];
  return corners[vertexIndex % 6];
}

async function exportMesh(mesh) {
  const files = [];
  // AthenaEnv already handles the original level in 1,800-vertex blocks.
  // Keeping the same ceiling avoids tiny extra draw calls on the PS2.
  const maximumVertices = 1800;
  for (let first = 0, chunk = 0; first < mesh.vertexCount; first += maximumVertices, chunk++) {
    const last = Math.min(mesh.vertexCount, first + maximumVertices);
    const filename = `citadel_${mesh.name}_${chunk}.obj`;
    const lines = [
      "# Fortaleza das Correntes Congeladas - AthenaEnv / PS2",
      "mtllib citadel_frost.mtl",
      "usemtl citadel_frost",
      `o citadel_${mesh.name}_${chunk}`,
      "s off",
    ];
    for (let vertex = first; vertex < last; vertex++) {
      const offset = vertex * 3;
      lines.push(`v ${fixed(mesh.positions[offset])} ${fixed(mesh.positions[offset + 1])} ${fixed(mesh.positions[offset + 2])} ${fixed(mesh.colors[offset])} ${fixed(mesh.colors[offset + 1])} ${fixed(mesh.colors[offset + 2])}`);
    }
    for (let vertex = first; vertex < last; vertex++) {
      const offset = vertex * 3;
      lines.push(`vn ${fixed(mesh.normals[offset])} ${fixed(mesh.normals[offset + 1])} ${fixed(mesh.normals[offset + 2])}`);
    }
    for (let vertex = first; vertex < last; vertex++) {
      const uv = uvFor(mesh.tiles[vertex], vertex - first);
      lines.push(`vt ${fixed(uv[0])} ${fixed(uv[1])}`);
    }
    for (let local = 0; local < last - first; local += 3) {
      const a = local + 1;
      lines.push(`f ${a}/${a}/${a} ${a + 1}/${a + 1}/${a + 1} ${a + 2}/${a + 2}/${a + 2}`);
    }
    await writeFile(path.join(assetsRoot, filename), `${lines.join("\n")}\n`, "utf8");
    files.push(filename);
  }
  return files;
}

function baseObject(id, name, kind, position = p(0, 0, 0), scale = p(1, 1, 1), extra = {}) {
  return {
    id,
    name,
    source: { kind, asset: "", ...(extra.source || {}) },
    parentId: extra.parentId ?? null,
    position,
    rotation: extra.rotation || p(0, 0, 0),
    scale,
    color: extra.color || "#8bd5f7",
    visible: extra.visible !== false,
    locked: extra.locked === true,
    runtime: extra.runtime !== false,
    persistent: extra.persistent === true,
    ...extra.fields,
  };
}

function material(overrides = {}) {
  return {
    color: "#ffffff",
    texture: "",
    opacity: 1,
    roughness: 0.78,
    metalness: 0,
    emissive: "#000000",
    emissiveIntensity: 0,
    unlit: false,
    doubleSided: true,
    textureMapping: true,
    smoothShading: false,
    accurateClipping: false,
    ...overrides,
  };
}

function modelObject(id, name, asset, parentId, overrides = {}) {
  return baseObject(id, name, "model", p(0, 0, 0), p(1, 1, 1), {
    parentId,
    source: { asset },
    fields: { material: material(overrides), animation: { clip: "", autoplay: false, loop: true } },
  });
}

function gameplay(overrides = {}) {
  return {
    health: { enabled: false, maximum: 100, initial: 100, invulnerabilityFrames: 15, hideOnDeath: true, persistent: false },
    damage: { enabled: false, amount: 10, targetId: "__player__", activation: "onEnter", cooldownFrames: 30 },
    collectible: { enabled: false, variableId: "", amount: 1, activation: "onEnter", visualTargetId: "", message: "Item coletado.", autosave: false },
    interactable: { enabled: false, prompt: "Pressione Triangulo para interagir", once: false },
    deathZone: { enabled: false, fadeFrames: 24 },
    ...overrides,
  };
}

function colliderObject(id, name, shape, position, scale, options = {}) {
  const isTrigger = options.trigger === true || options.portal?.enabled || options.checkpoint?.enabled || options.gameplay;
  return baseObject(id, name, "collider", position, scale, {
    parentId: options.parentId || "citadel-collisions",
    color: options.color || (isTrigger ? "#ff647c" : "#68e0b2"),
    rotation: options.rotation || p(0, 0, 0),
    source: { collider: shape },
    fields: {
      collider: { trigger: isTrigger === true, cameraBlocker: isTrigger ? false : options.cameraBlocker !== false },
      events: options.events || { onEnter: [], onExit: [], onInteract: [] },
      portal: options.portal || { enabled: false, targetSceneId: "", targetSpawnId: "", activation: "onEnter", fadeFrames: 30, condition: { enabled: false, variableId: "", operator: "eq", value: false } },
      checkpoint: options.checkpoint || { enabled: false, activation: "onEnter", autosave: true },
      gameplay: gameplay(options.gameplay || {}),
    },
  });
}

function lightObject(id, name, type, position, color, intensity, distance = 12, flicker = false) {
  return baseObject(id, name, "light", position, p(1, 1, 1), {
    color,
    source: { light: type },
    fields: { light: { type, color, intensity, distance, castShadow: type === "directional", flicker, flickerAmount: 0.22, flickerSpeed: 7.2 } },
  });
}

function particleObject(id, name, preset, position, color) {
  return baseObject(id, name, "particle", position, p(1, 1, 1), {
    color,
    fields: { particle: { preset, color, autoplay: true, maxParticles: 4, rate: preset === "fire" ? 7 : 3.5, lifetime: preset === "fire" ? 68 : 130, speed: preset === "fire" ? 0.034 : 0.016, spread: 0.42, size: preset === "fire" ? 0.18 : 0.25, gravity: preset === "fire" ? -0.0004 : -0.00015 } },
  });
}

function createScene(filesByMesh) {
  const objects = [
    baseObject("citadel-environment", "Fortaleza congelada", "group"),
    baseObject("citadel-collisions", "Colisoes da fase", "group", p(0, 0, 0), p(1, 1, 1), { visible: false }),
  ];

  for (const [meshName, files] of Object.entries(filesByMesh)) {
    const isRelic = meshName === "relic";
    for (let index = 0; index < files.length; index++) {
      objects.push(modelObject(
        `citadel-${meshName}-${index}`,
        `${meshName[0].toUpperCase()}${meshName.slice(1)} - bloco ${index + 1}`,
        files[index],
        "citadel-environment",
        isRelic ? { emissive: "#4bdcff", emissiveIntensity: 1.8, roughness: 0.32 } : meshName === "titan" ? { roughness: 0.92 } : {},
      ));
    }
  }

  objects.push(baseObject("citadel-spawn", "Entrada da ponte", "spawn", p(0, 0.08, 35.5), p(1, 1, 1), {
    rotation: p(0, 0, 0),
    color: "#ffc15c",
    fields: { spawn: { default: true } },
  }));
  objects.push(baseObject("citadel-camera-preview", "Camera panoramica da fortaleza", "camera", p(22, 18, 38), p(1, 1, 1), {
    rotation: p(-14.5, 20.8, 0),
    color: "#57cef5",
    runtime: false,
    fields: { camera: { fov: 56, near: 0.1, far: 180, active: false, mode: "fixed" } },
  }));

  const floors = [
    ["entry", "Plataforma inicial", p(0, -1.6, 35), p(5.5, 1.6, 5.0)],
    ["bridge-a", "Ponte quebrada A", p(-0.25, -0.85, 26.4), p(3.55, 0.85, 2.4)],
    ["bridge-b", "Ponte quebrada B", p(0.55, -0.6, 20.7), p(3.2, 0.85, 2.3)],
    ["bridge-c", "Desembarque da ponte", p(-0.35, -0.8, 15.3), p(4.3, 0.85, 2.8)],
    ["arena-core", "Arena central", p(0, -1.9, 0.5), p(10.5, 1.9, 13.0)],
    ["arena-left", "Ala esquerda da arena", p(-12.1, -1.9, 0.5), p(2.8, 1.9, 7.4)],
    ["arena-right", "Ala direita da arena", p(12.1, -1.9, 0.5), p(2.8, 1.9, 7.4)],
    ["relic-island", "Ilha de exploracao", p(17.4, -1.05, 1.0), p(3.1, 1.7, 3.75)],
    ["step-1", "Degrau de ascensao 1", p(0, -1.0, -13.2), p(4.5, 1.75, 1.5)],
    ["step-2", "Degrau de ascensao 2", p(0, -0.65, -16.2), p(4.3, 2.15, 1.5)],
    ["step-3", "Degrau de ascensao 3", p(0.2, -0.3, -19.2), p(4.1, 2.55, 1.5)],
    ["step-4", "Degrau de ascensao 4", p(-0.2, 0.1, -22.4), p(3.9, 2.9, 1.7)],
    ["upper-bridge", "Ponte superior", p(0.6, 2.4, -27.2), p(3.7, 1.2, 2.0)],
    ["upper-landing", "Patamar superior", p(0, 1.95, -31), p(6.0, 2.25, 3.0)],
    ["side-ledge-a", "Rota lateral A", p(-11, -0.9, -7), p(2.4, 2.1, 2.6)],
    ["side-ledge-b", "Rota lateral B", p(-10.8, 0.7, -12.3), p(2.2, 1.0, 3.5)],
    ["side-ledge-c", "Rota lateral C", p(-8.4, 0.9, -18.2), p(3.0, 1.75, 2.9)],
    ["side-ledge-d", "Rota lateral D", p(-5.3, 1.8, -22.2), p(2.7, 1.4, 1.5)],
    ["sanctum", "Santuario do Tita", p(0, 1.3, -38.8), p(8.5, 3.5, 6.25)],
  ];
  for (const [id, name, position, scale] of floors) objects.push(colliderObject(`citadel-floor-${id}`, name, "box", position, scale, { cameraBlocker: false }));

  const obstacles = [
    ["arena-crystal", "Cristal central", "sphere", p(0, 2.2, 0), p(1.45, 2.4, 1.45)],
    ["arena-pillar-left", "Pilar da arena esquerdo", "box", p(-11.8, 3.0, 7.0), p(1.4, 3.0, 1.4)],
    ["arena-pillar-right", "Pilar da arena direito", "box", p(13.2, 3.2, -3.0), p(1.45, 3.2, 1.45)],
    ["ascent-pillar-left", "Pilar da subida", "box", p(-5.2, 6.5, -22.2), p(1.35, 3.5, 1.35)],
    ["gate-left", "Torre esquerda", "box", p(-7.0, 10.8, -45.0), p(2.1, 6.0, 2.1)],
    ["gate-right", "Torre direita", "box", p(7.0, 10.8, -45.0), p(2.1, 6.0, 2.1)],
  ];
  for (const [id, name, shape, position, scale] of obstacles) objects.push(colliderObject(`citadel-obstacle-${id}`, name, shape, position, scale, { cameraBlocker: true }));

  objects.push(colliderObject("citadel-checkpoint-start", "Checkpoint da ponte", "box", p(0, 1.2, 34.5), p(3.8, 1.2, 2.3), {
    trigger: true,
    checkpoint: { enabled: true, activation: "onEnter", autosave: true },
    events: { onEnter: [{ type: "message", text: "FORTALEZA DAS CORRENTES CONGELADAS", duration: 180 }], onExit: [], onInteract: [] },
    color: "#62c6ff",
  }));
  objects.push(colliderObject("citadel-checkpoint-arena", "Checkpoint da arena", "box", p(0, 1.2, 9.0), p(4.0, 1.2, 2.0), {
    trigger: true,
    checkpoint: { enabled: true, activation: "onEnter", autosave: true },
    events: { onEnter: [{ type: "message", text: "O Tita observa das muralhas.", duration: 150 }], onExit: [], onInteract: [] },
    color: "#62c6ff",
  }));
  objects.push(colliderObject("citadel-checkpoint-sanctum", "Checkpoint do santuario", "box", p(0, 6.0, -33.2), p(4.5, 1.5, 1.6), {
    trigger: true,
    checkpoint: { enabled: true, activation: "onEnter", autosave: true },
    color: "#62c6ff",
  }));

  objects.push(colliderObject("citadel-relic-trigger", "Fragmento do Tita", "sphere", p(17.2, 2.3, 1.0), p(1.0, 1.0, 1.0), {
    trigger: true,
    gameplay: { collectible: { enabled: true, variableId: "titan-shards", amount: 1, activation: "onEnter", visualTargetId: "citadel-relic-0", message: "Fragmento do Tita encontrado.", autosave: true } },
    color: "#5de8ff",
  }));

  objects.push(colliderObject("citadel-spike-damage", "Espinhos da subida", "box", p(2.9, 3.8, -25.8), p(1.0, 1.0, 0.8), {
    trigger: true,
    gameplay: { damage: { enabled: true, amount: 20, targetId: "__player__", activation: "onEnter", cooldownFrames: 45 } },
    color: "#ff647c",
  }));

  objects.push(colliderObject("citadel-exit-portal", "Portal do altar", "box", p(0, 7.0, -43.0), p(3.6, 2.2, 0.9), {
    trigger: true,
    portal: { enabled: true, targetSceneId: "salao-saida-01", targetSpawnId: "spawn-mrozcqvq-becjqz", activation: "onInteract", fadeFrames: 38, condition: { enabled: false, variableId: "", operator: "eq", value: false } },
    gameplay: { interactable: { enabled: true, prompt: "Pressione Triangulo para abrir o portao", once: false } },
    events: { onEnter: [], onExit: [], onInteract: [{ type: "message", text: "As correntes antigas cedem.", duration: 90 }] },
    color: "#ffad66",
  }));

  objects.push(lightObject("citadel-light-ambient", "Luz ambiente glacial", "ambient", p(0, 16, 0), "#7598c7", 0.70));
  const directional = lightObject("citadel-light-moon", "Luz da lua", "directional", p(-16, 28, 22), "#b8ddff", 2.05);
  directional.rotation = p(-52, 28, 0);
  objects.push(directional);
  const torches = [
    ["arena-left", p(-9.4, 2.2, 1.2)],
    ["arena-right", p(9.2, 2.2, 0.4)],
    ["sanctum-left", p(-5.8, 7.0, -38.5)],
    ["sanctum-right", p(5.8, 7.0, -38.5)],
  ];
  for (const [id, position] of torches) {
    objects.push(particleObject(`citadel-fire-${id}`, `Fogo ${id}`, "fire", position, "#ff6b22"));
  }
  // The AthenaEnv runtime reserves exactly two slots for local lights. One
  // warm field covers each gameplay set piece while all four braziers retain
  // their visible particle flames.
  objects.push(lightObject("citadel-light-arena", "Fogo quente da arena", "point", p(0, 3.2, 0.8), "#ff8b3e", 2.9, 16.5, true));
  objects.push(lightObject("citadel-light-sanctum", "Fogo quente do santuario", "point", p(0, 8.0, -38.5), "#ff8b3e", 3.1, 15.0, true));

  objects.push(baseObject("citadel-audio", "Vento da fortaleza", "audio", p(0, 5, 10), p(1, 1, 1), {
    source: { asset: "sounds/fyu17-7ijx5.ogg" },
    fields: { audio: { mode: "stream", autoplay: true, loop: true, volume: 58, spatial: false, distance: 40, pan: 0, pitch: 0 } },
  }));

  return {
    version: 1,
    name: "Fortaleza das Correntes Congeladas",
    settings: {
      background: "#050b15",
      gridSize: 140,
      snap: 0.25,
      snapEnabled: false,
      snapMode: "grid",
      camera: { position: p(27, 24, 46), target: p(0, 8, -18) },
      runtime: {
        vsync: true,
        showPerformance: false,
        legacyArenaBounds: false,
        player: {
          spawn: p(0, 0.08, 35.5),
          radius: 0.68,
          height: 2.25,
          walkSpeed: 0.125,
          runSpeed: 0.195,
          jumpSpeed: 0.40,
          gravity: 0.014,
          modelAsset: "player.obj",
          health: { enabled: true, maximum: 100, initial: 100, invulnerabilityFrames: 30, respawnOnDeath: true, showHud: true },
        },
      },
    },
    objects,
    ui: [],
    logic: {
      version: 1,
      variables: [
        { id: "jump-count", name: "Pulos", type: "number", initialValue: 0 },
        { id: "variable-mrr467gm-aj7v04", name: "Moedas", type: "number", initialValue: 0 },
        { id: "titan-shards", name: "Fragmentos do Tita", type: "number", initialValue: 0 },
      ],
      graphs: [],
    },
  };
}

await mkdir(assetsRoot, { recursive: true });
await mkdir(scenesRoot, { recursive: true });

const meshes = [buildApproach(), buildArena(), buildAscent(), buildSanctum(), buildTitan(), buildBackdrop(), buildRelic()];
const filesByMesh = {};
for (const mesh of meshes) filesByMesh[mesh.name] = await exportMesh(mesh);

const expectedObjFiles = new Set(Object.values(filesByMesh).flat());
for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/^citadel_(approach|arena|ascent|sanctum|titan|backdrop|relic)_\d+\.obj$/.test(entry.name)) continue;
  if (!expectedObjFiles.has(entry.name)) await unlink(path.join(assetsRoot, entry.name));
}

await writeFile(path.join(assetsRoot, "citadel_frost.mtl"), [
  "# Material PS2 da Fortaleza das Correntes Congeladas",
  "newmtl citadel_frost",
  "Ka 0.26 0.34 0.46",
  "Kd 1.0 1.0 1.0",
  "Ks 0.16 0.22 0.28",
  "Ns 20.0",
  "d 1.0",
  "illum 2",
  "map_Kd Textures/ice_ruins_atlas.png",
  "",
].join("\n"), "utf8");

const scene = createScene(filesByMesh);
await writeFile(path.join(scenesRoot, "fortaleza-das-correntes.json"), `${JSON.stringify(scene, null, 2)}\n`, "utf8");

const triangleCount = meshes.reduce((sum, mesh) => sum + mesh.vertexCount / 3, 0);
const modelCount = Object.values(filesByMesh).reduce((sum, files) => sum + files.length, 0);
console.log(`Fortaleza criada: ${triangleCount} triangulos, ${modelCount} blocos OBJ e ${scene.objects.length} objetos de cena.`);
