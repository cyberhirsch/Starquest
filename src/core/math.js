// Minimal math for the vector renderer. Vectors are plain [x,y,z] arrays,
// quaternions [x,y,z,w], matrices column-major Float32Array(16) (WGSL layout).

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
export const randi = (n) => (Math.random() * n) | 0;
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const smoothDamp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
export const approach = (cur, tgt, step) =>
  cur < tgt ? Math.min(cur + step, tgt) : Math.max(cur - step, tgt);

/* ---------------------------------------------------------------- vec3 --- */
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vset = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
export const vcopy = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
export const vadd = (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
export const vsub = (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
export const vscale = (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
export const vaddScaled = (o, a, b, s) => {
  o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o;
};
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vlen2 = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const vdist2 = (a, b) => {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
};
export const vcross = (o, a, b) => {
  const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
  o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx;
  return o;
};
export const vnorm = (o, a) => {
  const l = vlen(a);
  if (l < 1e-9) return vset(o, 0, 0, 0);
  return vscale(o, a, 1 / l);
};
export const vlerp = (o, a, b, t) => {
  o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); return o;
};
export const vrandSphere = (o, r = 1) => {
  let x, y, z, d;
  do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; d = x * x + y * y + z * z; }
  while (d > 1 || d < 1e-6);
  const s = r / Math.sqrt(d);
  return vset(o, x * s, y * s, z * s);
};

/* ---------------------------------------------------------------- quat --- */
export const qid = () => [0, 0, 0, 1];
export const qcopy = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; };

export const qmul = (o, a, b) => {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
};

export const qaxis = (o, axis, angle) => {
  const h = angle * 0.5, s = Math.sin(h);
  o[0] = axis[0] * s; o[1] = axis[1] * s; o[2] = axis[2] * s; o[3] = Math.cos(h);
  return o;
};

export const qnorm = (o) => {
  const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
  o[0] /= l; o[1] /= l; o[2] /= l; o[3] /= l; return o;
};

export const qconj = (o, a) => { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; };

/** Rotate vector a by quaternion q. */
export const qrot = (o, q, a) => {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = a[0], vy = a[1], vz = a[2];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  o[0] = vx + w * tx + (y * tz - z * ty);
  o[1] = vy + w * ty + (z * tx - x * tz);
  o[2] = vz + w * tz + (x * ty - y * tx);
  return o;
};

export const qslerp = (o, a, b, t) => {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0 = 1 - t, s1 = t;
  if (cos < 0.9995) {
    const omega = Math.acos(clamp(cos, -1, 1)), sin = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sin; s1 = Math.sin(t * omega) / sin;
  }
  o[0] = a[0] * s0 + bx * s1; o[1] = a[1] * s0 + by * s1;
  o[2] = a[2] * s0 + bz * s1; o[3] = a[3] * s0 + bw * s1;
  return qnorm(o);
};

/** Local axes of an orientation (engine convention: -Z is forward). */
const _ax = v3();
export const qforward = (o, q) => qrot(o, q, vset(_ax, 0, 0, -1));
export const qright = (o, q) => qrot(o, q, vset(_ax, 1, 0, 0));
export const qup = (o, q) => qrot(o, q, vset(_ax, 0, 1, 0));

/**
 * Orientation looking down `dir` with roll minimised against `up`.
 *
 * The two crosses have to be in this order. Written the other way round —
 * right = up x forward, up = forward x right — they build a mirrored,
 * left-handed basis, and the matrix below is then a reflection rather than a
 * rotation. The trace branch of the conversion silently returns the identity
 * for most of those, so qlook(q, dir) would quietly leave the hull pointing
 * down -Z whatever direction you asked for, and only look correct when you
 * happened to ask for -Z.
 */
