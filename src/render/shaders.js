// WGSL sources. The whole game is drawn as glowing line segments: every edge is
// one instanced quad expanded in screen space, then bloomed and CRT-graded.

export const LINE_WGSL = /* wgsl */`
struct Cam {
  viewProj : mat4x4<f32>,
  res      : vec4<f32>,   // w, h, 1/w, 1/h
  params   : vec4<f32>,   // time, _, _, _
};
@group(0) @binding(0) var<uniform> cam : Cam;

struct VSOut {
  @builtin(position) pos   : vec4<f32>,
  @location(0) local       : vec2<f32>,  // px along / across the segment
  @location(1) seg         : vec2<f32>,  // half-length, half-thickness
  @location(2) color       : vec4<f32>,
  @location(3) glow        : f32,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32,
      @location(0) a   : vec4<f32>,   // xyz + mode (0 = world, 1 = screen px)
      @location(1) b   : vec4<f32>,   // xyz + thickness px
      @location(2) col : vec4<f32>,   // rgb + alpha
      @location(3) ext : vec4<f32>)   // glow, _, _, _
      -> VSOut {
  var sa : vec2<f32>;
  var sb : vec2<f32>;
  var vis : f32 = 1.0;

  if (a.w > 0.5) {
    sa = a.xy;
    sb = b.xy;
  } else {
    var pa = cam.viewProj * vec4<f32>(a.xyz, 1.0);
    var pb = cam.viewProj * vec4<f32>(b.xyz, 1.0);
    let eps = 0.05;
    if (pa.w < eps && pb.w < eps) {
      vis = 0.0;
      pa = vec4<f32>(0.0, 0.0, 0.0, 1.0);
      pb = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    } else if (pa.w < eps) {
      pa = mix(pa, pb, (eps - pa.w) / (pb.w - pa.w));
    } else if (pb.w < eps) {
      pb = mix(pb, pa, (eps - pb.w) / (pa.w - pb.w));
    }
    let na = pa.xy / pa.w;
    let nb = pb.xy / pb.w;
    sa = (vec2<f32>(na.x, -na.y) * 0.5 + 0.5) * cam.res.xy;
    sb = (vec2<f32>(nb.x, -nb.y) * 0.5 + 0.5) * cam.res.xy;
  }

  let mid = (sa + sb) * 0.5;
  var d = sb - sa;
  let len = length(d);
  if (len < 1e-4) { d = vec2<f32>(1.0, 0.0); } else { d = d / len; }
  let n = vec2<f32>(-d.y, d.x);

  let halfT = max(b.w, 0.7) * 0.5;
  let pad   = halfT + 2.5;                 // room for the glow falloff
  let halfL = len * 0.5;

  let cx = select(-1.0, 1.0, (vi & 1u) == 1u);
  let cy = select(-1.0, 1.0, vi >= 2u);
  let p  = mid + d * (cy * (halfL + pad)) + n * (cx * pad);

  var out : VSOut;
  let ndc = (p * cam.res.zw) * 2.0 - 1.0;
  out.pos   = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.local = vec2<f32>(cy * (halfL + pad), cx * pad);
  out.seg   = vec2<f32>(halfL, halfT);
  out.color = vec4<f32>(col.rgb, col.a * vis);
  out.glow  = ext.x;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let dist = length(vec2<f32>(max(abs(in.local.x) - in.seg.x, 0.0), in.local.y));
  let r    = dist / max(in.seg.y, 0.35);
  let core = exp(-r * r * 2.2);
  let halo = exp(-r * 1.35) * 0.30;
  let a    = in.color.a;
  var c    = in.color.rgb * (core + halo) * in.glow * a;
  c += vec3<f32>(1.0, 1.0, 1.0) * pow(core, 3.0) * 0.55 * a * in.glow;
  // never emit NaN or negatives into the HDR target — either would survive the
  // bloom chain and tone-map to a black block
  c = select(vec3<f32>(0.0), c, c == c);
  return vec4<f32>(max(c, vec3<f32>(0.0)), 1.0);
}
`;

/* -------------------------------------------------------- post-process --- */

