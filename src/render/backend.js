// Picks a renderer: WebGPU first, WebGL2 as the fallback.

import { createRenderer } from './renderer.js';
import { createGLRenderer } from './renderer_gl.js';

export async function createBestRenderer(canvas, opts = {}) {
  const forced = new URLSearchParams(location.search).get('gfx');
  const errors = [];
  if (forced !== 'webgl') {
    try { return await createRenderer(canvas, opts); }
    catch (e) { errors.push(`WebGPU: ${e.message}`); }
  }
  if (forced !== 'webgpu') {
    try { return await createGLRenderer(canvas, opts); }
    catch (e) { errors.push(`WebGL2: ${e.message}`); }
  }
  throw new Error(errors.join(' · ') || 'No supported graphics backend.');
}
