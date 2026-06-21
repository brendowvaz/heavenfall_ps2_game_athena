// {"name":"Ruinas do Veu Azul","author":"Codex + Brendan","version":"20062026","file":"main.js"}

// Interactive PS2 level for AthenaEnv. Geometry is generated once at boot and
// merged into a single low-poly mesh to keep draw calls and memory predictable.

const canvas = Screen.getMode();
canvas.zbuffering = true;
canvas.double_buffering = true;
canvas.psm = Screen.CT32;
canvas.psmz = Screen.Z16S;
Screen.setMode(canvas);
Screen.setVSync(true);
Screen.setFrameCounter(true);

Render.init();
Render.setView(64.0, 0.5, 180.0);
console.log("[VeuAzul] Render inicializado");

Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);

const CLEAR_COLOR = Color.new(7, 15, 28, 128);
const HUD_WHITE = Color.new(210, 231, 246, 128);
const HUD_BLUE = Color.new(76, 184, 235, 128);

const font = new Font("default");
font.scale = 0.45;
font.color = HUD_WHITE;
font.outline = 1.0;
font.outline_color = Color.new(3, 8, 16, 128);

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function color(r, g, b, a) {
    return { r: r, g: g, b: b, a: a === undefined ? 1.0 : a };
}

function shade(source, amount) {
    return color(
        clamp(source.r * amount, 0.0, 1.0),
        clamp(source.g * amount, 0.0, 1.0),
        clamp(source.b * amount, 0.0, 1.0),
        source.a
    );
}

const PALETTE = {
    floor: color(0.19, 0.28, 0.38),
    floorLight: color(0.28, 0.43, 0.56),
    cliff: color(0.055, 0.09, 0.15),
    stone: color(0.17, 0.25, 0.31),
    stoneLight: color(0.27, 0.37, 0.41),
    stoneDark: color(0.075, 0.11, 0.15),
    ice: color(0.35, 0.62, 0.79),
    iceDark: color(0.12, 0.25, 0.36),
    cyan: color(0.15, 0.86, 1.0),
    cyanSoft: color(0.12, 0.42, 0.59),
    fire: color(1.0, 0.57, 0.19),
    fireSoft: color(0.43, 0.24, 0.11),
    chain: color(0.10, 0.095, 0.09),
    crack: color(0.025, 0.05, 0.08),
    player: color(0.62, 0.84, 0.94),
    playerSide: color(0.23, 0.47, 0.61)
};

function Geometry() {
    this.positions = [];
    this.normals = [];
    this.texcoords = [];
    this.colors = [];
}

Geometry.prototype.pushVertex = function (point, normal, tint) {
    this.positions.push(point.x, point.y, point.z, 1.0);
    this.normals.push(normal.x, normal.y, normal.z, 1.0);
    this.texcoords.push(0.0, 0.0, 1.0, 1.0);
    this.colors.push(tint.r, tint.g, tint.b, tint.a);
};

Geometry.prototype.triangleColors = function (a, b, c, colorA, colorB, colorC) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
    nx /= length;
    ny /= length;
    nz /= length;
    const normal = { x: nx, y: ny, z: nz };
    this.pushVertex(a, normal, colorA);
    this.pushVertex(b, normal, colorB);
    this.pushVertex(c, normal, colorC);
};

Geometry.prototype.triangle = function (a, b, c, tint) {
    this.triangleColors(a, b, c, tint, tint, tint);
};

Geometry.prototype.quad = function (a, b, c, d, tint) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
};

function point(x, y, z) {
    return { x: x, y: y, z: z };
}

function addBox(mesh, x, y, z, width, height, depth, tint) {
    const x0 = x - width * 0.5;
    const x1 = x + width * 0.5;
    const y0 = y;
    const y1 = y + height;
    const z0 = z - depth * 0.5;
    const z1 = z + depth * 0.5;

    mesh.quad(point(x0, y1, z0), point(x0, y1, z1), point(x1, y1, z1), point(x1, y1, z0), shade(tint, 1.18));
    mesh.quad(point(x0, y0, z1), point(x0, y0, z0), point(x1, y0, z0), point(x1, y0, z1), shade(tint, 0.48));
    mesh.quad(point(x0, y0, z0), point(x0, y1, z0), point(x1, y1, z0), point(x1, y0, z0), shade(tint, 0.73));
    mesh.quad(point(x1, y0, z1), point(x1, y0, z0), point(x1, y1, z0), point(x1, y1, z1), shade(tint, 0.91));
    mesh.quad(point(x0, y0, z1), point(x1, y0, z1), point(x1, y1, z1), point(x0, y1, z1), shade(tint, 1.02));
    mesh.quad(point(x0, y0, z0), point(x0, y0, z1), point(x0, y1, z1), point(x0, y1, z0), shade(tint, 0.62));
}