const _f = v3(), _r = v3(), _u = v3();
export const qlook = (o, dir, up = [0, 1, 0]) => {
  vnorm(_f, dir);
  vcross(_r, _f, up);
  if (vlen2(_r) < 1e-8) { vcross(_r, _f, [0, 0, 1]); }
  vnorm(_r, _r);
  vcross(_u, _r, _f);
  // Build quaternion from basis (right, up, -forward => matrix columns)
  const m00 = _r[0], m01 = _u[0], m02 = -_f[0];
  const m10 = _r[1], m11 = _u[1], m12 = -_f[1];
  const m20 = _r[2], m21 = _u[2], m22 = -_f[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    o[3] = 0.25 * s; o[0] = (m21 - m12) / s; o[1] = (m02 - m20) / s; o[2] = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    o[3] = (m21 - m12) / s; o[0] = 0.25 * s; o[1] = (m01 + m10) / s; o[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    o[3] = (m02 - m20) / s; o[0] = (m01 + m10) / s; o[1] = 0.25 * s; o[2] = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    o[3] = (m10 - m01) / s; o[0] = (m02 + m20) / s; o[1] = (m12 + m21) / s; o[2] = 0.25 * s;
  }
  return qnorm(o);
};

/** Integrate an angular velocity (rad/s, local space) into orientation. */
const _dq = [0, 0, 0, 1];
export const qspin = (q, localAxis, angle) => {
  qaxis(_dq, localAxis, angle);
  qmul(q, q, _dq);
  return qnorm(q);
};

/* ---------------------------------------------------------------- mat4 --- */
export const m4 = () => new Float32Array(16);

export const m4perspective = (o, fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2);
  o.fill(0);
  o[0] = f / aspect; o[5] = f; o[11] = -1;
  o[10] = far / (near - far);          // WebGPU depth range [0,1]
  o[14] = (far * near) / (near - far);
  return o;
};

/** View matrix = inverse of the rigid transform (pos, quat). */
const _rr = v3(), _uu = v3(), _ff = v3();
export const m4view = (o, pos, quat) => {
  qright(_rr, quat); qup(_uu, quat); qforward(_ff, quat);
  const bx = -_ff[0], by = -_ff[1], bz = -_ff[2]; // camera looks down -Z
  o[0] = _rr[0]; o[4] = _rr[1]; o[8] = _rr[2]; o[12] = -vdot(_rr, pos);
  o[1] = _uu[0]; o[5] = _uu[1]; o[9] = _uu[2]; o[13] = -vdot(_uu, pos);
  o[2] = bx; o[6] = by; o[10] = bz; o[14] = -(bx * pos[0] + by * pos[1] + bz * pos[2]);
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  return o;
};

export const m4mul = (o, a, b) => {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
};

/** Project a world point to pixel coords. Returns null when behind the camera. */
export const project = (out, p, viewProj, w, h) => {
  const x = p[0], y = p[1], z = p[2];
  const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (cw <= 1e-4) return null;
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  out[0] = (cx / cw * 0.5 + 0.5) * w;
  out[1] = (0.5 - cy / cw * 0.5) * h;
  out[2] = cw;
  return out;
};

/** Intercept point for a projectile of speed `s` fired from `from` at a moving target. */
export const leadTarget = (out, from, tpos, tvel, s) => {
  const dx = tpos[0] - from[0], dy = tpos[1] - from[1], dz = tpos[2] - from[2];
  const a = vdot(tvel, tvel) - s * s;
  const b = 2 * (tvel[0] * dx + tvel[1] * dy + tvel[2] * dz);
  const c = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (Math.abs(a) < 1e-4) { t = c > 0 ? -c / (b || 1e-4) : 0; }
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      t = Math.min(t1 < 0 ? Infinity : t1, t2 < 0 ? Infinity : t2);
      if (!isFinite(t)) t = 0;
    }
  }
  t = clamp(t, 0, 6);
  out[0] = tpos[0] + tvel[0] * t; out[1] = tpos[1] + tvel[1] * t; out[2] = tpos[2] + tvel[2] * t;
  return out;
};

/** Closest approach of a ray to a sphere; returns hit distance or -1. */
export const raySphere = (org, dir, center, radius) => {
  const ox = org[0] - center[0], oy = org[1] - center[1], oz = org[2] - center[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq, t1 = -b + sq;
  if (t0 >= 0) return t0;
  if (t1 >= 0) return t1;
  return -1;
};
