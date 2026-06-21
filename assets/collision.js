// Shared collision contract for AthenaEnv. Collider scale matches the editor:
// box = half extents, sphere = ellipsoid radii, capsule = radii plus a local-Z segment.
(function () {
    const EPSILON = 0.0001;

    function finite(value, fallback) {
        return typeof value === "number" && isFinite(value) ? value : fallback;
    }

    function absoluteSize(value) {
        return Math.max(EPSILON, Math.abs(finite(value, 1.0)));
    }

    function quaternionFromEuler(rotation) {
        const hx = finite(rotation && rotation.x, 0.0) * 0.5;
        const hy = finite(rotation && rotation.y, 0.0) * 0.5;
        const hz = finite(rotation && rotation.z, 0.0) * 0.5;
        const c1 = Math.cos(hx);
        const c2 = Math.cos(hy);
        const c3 = Math.cos(hz);
        const s1 = Math.sin(hx);
        const s2 = Math.sin(hy);
        const s3 = Math.sin(hz);
        return {
            x: s1 * c2 * c3 + c1 * s2 * s3,
            y: c1 * s2 * c3 - s1 * c2 * s3,
            z: c1 * c2 * s3 + s1 * s2 * c3,
            w: c1 * c2 * c3 - s1 * s2 * s3
        };
    }

    function normalize(collider, index) {
        const source = collider || {};
        const position = source.position || {};
        const rotation = source.rotation || {};
        const scale = source.scale || {};
        const quaternion = quaternionFromEuler(rotation);
        return {
            id: String(source.id || source.name || ("collider-" + index)),
            name: String(source.name || source.id || ("Collider " + index)),
            shape: source.shape === "sphere" || source.shape === "capsule" ? source.shape : "box",
            position: {
                x: finite(position.x, 0.0),
                y: finite(position.y, 0.0),
                z: finite(position.z, 0.0)
            },
            rotation: {
                x: finite(rotation.x, 0.0),
                y: finite(rotation.y, 0.0),
                z: finite(rotation.z, 0.0)
            },
            scale: {
                x: absoluteSize(scale.x),
                y: absoluteSize(scale.y),
                z: absoluteSize(scale.z)
            },
            trigger: source.trigger === true,
            cameraBlocker: source.cameraBlocker !== false,
            qx: quaternion.x,
            qy: quaternion.y,
            qz: quaternion.z,
            qw: quaternion.w
        };
    }

    function normalizeAll(colliders) {
        const output = [];
        for (let i = 0; i < (colliders || []).length; i++) output.push(normalize(colliders[i], i));
        return output;
    }

    function inverseRotate(x, y, z, collider) {
        // Rotate by the conjugate of the collider quaternion.
        const qx = -collider.qx;
        const qy = -collider.qy;
        const qz = -collider.qz;
        const qw = collider.qw;
        const tx = 2.0 * (qy * z - qz * y);
        const ty = 2.0 * (qz * x - qx * z);
        const tz = 2.0 * (qx * y - qy * x);
        return {
            x: x + qw * tx + (qy * tz - qz * ty),
            y: y + qw * ty + (qz * tx - qx * tz),
            z: z + qw * tz + (qx * ty - qy * tx)
        };
    }

    function sphereHits(collider, x, y, z, radius) {
        const translatedX = x - collider.position.x;
        const translatedY = y - collider.position.y;
        const translatedZ = z - collider.position.z;
        const local = inverseRotate(translatedX, translatedY, translatedZ, collider);
        const r = Math.max(0.0, finite(radius, 0.0));

        if (collider.shape === "box") {
            const closestX = Math.max(-collider.scale.x, Math.min(collider.scale.x, local.x));
            const closestY = Math.max(-collider.scale.y, Math.min(collider.scale.y, local.y));
            const closestZ = Math.max(-collider.scale.z, Math.min(collider.scale.z, local.z));
            const dx = local.x - closestX;
            const dy = local.y - closestY;
            const dz = local.z - closestZ;
            return dx * dx + dy * dy + dz * dz <= r * r;
        }

        if (collider.shape === "capsule") {
            // The editor capsule has a unit-radius body from local Z -1 to +1.
            // Non-uniform scale therefore creates elliptical caps and a scaled segment.
            const segmentZ = Math.max(-collider.scale.z, Math.min(collider.scale.z, local.z));
            const dx = local.x / (collider.scale.x + r);
            const dy = local.y / (collider.scale.y + r);
            const dz = (local.z - segmentZ) / (collider.scale.z + r);
            return dx * dx + dy * dy + dz * dz <= 1.0;
        }

        // Expanded ellipsoid approximation. It is exact for uniformly scaled spheres
        // and follows the non-uniform sphere shown by the editor.
        const nx = local.x / (collider.scale.x + r);
        const ny = local.y / (collider.scale.y + r);
        const nz = local.z / (collider.scale.z + r);
        return nx * nx + ny * ny + nz * nz <= 1.0;
    }

    function playerContacts(colliders, x, bottomY, z, radius, height, triggersOnly) {
        const output = [];
        const lower = bottomY + radius;
        const upper = bottomY + Math.max(radius, height - radius);
        const sampleCount = upper - lower > radius * 0.5 ? 3 : 1;

        for (let i = 0; i < colliders.length; i++) {
            const collider = colliders[i];
            if (triggersOnly ? !collider.trigger : collider.trigger) continue;
            let hit = false;
            for (let sample = 0; sample < sampleCount; sample++) {
                const t = sampleCount === 1 ? 0.5 : sample / (sampleCount - 1);
                const y = lower + (upper - lower) * t;
                if (sphereHits(collider, x, y, z, radius)) {
                    hit = true;
                    break;
                }
            }
            if (hit) output.push(collider);
        }
        return output;
    }

    function contactIds(contacts) {
        const ids = {};
        for (let i = 0; i < contacts.length; i++) ids[contacts[i].id] = true;
        return ids;
    }

    function transitionAllowed(currentContacts, nextContacts) {
        if (nextContacts.length === 0) return true;
        if (currentContacts.length === 0) return false;
        const currentIds = contactIds(currentContacts);
        for (let i = 0; i < nextContacts.length; i++) {
            if (!currentIds[nextContacts[i].id]) return false;
        }
        // A player already intersecting a collider may move until it escapes, but
        // cannot enter any additional collider. This prevents permanent trapping.
        return true;
    }

    function cameraBlocked(colliders, x, y, z, radius) {
        for (let i = 0; i < colliders.length; i++) {
            const collider = colliders[i];
            if (!collider.cameraBlocker || collider.trigger) continue;
            if (sphereHits(collider, x, y, z, radius)) return true;
        }
        return false;
    }

    globalThis.Collision3D = {
        normalize: normalize,
        normalizeAll: normalizeAll,
        sphereHits: sphereHits,
        playerContacts: playerContacts,
        transitionAllowed: transitionAllowed,
        cameraBlocked: cameraBlocked
    };
})();