function rotateY(localX, localZ, yaw) {
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    return { x: localX * cosine + localZ * sine, z: -localX * sine + localZ * cosine };
}

function addRotatedBox(mesh, x, y, z, width, height, depth, yaw, tint) {
    const corners = [];
    const local = [
        [-width * 0.5, -depth * 0.5], [width * 0.5, -depth * 0.5],
        [width * 0.5, depth * 0.5], [-width * 0.5, depth * 0.5]
    ];
    for (let i = 0; i < 4; i++) {
        const rotated = rotateY(local[i][0], local[i][1], yaw);
        corners.push(point(x + rotated.x, y, z + rotated.z));
        corners.push(point(x + rotated.x, y + height, z + rotated.z));
    }
    mesh.quad(corners[1], corners[3], corners[5], corners[7], shade(tint, 1.18));
    mesh.quad(corners[0], corners[6], corners[4], corners[2], shade(tint, 0.5));
    for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        mesh.quad(corners[side * 2], corners[next * 2], corners[next * 2 + 1], corners[side * 2 + 1], shade(tint, 0.64 + side * 0.11));
    }
}

function addCylinder(mesh, x, y, z, radius, height, sides, tint) {
    const bottom = point(x, y, z);
    const top = point(x, y + height, z);
    for (let i = 0; i < sides; i++) {
        const angle0 = Math.PI * 2.0 * i / sides;
        const angle1 = Math.PI * 2.0 * (i + 1) / sides;
        const p0 = point(x + Math.cos(angle0) * radius, y, z + Math.sin(angle0) * radius);
        const p1 = point(x + Math.cos(angle1) * radius, y, z + Math.sin(angle1) * radius);
        const p2 = point(p1.x, y + height, p1.z);
        const p3 = point(p0.x, y + height, p0.z);
        const sideTint = shade(tint, 0.64 + 0.34 * (0.5 + Math.sin(angle0) * 0.5));
        mesh.quad(p0, p1, p2, p3, sideTint);
        mesh.triangle(top, p3, p2, shade(tint, 1.18));
        mesh.triangle(bottom, p1, p0, shade(tint, 0.45));
    }
}

function addFrustum(mesh, x, y, z, lowerRadius, upperRadius, height, sides, tint) {
    for (let i = 0; i < sides; i++) {
        const angle0 = Math.PI * 2.0 * i / sides;
        const angle1 = Math.PI * 2.0 * (i + 1) / sides;
        const p0 = point(x + Math.cos(angle0) * lowerRadius, y, z + Math.sin(angle0) * lowerRadius);
        const p1 = point(x + Math.cos(angle1) * lowerRadius, y, z + Math.sin(angle1) * lowerRadius);
        const p2 = point(x + Math.cos(angle1) * upperRadius, y + height, z + Math.sin(angle1) * upperRadius);
        const p3 = point(x + Math.cos(angle0) * upperRadius, y + height, z + Math.sin(angle0) * upperRadius);
        mesh.quad(p0, p1, p2, p3, shade(tint, 0.62 + i / sides * 0.38));
    }
}

function addSpire(mesh, x, y, z, radius, height, sides, tint, leanX, leanZ) {
    const apex = point(x + (leanX || 0.0), y + height, z + (leanZ || 0.0));
    const center = point(x, y, z);
    for (let i = 0; i < sides; i++) {
        const angle0 = Math.PI * 2.0 * i / sides;
        const angle1 = Math.PI * 2.0 * (i + 1) / sides;
        const p0 = point(x + Math.cos(angle0) * radius, y, z + Math.sin(angle0) * radius);
        const p1 = point(x + Math.cos(angle1) * radius, y, z + Math.sin(angle1) * radius);
        mesh.triangle(p0, p1, apex, shade(tint, 0.62 + 0.52 * (0.5 + Math.sin(angle0 + 0.7) * 0.5)));
        mesh.triangle(center, p1, p0, shade(tint, 0.46));
    }
}

function addDisc(mesh, x, y, z, radius, sides, centerTint, edgeTint) {
    const center = point(x, y, z);
    for (let i = 0; i < sides; i++) {
        const angle0 = Math.PI * 2.0 * i / sides;
        const angle1 = Math.PI * 2.0 * (i + 1) / sides;
        const p0 = point(x + Math.cos(angle0) * radius, y, z + Math.sin(angle0) * radius);
        const p1 = point(x + Math.cos(angle1) * radius, y, z + Math.sin(angle1) * radius);
        mesh.triangleColors(center, p0, p1, centerTint, edgeTint, edgeTint);
    }
}

