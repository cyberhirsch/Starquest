// WebGL2 fallback renderer. Same interface as the WebGPU one, same look:
// instanced line quads into an HDR target, two-level bloom, CRT composite.

import { LINE_VS, LINE_FS, FULLSCREEN_VS, BRIGHT_FS, BLUR_FS, COMPOSITE_FS } from './shaders_gl.js';
import { STRIDE } from './lines.js';

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`${label} shader: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label} vs`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label} fs`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${label} link: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

export async function createGLRenderer(canvas, opts = {}) {
  // No `desynchronized` here: the low-latency canvas path can present a
  // partially composited surface on Android/Chrome, which shows up as black
  // rectangles over the scene.
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  const floatOK = !!gl.getExtension('EXT_color_buffer_float')
    || !!gl.getExtension('EXT_color_buffer_half_float');
  const HDR = floatOK ? gl.RGBA16F : gl.RGBA8;
  const HDR_TYPE = floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  const lineProg = program(gl, LINE_VS, LINE_FS, 'line');
  const brightProg = program(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright');
  const blurProg = program(gl, FULLSCREEN_VS, BLUR_FS, 'blur');
  const compProg = program(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');

  // instance buffer + VAO
  const vao = gl.createVertexArray();
  const instBuf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  ['aA', 'aB', 'aCol', 'aExt'].forEach((name, i) => {
    const loc = gl.getAttribLocation(lineProg.p, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();
  let instCap = 0;

  const targets = {};
  let W = 2, H = 2;

  const makeTarget = (w, h) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, HDR, w, h, 0, gl.RGBA, HDR_TYPE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  };

  function allocate(w, h) {
    W = Math.max(2, w | 0); H = Math.max(2, h | 0);
    for (const t of Object.values(targets)) {
      gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo);
    }
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    const qw = Math.max(2, W >> 2), qh = Math.max(2, H >> 2);
    targets.scene = makeTarget(W, H);
    targets.a = makeTarget(hw, hh);
    targets.b = makeTarget(hw, hh);
    targets.c = makeTarget(qw, qh);
    targets.d = makeTarget(qw, qh);
  }

  const bindTarget = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
  };

  const state = {
    backend: 'webgl2',
    gl, width: W, height: H, dpr: 1,
    resScale: opts.resScale ?? 1,
    bloom: [0.85, 0.60],
    crt: 1,

    resize(cssW, cssH, dpr) {
      const w = Math.max(2, Math.round(cssW * dpr * state.resScale));
      const h = Math.max(2, Math.round(cssH * dpr * state.resScale));
      if (w === W && h === H && canvas.width === w) return;
      canvas.width = w; canvas.height = h;
      state.dpr = dpr * state.resScale;
      allocate(w, h);
      state.width = W; state.height = H;
    },

    render(batch, viewProj, time) {
      if (!targets.scene) return;
      // ---- scene ----------------------------------------------------------
      bindTarget(targets.scene);
      gl.clearColor(0.004, 0.010, 0.013, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (batch.count > 0) {
        const need = batch.count * STRIDE * 4;
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        if (need > instCap) {
          instCap = Math.max(need, 1 << 20) * 2;
          gl.bufferData(gl.ARRAY_BUFFER, instCap, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * STRIDE);
        gl.useProgram(lineProg.p);
        gl.uniformMatrix4fv(lineProg.u.uViewProj, false, viewProj);
        gl.uniform4f(lineProg.u.uRes, W, H, 1 / W, 1 / H);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }

      // ---- bloom ----------------------------------------------------------
      gl.bindVertexArray(emptyVao);
      const blit = (target) => { bindTarget(target); gl.drawArrays(gl.TRIANGLES, 0, 3); };
      const bindTex = (unit, tex, loc) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, unit);
      };

      gl.useProgram(brightProg.p);
      gl.uniform1f(brightProg.u.uThreshold, 0.42);
      bindTex(0, targets.scene.tex, brightProg.u.uSrc);
      blit(targets.a);

      gl.useProgram(blurProg.p);
      const blur = (src, dst, dx, dy, scale) => {
        gl.uniform2f(blurProg.u.uTexel, 1 / src.w, 1 / src.h);
        gl.uniform2f(blurProg.u.uDir, dx, dy);
        gl.uniform1f(blurProg.u.uScale, scale);
        bindTex(0, src.tex, blurProg.u.uSrc);
        blit(dst);
      };
      blur(targets.a, targets.b, 1, 0, 1.0);
      blur(targets.b, targets.a, 0, 1, 1.0);
      blur(targets.a, targets.d, 1, 0, 2.2);
      blur(targets.d, targets.c, 0, 1, 2.2);

      // ---- composite ------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(compProg.p);
      bindTex(0, targets.scene.tex, compProg.u.uScene);
      bindTex(1, targets.a.tex, compProg.u.uBloom1);
      bindTex(2, targets.c.tex, compProg.u.uBloom2);
      gl.uniform2f(compProg.u.uTexel, 1 / W, 1 / H);
      gl.uniform1f(compProg.u.uTime, time);
      gl.uniform1f(compProg.u.uB1, state.bloom[0]);
      gl.uniform1f(compProg.u.uB2, state.bloom[1]);
      gl.uniform1f(compProg.u.uCrt, state.crt);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
  };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('WebGL context lost');
  });

  return state;
}
