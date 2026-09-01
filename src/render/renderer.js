// WebGPU renderer: one instanced line pass into an HDR target, a two-level
// bloom chain, then a CRT composite.

import { LINE_WGSL, BRIGHT_WGSL, BLUR_WGSL, COMPOSITE_WGSL } from './shaders.js';
import { STRIDE } from './lines.js';

const HDR = 'rgba16float';

export async function createRenderer(canvas, opts = {}) {
  if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser.');
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Could not acquire a WebGPU canvas context.');
  const format = navigator.gpu.getPreferredCanvasFormat();

  let device, linePipeline, brightPipeline, blurPipeline, compPipeline, sampler;
  let camUB, ub, camBG;
  let instanceBuf = null, instanceCap = 0;

  const camData = new Float32Array(24);
  const ubData = new Float32Array(8);

  // Everything the device owns is built here so it can be built again after a
  // device loss — which Android does routinely when an app is backgrounded.
  // Without this the game keeps simulating into a blank canvas.
  async function acquire() {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter — try a machine or browser with GPU access.');
    device = await adapter.requestDevice();
    context.configure({ device, format, alphaMode: 'opaque' });
    watchForLoss();

    const lineMod = device.createShaderModule({ code: LINE_WGSL, label: 'lines' });
    const brightMod = device.createShaderModule({ code: BRIGHT_WGSL, label: 'bright' });
    const blurMod = device.createShaderModule({ code: BLUR_WGSL, label: 'blur' });
    const compMod = device.createShaderModule({ code: COMPOSITE_WGSL, label: 'composite' });

    linePipeline = device.createRenderPipeline({
      label: 'line-pipeline',
      layout: 'auto',
      vertex: {
        module: lineMod, entryPoint: 'vs',
        buffers: [{
          arrayStride: STRIDE * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
            { shaderLocation: 2, offset: 32, format: 'float32x4' },
            { shaderLocation: 3, offset: 48, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: lineMod, entryPoint: 'fs',
        targets: [{
          format: HDR,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip', stripIndexFormat: undefined },
    });

    const post = (mod, target) => device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    });
    brightPipeline = post(brightMod, HDR);
    blurPipeline = post(blurMod, HDR);
    compPipeline = post(compMod, format);

    sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    camUB = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const mkUB = () => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    ub = { bright: mkUB(), blurH1: mkUB(), blurV1: mkUB(), blurH2: mkUB(), blurV2: mkUB(), comp: mkUB() };

    instanceBuf = null;
    instanceCap = 0;
    camBG = device.createBindGroup({
      layout: linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: camUB } }],
    });
  }

  const writeUB = (buf, texelX, texelY, a, b, c, d) => {
    ubData.set([texelX, texelY, 0, 0, a, b, c, d]);
    device.queue.writeBuffer(buf, 0, ubData);
  };

  let tex = {}, bg = {}, W = 1, H = 1;

  const mkTex = (w, h, label) => device.createTexture({
    size: [Math.max(1, w | 0), Math.max(1, h | 0)], format: HDR, label,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  function allocate(w, h) {
    W = Math.max(2, w | 0); H = Math.max(2, h | 0);
    for (const t of Object.values(tex)) t.destroy?.();
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    const qw = Math.max(2, W >> 2), qh = Math.max(2, H >> 2);
    tex = {
      scene: mkTex(W, H, 'scene'),
      a: mkTex(hw, hh, 'bloom-half-a'), b: mkTex(hw, hh, 'bloom-half-b'),
      c: mkTex(qw, qh, 'bloom-quarter-a'), d: mkTex(qw, qh, 'bloom-quarter-b'),
    };
    const v = {};
    for (const k in tex) v[k] = tex[k].createView();

    const postBG = (pipeline, srcView, buffer) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcView },
        { binding: 2, resource: { buffer } },
      ],
    });

    bg = {
      views: v,
      bright: postBG(brightPipeline, v.scene, ub.bright),
      blurH1: postBG(blurPipeline, v.a, ub.blurH1),
      blurV1: postBG(blurPipeline, v.b, ub.blurV1),
      blurH2: postBG(blurPipeline, v.a, ub.blurH2),
      blurV2: postBG(blurPipeline, v.d, ub.blurV2),
      comp: device.createBindGroup({
        layout: compPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: v.scene },
          { binding: 2, resource: v.a },
          { binding: 3, resource: v.c },
          { binding: 4, resource: { buffer: ub.comp } },
        ],
      }),
    };

    writeUB(ub.bright, 1 / W, 1 / H, 0.42, 0, 0, 0);
    writeUB(ub.blurH1, 1 / hw, 1 / hh, 1, 0, 1.0, 0);
    writeUB(ub.blurV1, 1 / hw, 1 / hh, 0, 1, 1.0, 0);
    writeUB(ub.blurH2, 1 / hw, 1 / hh, 1, 0, 2.2, 0);
    writeUB(ub.blurV2, 1 / qw, 1 / qh, 0, 1, 2.2, 0);
  }

  const state = {
    backend: 'webgpu',
    context, format,
    get device() { return device; },
    width: W, height: H, dpr: 1,
    resScale: opts.resScale ?? 1,
    bloom: [0.85, 0.60],
    crt: 1,

    resize(cssW, cssH, dpr) {
      const scale = state.resScale;
      const w = Math.max(2, Math.round(cssW * dpr * scale));
      const h = Math.max(2, Math.round(cssH * dpr * scale));
      if (w === W && h === H && canvas.width === w) return;
      canvas.width = w; canvas.height = h;
      state.dpr = dpr * scale;
      allocate(w, h);
      state.width = W; state.height = H;
    },

    render(batch, viewProj, time) {
      if (!tex.scene || state.lost) return;
      camData.set(viewProj, 0);
      camData.set([W, H, 1 / W, 1 / H], 16);
      camData.set([time, 0, 0, 0], 20);
      device.queue.writeBuffer(camUB, 0, camData);

      const need = Math.max(1, batch.count) * STRIDE * 4;
      if (!instanceBuf || need > instanceCap) {
        instanceCap = Math.max(need, 1 << 20) * 2;
        instanceBuf?.destroy?.();
        instanceBuf = device.createBuffer({
          size: instanceCap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }
      if (batch.count > 0) {
        device.queue.writeBuffer(instanceBuf, 0, batch.data, 0, batch.count * STRIDE);
      }
      writeUB(ub.comp, 1 / W, 1 / H, time, state.bloom[0], state.bloom[1], state.crt);

      const enc = device.createCommandEncoder();

      const scenePass = enc.beginRenderPass({
        colorAttachments: [{
          view: bg.views.scene, loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0.004, g: 0.010, b: 0.013, a: 1 },
        }],
      });
      if (batch.count > 0) {
        scenePass.setPipeline(linePipeline);
        scenePass.setBindGroup(0, camBG);
        scenePass.setVertexBuffer(0, instanceBuf);
        scenePass.draw(4, batch.count, 0, 0);
      }
      scenePass.end();

      const blit = (pipeline, group, view) => {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        p.setPipeline(pipeline);
        p.setBindGroup(0, group);
        p.draw(3);
        p.end();
      };

      blit(brightPipeline, bg.bright, bg.views.a);   // scene -> half (threshold)
      blit(blurPipeline, bg.blurH1, bg.views.b);     // half H
      blit(blurPipeline, bg.blurV1, bg.views.a);     // half V  -> bloom 1
      blit(blurPipeline, bg.blurH2, bg.views.d);     // half -> quarter H
      blit(blurPipeline, bg.blurV2, bg.views.c);     // quarter V -> bloom 2
      blit(compPipeline, bg.comp, context.getCurrentTexture().createView());

      device.queue.submit([enc.finish()]);
    },
  };

  function watchForLoss() {
    const lostDevice = device;
    device.lost.then(async (info) => {
      if (info.reason === 'destroyed' || device !== lostDevice) return;
      state.lost = true;
      state.onLost?.('webgpu');
      try {
        await acquire();
        tex = {};
        allocate(W, H);
        state.lost = false;
        state.onRestored?.('webgpu');
      } catch (err) {
        console.error('WebGPU could not be re-acquired:', err.message);
      }
    });
  }

  await acquire();
  state.lost = false;
  allocate(2, 2);

  return state;
}