function addArch(mesh, x, y, z, innerRadius, outerRadius, depth, segments, tint) {
    const zFront = z + depth * 0.5;
    const zBack = z - depth * 0.5;
    for (let i = 0; i < segments; i++) {
        const angle0 = Math.PI * i / segments;
        const angle1 = Math.PI * (i + 1) / segments;
        const inner0 = { x: x + Math.cos(angle0) * innerRadius, y: y + Math.sin(angle0) * innerRadius };
        const inner1 = { x: x + Math.cos(angle1) * innerRadius, y: y + Math.sin(angle1) * innerRadius };
        const outer0 = { x: x + Math.cos(angle0) * outerRadius, y: y + Math.sin(angle0) * outerRadius };
        const outer1 = { x: x + Math.cos(angle1) * outerRadius, y: y + Math.sin(angle1) * outerRadius };
        const a = point(inner0.x, inner0.y, zFront);
        const b = point(inner1.x, inner1.y, zFront);
        const c = point(outer1.x, outer1.y, zFront);
        const d = point(outer0.x, outer0.y, zFront);
        const e = point(inner0.x, inner0.y, zBack);
        const f = point(inner1.x, inner1.y, zBack);
        const g = point(outer1.x, outer1.y, zBack);
        const h = point(outer0.x, outer0.y, zBack);
        mesh.quad(a, b, c, d, shade(tint, 1.02));
        mesh.quad(h, g, f, e, shade(tint, 0.60));
        mesh.quad(d, c, g, h, shade(tint, 0.83));
        mesh.quad(e, f, b, a, shade(tint, 0.68));
    }
}

function addLineSlab(mesh, x0, z0, x1, z1, width, y, tint) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.sqrt(dx * dx + dz * dz) || 1.0;
    const px = -dz / length * width * 0.5;
    const pz = dx / length * width * 0.5;
    mesh.quad(
        point(x0 + px, y, z0 + pz), point(x1 + px, y, z1 + pz),
        point(x1 - px, y, z1 - pz), point(x0 - px, y, z0 - pz), tint
    );
}

function baseWalkable(x, z) {
    const arena = (x * x) / (15.1 * 15.1) + ((z + 3.0) * (z + 3.0)) / (14.2 * 14.2) <= 1.0;
    const northHall = z >= -28.2 && z <= -10.0 && Math.abs(x) <= 5.3 + (z + 28.2) * 0.12;
    const southHall = z >= 6.0 && z <= 25.2 && Math.abs(x) <= 5.7 - Math.max(0.0, z - 18.0) * 0.10;
    return arena || northHall || southHall;
}

function floorHeight(x, z) {
    return Math.sin(x * 1.91 + z * 0.43) * 0.035 + Math.sin(z * 1.37 - x * 0.22) * 0.025;
}

function floorCellExists(ix, iz, cellSize) {
    return baseWalkable(ix * cellSize + cellSize * 0.5, iz * cellSize + cellSize * 0.5);
}

