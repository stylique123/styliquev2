/**
 * threed.ts — 3D Product Turntable
 *
 * Provides `attachProductTurntable(imageEl, opts)` which layers 3D-feel effects
 * over a static product image:
 *
 *   Without depthMapUrl:  CSS perspective tilt on mousemove + "360" badge
 *                         Ken Burns slow pan at idle + horizontal-flip on badge click.
 *
 *   With depthMapUrl:     WebGL canvas overlay with per-pixel parallax tilt
 *                         (graceful fallback to CSS tilt when WebGL not available).
 *
 * Pure TypeScript — no npm imports. All WebGL uses the browser's native WebGL API.
 * Degrades gracefully: no error thrown, just no 3D effect if the env can't run it.
 *
 * Returns a cleanup function that removes all event listeners and DOM nodes.
 */

export interface TurntableOpts {
  /** URL of a MiDaS depth map image (grey-scale, white=near, black=far). */
  depthMapUrl?: string | null;
  /** Max rotation degrees on X axis (default 5). */
  maxTiltX?: number;
  /** Max rotation degrees on Y axis (default 8). */
  maxTiltY?: number;
}

export type CleanupFn = () => void;

// ─── CSS tilt path ──────────────────────────────────────────────────────────

function attachCssTurntable(
  wrap: HTMLElement,
  img: HTMLImageElement,
  maxTiltX: number,
  maxTiltY: number,
): CleanupFn {
  // Ensure the wrap has the perspective set so CSS 3D transforms look right.
  wrap.style.perspective = "800px";
  wrap.style.cursor = "crosshair";

  let kenBurnsId = 0;
  let isFlipped = false;
  let tiltActive = false;

  function startKenBurns() {
    if (tiltActive) return;
    img.style.animation = "sq-3d-ken-burns 12s ease-in-out infinite alternate";
  }

  function stopKenBurns() {
    img.style.animation = "none";
  }

  function onMouseMove(e: MouseEvent) {
    tiltActive = true;
    stopKenBurns();
    const rect = wrap.getBoundingClientRect();
    const dx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;   // −1..1
    const dy = ((e.clientY - rect.top) / rect.height - 0.5) * 2;   // −1..1
    const ry = dx * maxTiltY;
    const rx = -dy * maxTiltX;
    const flipScale = isFlipped ? "scaleX(-1)" : "";
    img.style.transform = `${flipScale} rotateX(${rx}deg) rotateY(${ry}deg) scale(1.01)`;
  }

  function onMouseLeave() {
    tiltActive = false;
    const flipScale = isFlipped ? "scaleX(-1)" : "";
    img.style.transform = flipScale || "";
    startKenBurns();
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    tiltActive = true;
    stopKenBurns();
    const rect = wrap.getBoundingClientRect();
    const dx = ((t.clientX - rect.left) / rect.width - 0.5) * 2;
    const dy = ((t.clientY - rect.top) / rect.height - 0.5) * 2;
    const ry = dx * maxTiltY;
    const rx = -dy * maxTiltX;
    const flipScale = isFlipped ? "scaleX(-1)" : "";
    img.style.transform = `${flipScale} rotateX(${rx}deg) rotateY(${ry}deg) scale(1.01)`;
  }

  function onTouchEnd() {
    tiltActive = false;
    const flipScale = isFlipped ? "scaleX(-1)" : "";
    img.style.transform = flipScale || "";
    startKenBurns();
  }

  // ── "360" badge button ──────────────────────────────────────────────────
  const badge = document.createElement("button");
  badge.type = "button";
  badge.textContent = "360°";
  badge.setAttribute("aria-label", "Flip view");
  badge.style.cssText = [
    "position:absolute",
    "bottom:10px",
    "left:50%",
    "transform:translateX(-50%)",
    "padding:4px 10px",
    "border-radius:20px",
    "font-size:11px",
    "font-weight:600",
    "letter-spacing:0.04em",
    "background:rgba(0,0,0,0.55)",
    "color:white",
    "border:none",
    "cursor:pointer",
    "z-index:2",
    "backdrop-filter:blur(4px)",
    "font-family:inherit",
  ].join(";");

  function onBadgeClick() {
    isFlipped = !isFlipped;
    const flipScale = isFlipped ? "scaleX(-1)" : "";
    img.style.transform = flipScale || "";
    img.style.animation = "sq-3d-ken-burns 12s ease-in-out infinite alternate";
  }

  badge.addEventListener("click", onBadgeClick);

  // Inject keyframes once per document.
  if (!document.getElementById("sq-3d-keyframes")) {
    const style = document.createElement("style");
    style.id = "sq-3d-keyframes";
    style.textContent = `
      @keyframes sq-3d-ken-burns {
        0%   { transform: scale(1)     translateX(0)     translateY(0); }
        50%  { transform: scale(1.025) translateX(0.8%)  translateY(0.4%); }
        100% { transform: scale(1)     translateX(-0.5%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // Make wrap relatively positioned so the badge can be absolutely placed.
  const prevPosition = wrap.style.position;
  if (!wrap.style.position || wrap.style.position === "static") {
    wrap.style.position = "relative";
  }
  wrap.appendChild(badge);

  // Start Ken Burns idle animation.
  startKenBurns();

  wrap.addEventListener("mousemove", onMouseMove);
  wrap.addEventListener("mouseleave", onMouseLeave);
  wrap.addEventListener("touchmove", onTouchMove, { passive: true });
  wrap.addEventListener("touchend", onTouchEnd);

  return () => {
    clearTimeout(kenBurnsId);
    wrap.removeEventListener("mousemove", onMouseMove);
    wrap.removeEventListener("mouseleave", onMouseLeave);
    wrap.removeEventListener("touchmove", onTouchMove);
    wrap.removeEventListener("touchend", onTouchEnd);
    badge.removeEventListener("click", onBadgeClick);
    badge.remove();
    img.style.transform = "";
    img.style.animation = "";
    img.style.perspective = "";
    wrap.style.position = prevPosition;
    wrap.style.perspective = "";
    wrap.style.cursor = "";
  };
}

// ─── WebGL parallax path ────────────────────────────────────────────────────

const VERT_SRC = `
  attribute vec2 a_pos;
  varying   vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FRAG_SRC = `
  precision mediump float;
  uniform sampler2D u_color;
  uniform sampler2D u_depth;
  uniform vec2      u_tilt;     // rotateX, rotateY  in −1..1
  uniform float     u_strength; // parallax strength (default 0.03)
  varying vec2      v_uv;

  void main() {
    float depth = texture2D(u_depth, v_uv).r;   // 0=far, 1=near (white=near)
    vec2  offset = u_tilt * depth * u_strength;
    // Flip y because WebGL UVs start bottom-left, CSS starts top-left.
    vec2  uv = vec2(v_uv.x + offset.x, v_uv.y - offset.y);
    // Clamp to [0,1] to avoid sampling outside the texture.
    uv = clamp(uv, 0.0, 1.0);
    gl_FragColor = texture2D(u_color, uv);
  }
`;

function createShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createProgram(gl: WebGLRenderingContext, vert: string, frag: string): WebGLProgram | null {
  const vs = createShader(gl, gl.VERTEX_SHADER, vert);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function loadTexture(gl: WebGLRenderingContext, src: string): Promise<WebGLTexture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tex = gl.createTexture();
      if (!tex) { resolve(null); return; }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function attachWebGLTurntable(
  wrap: HTMLElement,
  img: HTMLImageElement,
  depthMapUrl: string,
  maxTiltX: number,
  maxTiltY: number,
): CleanupFn {
  // Create a canvas that sits on top of img.
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";

  const prevPosition = wrap.style.position;
  if (!wrap.style.position || wrap.style.position === "static") {
    wrap.style.position = "relative";
  }

  // Size the canvas to match the image.
  function syncSize() {
    canvas.width  = img.clientWidth  || img.naturalWidth  || 512;
    canvas.height = img.clientHeight || img.naturalHeight || 512;
  }
  syncSize();
  wrap.appendChild(canvas);

  // Try to get a WebGL context. If unavailable, fall back to CSS tilt.
  const glMaybe = canvas.getContext("webgl") as WebGLRenderingContext | null;
  if (!glMaybe) {
    canvas.remove();
    wrap.style.position = prevPosition;
    return attachCssTurntable(wrap, img, maxTiltX, maxTiltY);
  }
  // Non-nullable alias after the null-guard above — closures below can use this safely.
  const gl: WebGLRenderingContext = glMaybe;

  const prog = createProgram(gl, VERT_SRC, FRAG_SRC);
  if (!prog) {
    canvas.remove();
    wrap.style.position = prevPosition;
    return attachCssTurntable(wrap, img, maxTiltX, maxTiltY);
  }

  gl.useProgram(prog);

  // Full-screen quad.
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);

  const aPosLoc    = gl.getAttribLocation(prog, "a_pos");
  const uColorLoc  = gl.getUniformLocation(prog, "u_color");
  const uDepthLoc  = gl.getUniformLocation(prog, "u_depth");
  const uTiltLoc   = gl.getUniformLocation(prog, "u_tilt");
  const uStrLoc    = gl.getUniformLocation(prog, "u_strength");

  let colorTex: WebGLTexture | null = null;
  let depthTex: WebGLTexture | null = null;
  let rafId = 0;
  let tiltX = 0;
  let tiltY = 0;
  let targetX = 0;
  let targetY = 0;

  // Load both textures, then start the render loop.
  void Promise.all([
    loadTexture(gl, img.src),
    loadTexture(gl, depthMapUrl),
  ]).then(([ct, dt]) => {
    colorTex = ct;
    depthTex = dt;
    if (!colorTex || !depthTex) {
      // Texture load failed — fall back silently.
      canvas.style.display = "none";
      return;
    }
    // Make img invisible — canvas replaces it.
    img.style.opacity = "0";
    loop();
  });

  function render() {
    if (!colorTex || !depthTex) return;
    syncSize();
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.uniform1i(uColorLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(uDepthLoc, 1);

    gl.uniform2f(uTiltLoc, tiltX / maxTiltY, tiltY / maxTiltX);
    gl.uniform1f(uStrLoc, 0.03);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function loop() {
    // Lerp towards target for smooth movement.
    tiltX += (targetX - tiltX) * 0.12;
    tiltY += (targetY - tiltY) * 0.12;
    render();
    rafId = requestAnimationFrame(loop);
  }

  function onMouseMove(e: MouseEvent) {
    const rect = wrap.getBoundingClientRect();
    targetX = ((e.clientX - rect.left) / rect.width - 0.5) * 2 * maxTiltY;
    targetY = ((e.clientY - rect.top) / rect.height - 0.5) * 2 * maxTiltX;
  }

  function onMouseLeave() {
    targetX = 0;
    targetY = 0;
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    const rect = wrap.getBoundingClientRect();
    targetX = ((t.clientX - rect.left) / rect.width - 0.5) * 2 * maxTiltY;
    targetY = ((t.clientY - rect.top) / rect.height - 0.5) * 2 * maxTiltX;
  }

  function onTouchEnd() {
    targetX = 0;
    targetY = 0;
  }

  wrap.addEventListener("mousemove", onMouseMove);
  wrap.addEventListener("mouseleave", onMouseLeave);
  wrap.addEventListener("touchmove", onTouchMove, { passive: true });
  wrap.addEventListener("touchend", onTouchEnd);

  return () => {
    cancelAnimationFrame(rafId);
    wrap.removeEventListener("mousemove", onMouseMove);
    wrap.removeEventListener("mouseleave", onMouseLeave);
    wrap.removeEventListener("touchmove", onTouchMove);
    wrap.removeEventListener("touchend", onTouchEnd);
    canvas.remove();
    img.style.opacity = "";
    wrap.style.position = prevPosition;
    if (colorTex) gl.deleteTexture(colorTex);
    if (depthTex) gl.deleteTexture(depthTex);
    if (quadBuf) gl.deleteBuffer(quadBuf);
    gl.deleteProgram(prog);
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Attach a 3D turntable effect to a product image element.
 *
 * @param imageEl  The `<img>` element showing the product.
 * @param opts     Configuration including optional depthMapUrl.
 * @returns        A cleanup function — call it to remove all effects.
 *
 * @example
 * const cleanup = attachProductTurntable(imgEl, { depthMapUrl: product.depthMapUrl });
 * // later:
 * cleanup();
 */
export function attachProductTurntable(
  imageEl: HTMLImageElement,
  opts: TurntableOpts = {},
): CleanupFn {
  const {
    depthMapUrl = null,
    maxTiltX = 5,
    maxTiltY = 8,
  } = opts;

  // The image must be inside a container. We add tilt/perspective to the wrap.
  const wrap = imageEl.parentElement;
  if (!wrap) {
    // Can't attach without a parent — return no-op.
    return () => { /* noop */ };
  }

  try {
    if (depthMapUrl) {
      return attachWebGLTurntable(wrap, imageEl, depthMapUrl, maxTiltX, maxTiltY);
    }
    return attachCssTurntable(wrap, imageEl, maxTiltX, maxTiltY);
  } catch {
    // Any unexpected error: degrade silently.
    return () => { /* noop */ };
  }
}