const FULLSCREEN = /* wgsl */`
struct FSOut { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o : FSOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv  = vec2<f32>(p[vi].x * 0.5 + 0.5, 0.5 - p[vi].y * 0.5);
  return o;
}
`;

export const BRIGHT_WGSL = FULLSCREEN + /* wgsl */`
struct P { texel : vec4<f32>, args : vec4<f32> };
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src  : texture_2d<f32>;
@group(0) @binding(2) var<uniform> p : P;

@fragment
fn fs(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(src, samp, uv).rgb;
  let l = max(max(c.r, c.g), c.b);
  let k = max(l - p.args.x, 0.0) / max(l, 1e-4);
  return vec4<f32>(c * k, 1.0);
}
`;

export const BLUR_WGSL = FULLSCREEN + /* wgsl */`
struct P { texel : vec4<f32>, args : vec4<f32> };  // texel.xy = 1/size, args.xy = direction
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src  : texture_2d<f32>;
@group(0) @binding(2) var<uniform> p : P;

@fragment
fn fs(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let step = p.texel.xy * p.args.xy * p.args.z;
  var sum = textureSample(src, samp, uv).rgb * 0.227027;
  let w = array<f32, 4>(0.1945946, 0.1216216, 0.054054, 0.016216);
  let o = array<f32, 4>(1.3846153, 3.2307692, 5.1153846, 7.0);
  for (var i = 0u; i < 4u; i = i + 1u) {
    sum += textureSample(src, samp, uv + step * o[i]).rgb * w[i];
    sum += textureSample(src, samp, uv - step * o[i]).rgb * w[i];
  }
  return vec4<f32>(sum, 1.0);
}
`;

export const COMPOSITE_WGSL = FULLSCREEN + /* wgsl */`
struct P { texel : vec4<f32>, args : vec4<f32> };  // args = time, bloom1, bloom2, crt
@group(0) @binding(0) var samp   : sampler;
@group(0) @binding(1) var scene  : texture_2d<f32>;
@group(0) @binding(2) var bloom1 : texture_2d<f32>;
@group(0) @binding(3) var bloom2 : texture_2d<f32>;
@group(0) @binding(4) var<uniform> p : P;

fn barrel(uv : vec2<f32>, k : f32) -> vec2<f32> {
  let c = uv * 2.0 - 1.0;
  let r2 = dot(c, c);
  return (c * (1.0 + k * r2)) * 0.5 + 0.5;
}

@fragment
fn fs(@location(0) uv0 : vec2<f32>) -> @location(0) vec4<f32> {
  let crt = p.args.w;
  let uv  = barrel(uv0, 0.045 * crt);
  let ca  = (uv - vec2<f32>(0.5, 0.5)) * 0.0026 * crt;   // radial, none at centre

  var c : vec3<f32>;
  c.r = textureSample(scene, samp, uv + ca).r;
  c.g = textureSample(scene, samp, uv).g;
  c.b = textureSample(scene, samp, uv - ca).b;

  c += textureSample(bloom1, samp, uv).rgb * p.args.y;
  c += textureSample(bloom2, samp, uv).rgb * p.args.z;

  // phosphor tone map
  c = vec3<f32>(1.0) - exp(-c * 1.25);
  c = pow(max(c, vec3<f32>(0.0)), vec3<f32>(0.85));

  // scanlines + aperture grille
  let py = uv.y / max(p.texel.y, 1e-6);
  let scan = 0.86 + 0.14 * sin(py * 3.14159);
  let px = uv.x / max(p.texel.x, 1e-6);
  let grille = 0.94 + 0.06 * sin(px * 2.0944);
  c *= mix(1.0, scan * grille, crt);

  // vignette + faint tube glow
  let d = distance(uv, vec2<f32>(0.5, 0.5));
  c *= mix(1.0, smoothstep(0.95, 0.35, d), 0.55 * crt);
  c += vec3<f32>(0.012, 0.030, 0.028) * (1.0 - d);

  // off-screen after barrel distortion
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { c = vec3<f32>(0.0); }

  // noise
  let n = fract(sin(dot(uv * p.args.x, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.020 * crt;

  c = select(vec3<f32>(0.0), c, c == c);
  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