function buildFloor(mesh) {
    const size = 2.0;
    for (let iz = -16; iz <= 13; iz++) {
        for (let ix = -9; ix <= 8; ix++) {
            if (!floorCellExists(ix, iz, size)) continue;
            const x0 = ix * size;
            const x1 = x0 + size;
            const z0 = iz * size;
            const z1 = z0 + size;
            const p00 = point(x0, floorHeight(x0, z0), z0);
            const p10 = point(x1, floorHeight(x1, z0), z0);
            const p11 = point(x1, floorHeight(x1, z1), z1);
            const p01 = point(x0, floorHeight(x0, z1), z1);
            const variation = ((ix * 17 + iz * 29) & 3) * 0.035;
            const tileTint = shade(PALETTE.floor, 0.92 + variation);
            if (((ix + iz) & 1) === 0) {
                mesh.triangle(p00, p01, p11, tileTint);
                mesh.triangle(p00, p11, p10, shade(tileTint, 1.05));
            } else {
                mesh.triangle(p00, p01, p10, shade(tileTint, 1.04));
                mesh.triangle(p10, p01, p11, tileTint);
            }

            const bottom = -11.0 - ((Math.abs(ix * 3 + iz * 5)) % 4);
            if (!floorCellExists(ix - 1, iz, size)) {
                mesh.quad(point(x0, bottom, z1), point(x0, bottom, z0), p00, p01, PALETTE.cliff);
            }
            if (!floorCellExists(ix + 1, iz, size)) {
                mesh.quad(point(x1, bottom, z0), point(x1, bottom, z1), p11, p10, shade(PALETTE.cliff, 0.82));
            }
            if (!floorCellExists(ix, iz - 1, size)) {
                mesh.quad(point(x0, bottom, z0), point(x1, bottom, z0), p10, p00, shade(PALETTE.cliff, 0.72));
            }
            if (!floorCellExists(ix, iz + 1, size)) {
                mesh.quad(point(x1, bottom, z1), point(x0, bottom, z1), p01, p11, shade(PALETTE.cliff, 0.95));
            }
        }
    }

    const cracks = [
        [-4.5, 18.0, -1.7, 15.0], [-1.7, 15.0, -2.7, 12.2], [-2.7, 12.2, 0.2, 10.5],
        [5.5, 8.0, 2.0, 5.8], [2.0, 5.8, 3.7, 2.7], [3.7, 2.7, 1.2, 0.0],
        [-8.0, 1.2, -4.2, -0.6], [-4.2, -0.6, -5.8, -4.0], [-5.8, -4.0, -2.0, -6.8],
        [7.4, -7.0, 4.0, -9.0], [4.0, -9.0, 5.2, -12.5],
        [-1.0, -14.0, 0.7, -17.2], [0.7, -17.2, -0.4, -20.6]
    ];
    for (let i = 0; i < cracks.length; i++) {
        const crack = cracks[i];
        addLineSlab(mesh, crack[0], crack[1], crack[2], crack[3], 0.09, 0.07, PALETTE.crack);
    }
}

function addPillar(mesh, x, z, height, scale, broken) {
    const stone = PALETTE.stone;
    addBox(mesh, x, -0.05, z, 2.7 * scale, 0.55 * scale, 2.7 * scale, shade(stone, 0.73));
    addBox(mesh, x, 0.50 * scale, z, 2.15 * scale, 0.45 * scale, 2.15 * scale, shade(stone, 1.02));
    addCylinder(mesh, x, 0.95 * scale, z, 0.72 * scale, Math.max(1.0, height - 1.75 * scale), 6, stone);
    addBox(mesh, x, height - 0.8 * scale, z, 1.85 * scale, 0.38 * scale, 1.85 * scale, shade(stone, 0.92));
    if (!broken) {
        addBox(mesh, x, height - 0.42 * scale, z, 2.35 * scale, 0.42 * scale, 2.35 * scale, shade(stone, 1.08));
        addSpire(mesh, x, height, z, 0.75 * scale, 1.9 * scale, 5, PALETTE.iceDark, 0.08, -0.05);
    } else {
        addSpire(mesh, x + 0.18, height - 0.42 * scale, z - 0.08, 0.48 * scale, 0.7 * scale, 5, shade(stone, 0.65), 0.25, -0.1);
    }
}

function addBrazier(mesh, x, z, cyan) {
    const flame = cyan ? PALETTE.cyan : PALETTE.fire;
    const soft = cyan ? PALETTE.cyanSoft : PALETTE.fireSoft;
    addDisc(mesh, x, 0.08, z, cyan ? 3.1 : 2.2, 12, shade(soft, 1.35), shade(PALETTE.floor, 0.94));
    addBox(mesh, x, 0.0, z, 1.35, 0.40, 1.35, PALETTE.stoneDark);
    addCylinder(mesh, x, 0.4, z, 0.48, 1.25, 6, PALETTE.stone);
    addFrustum(mesh, x, 1.65, z, 0.95, 0.62, 0.48, 8, shade(PALETTE.stone, 0.75));
    addSpire(mesh, x, 2.03, z, 0.46, cyan ? 1.45 : 1.05, 7, flame, 0.10, -0.06);
    addSpire(mesh, x - 0.23, 2.0, z + 0.06, 0.24, 0.76, 5, shade(flame, 1.18), -0.08, 0.05);
}

