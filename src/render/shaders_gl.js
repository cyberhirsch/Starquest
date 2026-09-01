// GLSL ES 3.00 twins of the WGSL shaders, for the WebGL2 fallback path.
// Kept deliberately line-for-line comparable with shaders.js.

export const LINE_VS = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
uniform vec4 uRes;            // w, h, 1/w, 1/h
in vec4 aA;                   // xyz + mode (0 = world, 1 = screen px)
in vec4 aB;                   // xyz + thickness px
in vec4 aCol;                 // rgb + alpha
in vec4 aExt;                 // glow
out vec2 vLocal;
out vec2 vSeg;
out vec4 vColor;
out float vGlow;

void main() {
  vec2 sa, sb;
  float vis = 1.0;
  if (aA.w > 0.5) {
    sa = aA.xy;
    sb = aB.xy;
  } else {
    vec4 pa = uViewProj * vec4(aA.xyz, 1.0);
    vec4 pb = uViewProj * vec4(aB.xyz, 1.0);
    float eps = 0.05;
    if (pa.w < eps && pb.w < eps) {
      vis = 0.0;
      pa = vec4(0.0, 0.0, 0.0, 1.0);
      pb = vec4(0.0, 0.0, 0.0, 1.0);
    } else if (pa.w < eps) {
      pa = mix(pa, pb, (eps - pa.w) / (pb.w - pa.w));
    } else if (pb.w < eps) {
      pb = mix(pb, pa, (eps - pb.w) / (pa.w - pb.w));
    }
    vec2 na = pa.xy / pa.w;
    vec2 nb = pb.xy / pb.w;
    sa = (vec2(na.x, -na.y) * 0.5 + 0.5) * uRes.xy;
    sb = (vec2(nb.x, -nb.y) * 0.5 + 0.5) * uRes.xy;
  }

  vec2 mid = (sa + sb) * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  d = len < 1e-4 ? vec2(1.0, 0.0) : d / len;
  vec2 n = vec2(-d.y, d.x);

  float halfT = max(aB.w, 0.7) * 0.5;
  float pad = halfT + 2.5;
  float halfL = len * 0.5;

  float cx = (gl_VertexID == 1 || gl_VertexID == 3) ? 1.0 : -1.0;
  float cy = gl_VertexID >= 2 ? 1.0 : -1.0;
  vec2 p = mid + d * (cy * (halfL + pad)) + n * (cx * pad);

  vec2 ndc = (p * uRes.zw) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  vLocal = vec2(cy * (halfL + pad), cx * pad);
  vSeg = vec2(halfL, halfT);
  vColor = vec4(aCol.rgb, aCol.a * vis);
  vGlow = aExt.x;
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vSeg;
in vec4 vColor;
in float vGlow;
out vec4 fragColor;

void main() {
  float dist = length(vec2(max(abs(vLocal.x) - vSeg.x, 0.0), vLocal.y));
  float r = dist / max(vSeg.y, 0.35);
  float core = exp(-r * r * 2.2);
  float halo = exp(-r * 1.35) * 0.30;
  float a = vColor.a;
  vec3 c = vColor.rgb * (core + halo) * vGlow * a;
  c += vec3(1.0) * pow(core, 3.0) * 0.55 * a * vGlow;
  fragColor = vec4(c, 1.0);
}`;

export const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 2 ? 3.0 : -1.0, gl_VertexID == 0 ? -3.0 : 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
  vUv = p * 0.5 + 0.5;      // GL texture origin is bottom-left, so no flip
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * k, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uScale;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 step = uTexel * uDir * uScale;
  vec3 sum = texture(uSrc, vUv).rgb * 0.227027;
  float w[4];
  w[0] = 0.1945946; w[1] = 0.1216216; w[2] = 0.054054; w[3] = 0.016216;
  float o[4];
  o[0] = 1.3846153; o[1] = 3.2307692; o[2] = 5.1153846; o[3] = 7.0;
  for (int i = 0; i < 4; i++) {
    sum += texture(uSrc, vUv + step * o[i]).rgb * w[i];
    sum += texture(uSrc, vUv - step * o[i]).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform vec2 uTexel;
uniform float uTime;
uniform float uB1;
uniform float uB2;
uniform float uCrt;
in vec2 vUv;
out vec4 fragColor;

vec2 barrel(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  return (c * (1.0 + k * dot(c, c))) * 0.5 + 0.5;
}

void main() {
  vec2 uv = barrel(vUv, 0.045 * uCrt);
  vec2 ca = (uv - vec2(0.5)) * 0.0026 * uCrt;   // radial, none at centre

  vec3 c;
  c.r = texture(uScene, uv + ca).r;
  c.g = texture(uScene, uv).g;
  c.b = texture(uScene, uv - ca).b;

  c += texture(uBloom1, uv).rgb * uB1;
  c += texture(uBloom2, uv).rgb * uB2;

  c = vec3(1.0) - exp(-c * 1.25);
  c = pow(max(c, vec3(0.0)), vec3(0.85));

  float py = uv.y / max(uTexel.y, 1e-6);
  float scan = 0.86 + 0.14 * sin(py * 3.14159);
  float px = uv.x / max(uTexel.x, 1e-6);
  float grille = 0.94 + 0.06 * sin(px * 2.0944);
  c *= mix(1.0, scan * grille, uCrt);

  float d = distance(uv, vec2(0.5));
  c *= mix(1.0, smoothstep(0.95, 0.35, d), 0.55 * uCrt);
  c += vec3(0.012, 0.030, 0.028) * (1.0 - d);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) c = vec3(0.0);

  float n = fract(sin(dot(uv * uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.020 * uCrt;

  fragColor = vec4(c, 1.0);
}`;