function addGate(mesh) {
    const z = -30.2;
    addBox(mesh, 0.0, -0.3, z - 0.45, 8.2, 10.5, 0.55, color(0.018, 0.03, 0.05));
    addBox(mesh, -4.55, 0.0, z, 3.1, 7.2, 3.0, PALETTE.stoneDark);
    addBox(mesh, 4.55, 0.0, z, 3.1, 7.2, 3.0, PALETTE.stoneDark);
    addBox(mesh, -4.55, 0.5, z + 0.25, 2.35, 7.4, 2.35, PALETTE.stone);
    addBox(mesh, 4.55, 0.5, z + 0.25, 2.35, 7.4, 2.35, PALETTE.stone);
    addBox(mesh, -4.55, 7.9, z + 0.25, 3.0, 0.72, 3.0, shade(PALETTE.stone, 1.03));
    addBox(mesh, 4.55, 7.9, z + 0.25, 3.0, 0.72, 3.0, shade(PALETTE.stone, 1.03));
    addArch(mesh, 0.0, 7.1, z + 0.25, 3.35, 5.25, 2.35, 9, PALETTE.stone);
    addBox(mesh, 0.0, 11.3, z, 12.0, 1.0, 3.4, shade(PALETTE.stoneDark, 1.15));
    addSpire(mesh, -5.7, 8.6, z, 1.0, 4.2, 5, PALETTE.stoneDark, -0.3, 0.0);
    addSpire(mesh, 5.7, 8.6, z, 1.0, 4.2, 5, PALETTE.stoneDark, 0.3, 0.0);
    addSpire(mesh, -2.1, 12.2, z, 0.65, 2.4, 5, PALETTE.iceDark, -0.2, 0.0);
    addSpire(mesh, 2.1, 12.2, z, 0.65, 2.4, 5, PALETTE.iceDark, 0.2, 0.0);
    addBrazier(mesh, -3.55, -27.1, false);
    addBrazier(mesh, 3.55, -27.1, false);
}

function addScenicPlatforms(mesh) {
    addBox(mesh, -20.0, -1.4, 8.5, 8.0, 1.4, 13.0, shade(PALETTE.floor, 0.78));
    addBox(mesh, 20.5, -1.8, -1.5, 7.5, 1.8, 15.0, shade(PALETTE.floor, 0.73));
    addRotatedBox(mesh, -14.6, -0.72, 11.2, 7.8, 0.72, 2.0, -0.16, shade(PALETTE.stone, 0.88));
    addRotatedBox(mesh, 15.2, -0.9, 2.0, 7.2, 0.9, 1.8, 0.20, shade(PALETTE.stone, 0.78));
    addPillar(mesh, -21.7, 5.2, 7.2, 1.0, false);
    addPillar(mesh, -18.0, 12.5, 5.5, 0.9, true);
    addPillar(mesh, 19.0, -6.2, 8.4, 1.05, false);
    addPillar(mesh, 22.0, 4.5, 6.0, 0.9, true);
    addBrazier(mesh, -20.2, 8.4, true);
}

function addChain(mesh, x0, y0, z0, x1, y1, z1, links) {
    for (let i = 0; i < links; i++) {
        const t = (i + 0.5) / links;
        const sag = Math.sin(Math.PI * t) * 1.2;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t - sag;
        const z = z0 + (z1 - z0) * t;
        const yaw = Math.atan2(x1 - x0, z1 - z0) + (i & 1 ? Math.PI * 0.5 : 0.0);
        addRotatedBox(mesh, x, y, z, 0.18, 0.24, 0.62, yaw, PALETTE.chain);
    }
}

function addMountains(mesh) {
    for (let i = 0; i < 15; i++) {
        const z = -34.0 + i * 4.8;
        const wobble = Math.sin(i * 2.71) * 2.3;
        const heightL = 13.0 + (i * 7 % 13);
        const heightR = 15.0 + (i * 5 % 15);
        addSpire(mesh, -22.0 + wobble, -5.0, z, 5.0 + (i % 3), heightL, 6, shade(PALETTE.iceDark, 0.72 + (i % 2) * 0.12), 1.1, -0.4);
        addSpire(mesh, 23.0 - wobble * 0.5, -5.5, z + 1.4, 5.5 + ((i + 1) % 3), heightR, 6, shade(PALETTE.iceDark, 0.68 + (i % 3) * 0.08), -1.0, 0.3);
    }
    for (let i = 0; i < 11; i++) {
        const x = -28.0 + i * 5.6;
        const height = 18.0 + (i * 9 % 17);
        addSpire(mesh, x, -5.0, -43.0 + Math.sin(i) * 2.0, 6.0, height, 6, shade(PALETTE.iceDark, 0.62 + (i % 4) * 0.08), Math.sin(i * 1.8), 0.4);
    }
}

function addOuterBasin(mesh) {
    // A lower, non-playable ice shelf closes the visual gap between the arena
    // and the mountain ring. It is tiled so the atlas does not stretch.
    const tile = 8.0;
    for (let z = -48.0; z < 40.0; z += tile) {
        for (let x = -36.0; x < 36.0; x += tile) {
            const y = -0.48 + Math.sin(x * 0.31 + z * 0.17) * 0.025;
            const variation = 0.50 + (((Math.abs(x) + Math.abs(z)) / tile) % 3) * 0.045;
            mesh.quad(
                point(x, y, z), point(x, y, z + tile),
                point(x + tile, y, z + tile), point(x + tile, y, z),
                shade(PALETTE.floor, variation)
            );
        }
    }

    // Opaque blue curtains sit behind the peaks and read as dense distance fog.
    const fogDark = color(0.035, 0.075, 0.12);
    const fogBlue = color(0.07, 0.14, 0.20);
    mesh.quad(point(-42.0, -7.0, -51.0), point(42.0, -7.0, -51.0), point(42.0, 27.0, -51.0), point(-42.0, 27.0, -51.0), fogBlue);
    mesh.quad(point(-42.0, -7.0, 43.0), point(-42.0, 27.0, 43.0), point(42.0, 27.0, 43.0), point(42.0, -7.0, 43.0), fogDark);
    mesh.quad(point(-38.0, -7.0, 43.0), point(-38.0, -7.0, -51.0), point(-38.0, 27.0, -51.0), point(-38.0, 27.0, 43.0), fogDark);
    mesh.quad(point(38.0, -7.0, -51.0), point(38.0, -7.0, 43.0), point(38.0, 27.0, 43.0), point(38.0, 27.0, -51.0), fogBlue);
}

function buildScene() {
    const mesh = new Geometry();
    addOuterBasin(mesh);
    buildFloor(mesh);
    addScenicPlatforms(mesh);
    addMountains(mesh);
    addGate(mesh);

    const pillars = [
        [-12.5, -10.0, 7.5, 1.0, false], [12.2, -9.0, 6.2, 0.9, true],
        [-13.8, 2.5, 5.6, 0.88, true], [13.7, 3.6, 8.2, 1.0, false],
        [-9.0, 11.2, 6.0, 0.9, false], [9.5, 10.0, 5.0, 0.85, true],
        [-5.7, 21.5, 5.7, 0.82, true], [5.7, 21.0, 6.8, 0.9, false]
    ];
    for (let i = 0; i < pillars.length; i++) {
        const p = pillars[i];
        addPillar(mesh, p[0], p[1], p[2], p[3], p[4]);
    }

    addBrazier(mesh, -4.55, 17.4, true);
    addBrazier(mesh, 4.55, 15.0, true);
    addBrazier(mesh, -11.4, -5.0, false);

    addSpire(mesh, -2.8, 0.0, -1.5, 1.25, 4.8, 6, PALETTE.ice, 0.25, -0.2);
    addSpire(mesh, 3.5, 0.0, -5.0, 1.05, 3.7, 6, shade(PALETTE.ice, 0.88), -0.2, 0.2);
    addSpire(mesh, 1.0, 0.0, 5.0, 0.72, 2.8, 5, shade(PALETTE.ice, 0.72), 0.15, -0.1);
    addSpire(mesh, -8.2, 0.0, 5.2, 0.65, 2.2, 5, PALETTE.iceDark, -0.1, 0.0);
    addSpire(mesh, 8.0, 0.0, -0.3, 0.58, 2.0, 5, PALETTE.iceDark, 0.1, 0.0);

    addChain(mesh, -12.4, 4.0, -10.0, -18.2, 4.0, -8.0, 12);
    addChain(mesh, 13.7, 4.8, 3.6, 20.5, 4.0, 2.7, 13);
    addChain(mesh, -5.7, 4.0, 21.0, 5.7, 4.4, 21.0, 18);

    return mesh;
}

function toRenderData(mesh, startVertex, endVertex) {
    const first = (startVertex || 0) * 4;
    const last = (endVertex === undefined ? mesh.positions.length / 4 : endVertex) * 4;
    const vertices = Render.vertexList(
        new Float32Array(mesh.positions.slice(first, last)),
        new Float32Array(mesh.normals.slice(first, last)),
        new Float32Array(mesh.texcoords.slice(first, last)),
        new Float32Array(mesh.colors.slice(first, last)),
        undefined,
        undefined
    );
    const data = new RenderData(vertices);
    data.pipeline = Render.PL_NO_LIGHTS;
    data.texture_mapping = false;
    data.face_culling = Render.CULL_FACE_NONE;
    data.shade_model = Render.SHADE_GOURAUD;
    return data;
}

function toRenderObjects(mesh, maximumVertices) {
    const objects = [];
    const totalVertices = mesh.positions.length / 4;
    const chunkSize = Math.floor(maximumVertices / 3) * 3;
    for (let first = 0; first < totalVertices; first += chunkSize) {
        const last = Math.min(totalVertices, first + chunkSize);
        objects.push(new RenderObject(toRenderData(mesh, first, last)));
    }
    return objects;
}

const sceneMesh = buildScene();
console.log("[VeuAzul] Malha criada: " + (sceneMesh.positions.length / 4) + " vertices");
const sceneObjects = toRenderObjects(sceneMesh, 1800);
console.log("[VeuAzul] Cenario dividido em " + sceneObjects.length + " blocos");

const playerMesh = new Geometry();
addBox(playerMesh, 0.0, 0.0, 0.0, 1.35, 2.25, 1.35, PALETTE.playerSide);
addBox(playerMesh, 0.0, 1.78, -0.69, 0.78, 0.34, 0.08, PALETTE.player);
const playerData = toRenderData(playerMesh);
const playerObject = new RenderObject(playerData);
console.log("[VeuAzul] Jogador e colisoes prontos");

const collisionCircles = [
    { x: -2.8, z: -1.5, radius: 1.52 },
    { x: 3.5, z: -5.0, radius: 1.32 },
    { x: 1.0, z: 5.0, radius: 1.0 },
    { x: -8.2, z: 5.2, radius: 0.92 },
    { x: 8.0, z: -0.3, radius: 0.86 },
    { x: -4.55, z: 17.4, radius: 1.1 },
    { x: 4.55, z: 15.0, radius: 1.1 }
];

const cameraBlockers = collisionCircles.concat([
    { x: -12.5, z: -10.0, radius: 1.5 }, { x: 12.2, z: -9.0, radius: 1.5 },
    { x: -13.8, z: 2.5, radius: 1.4 }, { x: 13.7, z: 3.6, radius: 1.5 },
    { x: -9.0, z: 11.2, radius: 1.4 }, { x: 9.5, z: 10.0, radius: 1.4 }
]);

const PLAYER_RADIUS = 0.68;
const SPAWN = { x: 0.0, z: 20.0 };
let playerX = SPAWN.x;
let playerZ = SPAWN.z;
let playerYaw = 0.0;
let cameraYaw = 0.0;
let cameraPitch = 0.31;
let shoulderSide = 1.0;
let showHud = true;
let titleTimer = 330;
let collisionFlash = 0;

function isPlayerValid(x, z) {
    if (!baseWalkable(x, z)) return false;
    for (let sample = 0; sample < 12; sample++) {
        const angle = Math.PI * 2.0 * sample / 12.0;
        const sx = x + Math.cos(angle) * PLAYER_RADIUS;
        const sz = z + Math.sin(angle) * PLAYER_RADIUS;
        if (!baseWalkable(sx, sz)) return false;
    }
    for (let i = 0; i < collisionCircles.length; i++) {
        const obstacle = collisionCircles[i];
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        const minimum = PLAYER_RADIUS + obstacle.radius;
        if (dx * dx + dz * dz < minimum * minimum) return false;
    }
    return true;
}

function movePlayer(dx, dz) {
    let moved = false;
    if (isPlayerValid(playerX + dx, playerZ)) {
        playerX += dx;
        moved = true;
    } else if (Math.abs(dx) > 0.0001) {
        collisionFlash = 5;
    }
    if (isPlayerValid(playerX, playerZ + dz)) {
        playerZ += dz;
        moved = true;
    } else if (Math.abs(dz) > 0.0001) {
        collisionFlash = 5;
    }
    return moved;
}

function cameraBlocked(x, z) {
    for (let i = 0; i < cameraBlockers.length; i++) {
        const blocker = cameraBlockers[i];
        const dx = x - blocker.x;
        const dz = z - blocker.z;
        const limit = blocker.radius + 0.35;
        if (dx * dx + dz * dz < limit * limit) return true;
    }
    return false;
}

function deadZone(value) {
    return Math.abs(value) > 24 ? value / 128.0 : 0.0;
}

const pad = Pads.get(0);

function updatePlayerAndCamera() {
    pad.update();

    if (pad.justPressed(Pads.SELECT)) {
        playerX = SPAWN.x;
        playerZ = SPAWN.z;
        playerYaw = 0.0;
        cameraYaw = 0.0;
    }
    if (pad.justPressed(Pads.START)) showHud = !showHud;
    if (pad.justPressed(Pads.L1)) shoulderSide *= -1.0;
    if (pad.justPressed(Pads.R3)) cameraYaw = playerYaw;

    const lookX = deadZone(pad.rx);
    const lookY = deadZone(pad.ry);
    cameraYaw += lookX * 0.032;
    cameraPitch = clamp(cameraPitch + lookY * 0.015, 0.05, 0.62);

    let strafe = deadZone(pad.lx);
    let forwardInput = -deadZone(pad.ly);
    const inputLength = Math.sqrt(strafe * strafe + forwardInput * forwardInput);
    if (inputLength > 1.0) {
        strafe /= inputLength;
        forwardInput /= inputLength;
    }

    const forwardX = Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = Math.sin(cameraYaw);
    const speed = pad.pressed(Pads.CROSS) ? 0.19 : 0.125;
    const dx = (forwardX * forwardInput + rightX * strafe) * speed;
    const dz = (forwardZ * forwardInput + rightZ * strafe) * speed;

    if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        if (movePlayer(dx, dz)) playerYaw = Math.atan2(dx, -dz);
    }

    playerObject.position = { x: playerX, y: 0.08, z: playerZ };
    playerObject.rotation = { x: 0.0, y: playerYaw, z: 0.0 };

    const shoulder = 1.65 * shoulderSide;
    const distance = 6.5;
    const targetX = playerX + forwardX * 1.65 + rightX * shoulder * 0.18;
    const targetY = 1.35 + cameraPitch * 1.4;
    const targetZ = playerZ + forwardZ * 1.65 + rightZ * shoulder * 0.18;
    const desiredX = playerX - forwardX * distance + rightX * shoulder;
    const desiredY = 2.8 + cameraPitch * 5.0;
    const desiredZ = playerZ - forwardZ * distance + rightZ * shoulder;

    let cameraFactor = 1.0;
    for (let step = 2; step <= 10; step++) {
        const factor = step / 10.0;
        const sampleX = targetX + (desiredX - targetX) * factor;
        const sampleZ = targetZ + (desiredZ - targetZ) * factor;
        if (cameraBlocked(sampleX, sampleZ)) {
            cameraFactor = Math.max(0.2, factor - 0.12);
            break;
        }
    }

    Camera.position(
        targetX + (desiredX - targetX) * cameraFactor,
        targetY + (desiredY - targetY) * cameraFactor,
        targetZ + (desiredZ - targetZ) * cameraFactor
    );
    Camera.target(targetX, targetY, targetZ);
    Camera.update();
}

const snow = [];
for (let i = 0; i < 30; i++) {
    snow.push({
        x: (i * 97 + 31) % canvas.width,
        y: (i * 53 + 17) % canvas.height,
        speed: 0.18 + (i % 5) * 0.07
    });
}

function drawAtmosphere() {
    for (let i = 0; i < snow.length; i++) {
        const flake = snow[i];
        flake.y += flake.speed;
        flake.x += 0.08 + (i % 3) * 0.03;
        if (flake.y > canvas.height) flake.y = 0.0;
        if (flake.x > canvas.width) flake.x = 0.0;
        Draw.point(flake.x, flake.y, Color.new(110, 177, 220, 42 + (i % 3) * 18));
    }
}

function drawHud() {
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, false);
    drawAtmosphere();

    if (titleTimer > 0) {
        const titleAlpha = clamp(titleTimer, 0, 128);
        font.color = Color.new(118, 210, 246, titleAlpha);
        font.scale = 0.70;
        font.print(18, 18, "RUINAS DO VEU AZUL");
        font.scale = 0.42;
        font.color = Color.new(191, 218, 232, titleAlpha);
        font.print(20, 39, "CAMARA DOS VIGIAS CONGELADOS");
        titleTimer--;
    }

    if (showHud) {
        font.scale = 0.40;
        font.color = HUD_WHITE;
        font.print(14, canvas.height - 35, "ANALOGICO E: MOVER  |  X: CORRER  |  ANALOGICO D: CAMERA");
        font.color = HUD_BLUE;
        font.print(14, canvas.height - 19, "L1: TROCAR OMBRO  |  R3: CENTRALIZAR  |  SELECT: REINICIAR");
    }

    if (collisionFlash > 0) {
        font.scale = 0.42;
        font.color = Color.new(118, 204, 240, 128);
        font.print(canvas.width - 156, 16, "LIMITE DA AREA");
        collisionFlash--;
    }

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

while (true) {
    updatePlayerAndCamera();
    Screen.clear(CLEAR_COLOR);
    Render.begin();
    for (let i = 0; i < sceneObjects.length; i++) sceneObjects[i].render();
    playerObject.render();
    drawHud();
    Screen.flip();
}
