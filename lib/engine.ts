import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import * as fabric from "fabric";
import { removeBackground, sampleCornerColor, type RGB } from "./bgRemove";

// Every print zone has its own placement canvas + decal on the 3D shirt.
export const SIDES = ["front", "back"] as const;
export type Side = (typeof SIDES)[number];

export interface EngineProject {
  side: Side;
  color: string;
  front: string;
  back: string;
}

export interface SelInfo {
  kind: "text" | "image";
  text: string;
  fill: string;
  font: string;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  locked: boolean;
  bounds: { left: number; top: number; width: number; height: number };
}

export interface EngineEvents {
  onSelection(info: SelInfo | null): void;
  onHistory(canUndo: boolean, canRedo: boolean): void;
  onToast(msg: string): void;
  onBgMessage(msg: string): void;
  onReady(): void;
  onError(msg: string): void;
}

type ArtObj = fabric.Object & { _orig?: string; _key?: RGB | null; _fileName?: string };

export interface OriginalArtwork {
  side: Side;
  fileName: string;
  dataUrl: string;
}

export interface Engine {
  setSide(s: Side): void;
  resetView(): void;
  setColor(hex: string): void;
  setShirtType(id: string): void;
  setPlain(on: boolean): void;
  setSpin(on: boolean): void;
  fit(): void;
  addImageFile(f: File, at?: { x: number; y: number }): void;
  replaceSelectedImage(file: File): void;
  addText(text: string, font: string, color: string, at?: { x: number; y: number }): void;
  deleteSelected(): void;
  undo(): void;
  redo(): void;
  exportPng(): string | null;
  // edit selected
  setText(v: string): void;
  setFill(v: string): void;
  setFont(v: string): void;
  setOpacity(v: number): void;
  setAngle(degrees: number): void;
  setGeometry(values: Partial<Pick<SelInfo, "x" | "y" | "width" | "height">>): void;
  commit(): void;
  align(position: "left" | "centerX" | "right" | "top" | "centerY" | "bottom"): void;
  mirror(): void;
  flipVertical(): void;
  toggleLock(): void;
  center(): void;
  zoomIn(): void;
  zoomOut(): void;
  duplicate(): void;
  forward(): void;
  backward(): void;
  getOriginalImages(): OriginalArtwork[];
  exportSideViews(): Record<Side, string> | null;
  exportProject(): EngineProject;
  loadProject(project: EngineProject): Promise<void>;
  bgAuto(): Promise<void>;
  bgPick(): void;
  bgReset(): void;
  bgRetune(tol: number, contig: boolean): void;
  dispose(): void;
}

export const CW = 600;
const EXTRA = ["_orig", "_key", "_fileName"];

interface ZoneCfg {
  label: string;
  dw: number; dh: number; // print area size in model units
  x: number; y: number;   // where the decal projector is aimed (model units)
  nx: number; ny: number; nz: number;
  back: boolean;          // projects onto the back of the shirt
  tilt: number;           // rotation around Z so sleeve prints follow the sleeve angle
  az: number;             // camera azimuth that looks at this zone
  zoom: number | null;    // camera distance (null = keep current)
  camY: number;
}
// Front/back span the full visible torso, while sleeves use their own angled print zones.
const RAW: Record<Side, ZoneCfg> = {
  front:       { label: "Front",       dw: 0.36, dh: 0.58, x: 0,     y: -0.04, nx: 0,      ny: 0, nz: 1,  back: false, tilt: 0,      az: 0.08,          zoom: null, camY: 0.02 },
  back:        { label: "Back",        dw: 0.36, dh: 0.58, x: 0,     y: -0.04, nx: 0,      ny: 0, nz: -1, back: true,  tilt: 0,      az: Math.PI + 0.08, zoom: null, camY: 0.02 },
};
export const ZONES = Object.fromEntries(
  SIDES.map((k) => [k, { ...RAW[k], ch: Math.round((CW * RAW[k].dh) / RAW[k].dw) }]),
) as Record<Side, ZoneCfg & { ch: number }>;

export function createEngine(
  view: HTMLDivElement,
  place: HTMLDivElement,
  stage: HTMLDivElement,
  events: { current: EngineEvents },
): Engine {
  const ev = events;
  let disposed = false;

  /* ---------------- three.js scene ---------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.style.display = "block";
  view.insertBefore(renderer.domElement, view.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
  camera.position.set(0.15, 0.02, 1.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -0.04, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.9;
  controls.maxDistance = 3.2;
  controls.autoRotateSpeed = 2.5;

  // studio environment for soft reflections
  {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x9a9a9a);
    const panel = (w: number, h: number, x: number, y: number, z: number, v: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide }),
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(8, 6, 4, 5, 6, 5); panel(8, 6, -6, 2, 3, 3); panel(10, 4, 0, -1, -6, 2.5);
    panel(12, 12, 0, 10, 0, 3); panel(12, 12, 0, -8, 0, 1.2);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.03).texture;
    pm.dispose();
  }
  const key = new THREE.DirectionalLight(0xffffff, 0.55 * Math.PI);
  key.position.set(1.5, 2, 3);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 0.35 * Math.PI));

  // contact shadow
  {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, "rgba(0,0,0,.5)");
    gr.addColorStop(0.6, "rgba(0,0,0,.16)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.55),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(0.05, -0.375, 0);
    scene.add(sh);
  }

  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const roView = new ResizeObserver(resize);
  roView.observe(view);

  // camera tween: angle based, so it never cuts through the shirt
  let camAnim: ((now: number) => boolean) | null = null;
  function goCam(az: number, r: number | null, y: number) {
    const a0 = Math.atan2(camera.position.x, camera.position.z);
    const r0 = Math.hypot(camera.position.x, camera.position.z);
    const y0 = camera.position.y;
    const rT = r ?? r0;
    let d = az - a0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(Math.abs(d) - Math.PI) < 0.01) d = Math.PI;
    const t0 = performance.now();
    camAnim = (now) => {
      const t = Math.min(1, (now - t0) / 500);
      const e = 1 - Math.pow(1 - t, 3);
      const a = a0 + d * e, rr = r0 + (rT - r0) * e;
      camera.position.set(Math.sin(a) * rr, y0 + (y - y0) * e, Math.cos(a) * rr);
      return t >= 1;
    };
  }

  /* ---------------- fabric (print-area editors) ---------------- */
  fabric.Object.prototype.set({
    transparentCorners: false,
    cornerColor: "#ffffff",
    cornerStrokeColor: "#111111",
    borderColor: "#ffffff",
    cornerStyle: "circle",
    cornerSize: 26,
    borderScaleFactor: 3,
    padding: 4,
  });
  Object.assign(fabric.Object.prototype, { touchCornerSize: 44 });
  // a few runtime members missing from @types/fabric
  const wrap = (c: fabric.Canvas) => (c as unknown as { wrapperEl: HTMLElement }).wrapperEl;
  const retina = (c: fabric.Canvas) => (c as unknown as { getRetinaScaling(): number }).getRetinaScaling();

  const makeEditor = (k: Side) => {
    const el = document.createElement("canvas");
    stage.appendChild(el);
    return new fabric.Canvas(el, { width: CW, height: ZONES[k].ch, preserveObjectStacking: true });
  };
  const fc = Object.fromEntries(SIDES.map((k) => [k, makeEditor(k)])) as Record<Side, fabric.Canvas>;
  SIDES.forEach((k) => { if (k !== "front") wrap(fc[k]).style.display = "none"; });
  const sideOf = (c: fabric.Canvas): Side => SIDES.find((k) => fc[k] === c) ?? "front";

  // The visible fabric canvas also contains selection handles, so the 3D texture is
  // fed from a separate offscreen canvas rendered without any controls.
  const TEX_SCALE = 2;
  const tex = {} as Record<Side, THREE.CanvasTexture>;
  SIDES.forEach((k) => {
    const cv = document.createElement("canvas");
    cv.width = CW * TEX_SCALE;
    cv.height = ZONES[k].ch * TEX_SCALE;
    const ctx = cv.getContext("2d")!;
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    tex[k] = t;
    let busy = false; // toCanvasElement() re-fires after:render
    const refreshTexture = () => {
      if (busy) return;
      busy = true;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(fc[k].toCanvasElement(TEX_SCALE), 0, 0);
      t.needsUpdate = true;
      busy = false;
    };
    fc[k].on("after:render", refreshTexture);
    (["object:moving", "object:scaling", "object:rotating", "object:resizing", "object:skewing", "text:changed"] as const).forEach((eventName) => {
      fc[k].on(eventName, refreshTexture);
    });
  });

  let side: Side = "front";
  let renderShirtRef: () => void = () => {};
  fc.front.add(new fabric.IText("YOUR DESIGN", {
    left: CW / 2, top: 400, originX: "center", originY: "center",
    fontFamily: "Impact", fontSize: 64, fill: "#111111",
  }));
  fc.front.add(new fabric.IText("est. 2026", {
    left: CW / 2, top: 462, originX: "center", originY: "center",
    fontFamily: "Georgia", fontSize: 32, fill: "#e11d48",
  }));
  fc.front.renderAll();

  function fit() {
    const r = stage.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return;
    SIDES.forEach((k) => {
      const ch = ZONES[k].ch;
      const s = Math.min((r.width - 24) / CW, (r.height - 24) / ch);
      fc[k].setDimensions(
        { width: `${Math.floor(CW * s)}px`, height: `${Math.floor(ch * s)}px` },
        { cssOnly: true },
      );
    });
    placeRefImg();
  }
  const roPlace = new ResizeObserver(fit);
  roPlace.observe(place);
  roPlace.observe(stage);

  /* ---------------- undo / redo ---------------- */
  const hist = Object.fromEntries(SIDES.map((k) => [k, { s: [] as string[], i: -1 }])) as Record<
    Side,
    { s: string[]; i: number }
  >;
  let lock = false;
  const active = () => fc[side].getActiveObject() as ArtObj | null;

  function emitHist() {
    const h = hist[side];
    ev.current.onHistory(h.i > 0, h.i < h.s.length - 1);
  }
  function snap(k: Side) {
    if (lock) return;
    const h = hist[k];
    const j = JSON.stringify(fc[k].toObject(EXTRA));
    if (h.s[h.i] === j) return;
    h.s = h.s.slice(0, h.i + 1);
    h.s.push(j);
    if (h.s.length > 25) h.s.shift();
    h.i = h.s.length - 1;
    emitHist();
  }
  function restore(k: Side, i: number) {
    const h = hist[k];
    const previous = h.i;
    lock = true;
    void fc[k].loadFromJSON(h.s[i]).then(() => {
      h.i = i;
      fc[k].renderAll();
      emitHist();
      emitSel();
    }).catch((error: unknown) => {
      h.i = previous;
      console.error(error);
      ev.current.onError("Could not restore design history");
    }).finally(() => {
      lock = false;
    });
  }

  function readSel(): SelInfo | null {
    const o = active();
    if (!o) return null;
    const isText = o.type === "i-text" || o.type === "text" || o.type === "textbox";
    const isImg = o.type === "image";
    if (!isText && !isImg) return null;
    const t = o as unknown as fabric.IText;
    return {
      kind: isText ? "text" : "image",
      text: isText ? t.text ?? "" : "",
      fill: typeof t.fill === "string" && /^#[0-9a-f]{6}$/i.test(t.fill) ? t.fill : "#111111",
      font: isText ? t.fontFamily ?? "Impact" : "",
      opacity: Math.round((o.opacity ?? 1) * 100),
      x: Math.round(o.getCenterPoint().x),
      y: Math.round(o.getCenterPoint().y),
      width: Math.round(o.getScaledWidth()),
      height: Math.round(o.getScaledHeight()),
      angle: Math.round(o.angle ?? 0),
      locked: Boolean(o.lockMovementX && o.lockMovementY && o.lockScalingX && o.lockScalingY && o.lockRotation),
      bounds: o.getBoundingRect(),
    };
  }
  function emitSel() { ev.current.onSelection(readSel()); }

  SIDES.forEach((k) => {
    snap(k);
    (["object:added", "object:modified", "object:removed", "text:changed"] as const).forEach((n) =>
      fc[k].on(n, () => {
        snap(k);
        if (n === "object:modified" && k === side) emitSel();
      }),
    );
    (["selection:created", "selection:updated", "selection:cleared"] as const).forEach((n) =>
      fc[k].on(n, emitSel),
    );
  });

  /* ---------------- shirt reference behind the placement canvas ---------------- */
  // A real (orthographic) render of the shirt is shown behind the transparent print-area
  // canvas, so the shirt shape / seams are visible while dragging the design.
  const IW = { x0: -0.34, x1: 0.34, y0: -0.4, y1: 0.3 }; // world window of the reference image
  const refImg = document.createElement("img");
  refImg.alt = "";
  refImg.draggable = false;
  Object.assign(refImg.style, { position: "absolute", pointerEvents: "none", display: "none", maxWidth: "none", userSelect: "none" });
  stage.insertBefore(refImg, stage.firstChild);
  const refUrl: Partial<Record<Side, string>> = {};
  let shirtRoot: THREE.Object3D | null = null;
  let refRT: THREE.WebGLRenderTarget | null = null;

  function placeRefImg() {
    const url = refUrl[side];
    const cr = wrap(fc[side]).getBoundingClientRect();
    if (!url || cr.width < 10) { refImg.style.display = "none"; return; }
    const pr = stage.getBoundingClientRect();
    const z = ZONES[side];
    const ppu = (cr.width - 3) / z.dw; // px per model unit (3px = dashed border)
    const w = (IW.x1 - IW.x0) * ppu, h = (IW.y1 - IW.y0) * ppu;
    const cx = cr.left - pr.left - stage.clientLeft + cr.width / 2;
    const cy = cr.top - pr.top - stage.clientTop + cr.height / 2;
    const iy = cy - ((IW.y0 + IW.y1) / 2 - z.y) * ppu;
    refImg.style.width = `${w}px`;
    refImg.style.height = `${h}px`;
    refImg.style.left = `${cx - w / 2}px`;
    refImg.style.top = `${iy - h / 2}px`;
    if (refImg.getAttribute("src") !== url) refImg.src = url;
    refImg.style.display = "block";
  }

  renderShirtRef = () => {
    if (!shirtRoot || disposed) return;
    const W = 1024, H = Math.round((W * (IW.y1 - IW.y0)) / (IW.x1 - IW.x0));
    if (!refRT) refRT = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
    const cam = new THREE.OrthographicCamera(IW.x0, IW.x1, IW.y1, IW.y0, 0.1, 6);
    const hidden: THREE.Object3D[] = [];
    scene.children.forEach((o) => { if ((o as THREE.Mesh).isMesh && o.visible) { o.visible = false; hidden.push(o); } });
    const keyZ = key.position.z;
    const buf = new Uint8Array(W * H * 4);
    SIDES.forEach((k) => {
      const bk = ZONES[k].back;
      cam.position.set(0, 0, bk ? -2 : 2);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      key.position.z = bk ? -3 : 3;
      renderer.setRenderTarget(refRT);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(refRT!, 0, 0, W, H, buf);
      renderer.setRenderTarget(null);
      const tmp = document.createElement("canvas");
      tmp.width = W; tmp.height = H;
      tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
      const out = document.createElement("canvas");
      out.width = W; out.height = H;
      const g = out.getContext("2d")!;
      g.translate(0, H);
      g.scale(1, -1);
      g.filter = "brightness(1.18)";
      g.drawImage(tmp, 0, 0);
      refUrl[k] = out.toDataURL("image/png");
    });
    key.position.z = keyZ;
    hidden.forEach((o) => { o.visible = true; });
    placeRefImg();
  };

  /* ---------------- load the 3D shirt ---------------- */
  let shirtMat: THREE.MeshStandardMaterial | null = null;
  let curColor = "#efede8";
  let plain = false;
  const decals: THREE.Mesh[] = [];
  let shirtMesh: THREE.Mesh | null = null;
  let basePos: Float32Array | null = null;
  let curType = "crew-neck";
  let buildDecals: () => void = () => {};
  const extras = new THREE.Group();
  const stripeU = { uStripe: { value: 0 }, uStripeCol: { value: new THREE.Color("#1a1a2e") } };

/* ---------- shirt types: the one base model is reshaped / dressed up at runtime ---------- */
  // Rim of the neck hole and of both sleeve cuffs, measured from shirt.glb. The same deformation that
  // reshapes the mesh is applied to these rings, so ribs / collars always sit exactly on the fabric edge.
  const NECK_RING: [number, number, number][] = [
    [-0.0749, 0.2439, 0.0035],
    [-0.0788, 0.2516, -0.0104],
    [-0.079, 0.2549, -0.0242],
    [-0.0765, 0.2546, -0.0349],
    [-0.0688, 0.2514, -0.0465],
    [-0.0573, 0.2486, -0.0552],
    [-0.0474, 0.247, -0.0598],
    [-0.0317, 0.2452, -0.0634],
    [-0.025, 0.2447, -0.0643],
    [-0.0139, 0.2442, -0.0652],
    [-0.0035, 0.2439, -0.0654],
    [0.0085, 0.2439, -0.0654],
    [0.0174, 0.2441, -0.065],
    [0.0349, 0.2449, -0.063],
    [0.0417, 0.2455, -0.0617],
    [0.0544, 0.247, -0.0576],
    [0.069, 0.25, -0.0487],
    [0.0784, 0.2537, -0.0369],
    [0.081, 0.2544, -0.0275],
    [0.0813, 0.2512, -0.0111],
    [0.0778, 0.2443, 0.0016],
    [0.072, 0.2353, 0.015],
    [0.0682, 0.2304, 0.0223],
    [0.061, 0.2233, 0.0336],
    [0.055, 0.2187, 0.0412],
    [0.0485, 0.2149, 0.0482],
    [0.0394, 0.2112, 0.0559],
    [0.0305, 0.2088, 0.0615],
    [0.0175, 0.2064, 0.0668],
    [0.0095, 0.2055, 0.0687],
    [-0.002, 0.2051, 0.0695],
    [-0.0133, 0.2062, 0.0675],
    [-0.0216, 0.2076, 0.0648],
    [-0.0305, 0.2095, 0.0606],
    [-0.0395, 0.2125, 0.0548],
    [-0.0473, 0.2161, 0.0482],
    [-0.0546, 0.2209, 0.0404],
    [-0.0604, 0.2256, 0.0331],
    [-0.0663, 0.2316, 0.0235],
    [-0.0727, 0.2403, 0.0095],
  ];
  const CUFF_RING_R: [number, number, number][] = [
    [0.1604, -0.0115, -0.0252],
    [0.1609, -0.0117, -0.0387],
    [0.1624, -0.0111, -0.0476],
    [0.1691, -0.0092, -0.0626],
    [0.1814, -0.0056, -0.0734],
    [0.1938, -0.002, -0.0772],
    [0.2086, 0.0021, -0.0762],
    [0.2198, 0.0054, -0.0723],
    [0.2335, 0.0094, -0.064],
    [0.2391, 0.0112, -0.0594],
    [0.2503, 0.0146, -0.048],
    [0.2594, 0.0176, -0.0349],
    [0.2651, 0.0195, -0.0248],
    [0.2697, 0.0211, -0.0093],
    [0.2656, 0.0196, 0.0089],
    [0.2494, 0.0144, 0.0195],
    [0.2393, 0.0111, 0.0215],
    [0.2207, 0.0048, 0.0233],
    [0.2094, 0.0009, 0.0245],
    [0.1956, -0.0041, 0.0251],
    [0.1819, -0.0087, 0.0219],
    [0.1695, -0.0121, 0.0121],
    [0.1637, -0.013, 0.0009],
    [0.1615, -0.0127, -0.0081],
  ];
  const CUFF_RING_L: [number, number, number][] = [
    [-0.2677, 0.0231, -0.0233],
    [-0.2583, 0.02, -0.0381],
    [-0.2491, 0.017, -0.0493],
    [-0.2392, 0.014, -0.0593],
    [-0.2297, 0.0108, -0.067],
    [-0.2179, 0.0077, -0.0734],
    [-0.2033, 0.0037, -0.0772],
    [-0.1894, 0.0001, -0.0766],
    [-0.1774, -0.0029, -0.0711],
    [-0.168, -0.0052, -0.0616],
    [-0.1618, -0.0065, -0.047],
    [-0.1603, -0.0066, -0.0375],
    [-0.1599, -0.006, -0.0243],
    [-0.1607, -0.0073, -0.0124],
    [-0.1635, -0.0082, 0.0015],
    [-0.17, -0.0076, 0.013],
    [-0.1798, -0.0053, 0.0209],
    [-0.1916, -0.0019, 0.0244],
    [-0.2031, 0.0018, 0.0243],
    [-0.2207, 0.0079, 0.0214],
    [-0.2263, 0.0098, 0.0204],
    [-0.2483, 0.0169, 0.0164],
    [-0.2652, 0.0223, 0.0083],
    [-0.2719, 0.0245, -0.0084],
  ];
  const HEM_RING: [number, number, number][] = [
    [-0.1619, -0.3231, 0.0119],
    [-0.1602, -0.3231, -0.0032],
    [-0.1561, -0.3236, -0.0191],
    [-0.1504, -0.3243, -0.0316],
    [-0.1403, -0.3249, -0.0473],
    [-0.1298, -0.3252, -0.0602],
    [-0.122, -0.3252, -0.0682],
    [-0.1086, -0.3255, -0.0797],
    [-0.0986, -0.326, -0.0865],
    [-0.0871, -0.3266, -0.0922],
    [-0.0713, -0.3281, -0.0971],
    [-0.0596, -0.3295, -0.0992],
    [-0.0494, -0.3311, -0.1002],
    [-0.037, -0.3329, -0.1007],
    [-0.0255, -0.3345, -0.1012],
    [-0.0129, -0.3362, -0.1016],
    [-0.0005, -0.3376, -0.1019],
    [0.0105, -0.3388, -0.1023],
    [0.0219, -0.3394, -0.1024],
    [0.0319, -0.3399, -0.1026],
    [0.048, -0.3401, -0.1025],
    [0.0607, -0.3403, -0.1015],
    [0.0753, -0.3402, -0.0983],
    [0.0837, -0.3402, -0.0952],
    [0.0972, -0.3399, -0.0877],
    [0.1072, -0.3396, -0.0797],
    [0.121, -0.339, -0.0654],
    [0.1295, -0.3382, -0.0551],
    [0.1366, -0.3374, -0.0451],
    [0.1441, -0.3362, -0.0332],
    [0.1514, -0.3346, -0.0188],
    [0.1556, -0.333, -0.0033],
    [0.1575, -0.3314, 0.013],
    [0.1571, -0.3313, 0.0243],
    [0.1538, -0.3315, 0.0415],
    [0.1504, -0.3317, 0.0525],
    [0.1401, -0.3316, 0.0722],
    [0.1309, -0.3318, 0.0823],
    [0.1197, -0.3326, 0.0908],
    [0.1013, -0.3345, 0.0985],
    [0.089, -0.3357, 0.1022],
    [0.0789, -0.3366, 0.1051],
    [0.0638, -0.338, 0.1098],
    [0.0517, -0.3388, 0.1132],
    [0.0406, -0.3393, 0.1157],
    [0.037, -0.3394, 0.1165],
    [0.0173, -0.3397, 0.1196],
    [0.0106, -0.3397, 0.1202],
    [-0.0004, -0.3395, 0.1204],
    [-0.0112, -0.3392, 0.1197],
    [-0.0229, -0.3388, 0.1183],
    [-0.0311, -0.3385, 0.117],
    [-0.0423, -0.3379, 0.1148],
    [-0.0489, -0.3375, 0.1134],
    [-0.0661, -0.336, 0.1094],
    [-0.0785, -0.3346, 0.1064],
    [-0.0915, -0.333, 0.1035],
    [-0.1074, -0.331, 0.0994],
    [-0.1239, -0.3284, 0.0921],
    [-0.1368, -0.3266, 0.0816],
    [-0.1459, -0.3253, 0.069],
    [-0.1514, -0.3247, 0.0578],
    [-0.1573, -0.3242, 0.0422],
    [-0.161, -0.3237, 0.0275],
  ];
  const NECK_FRONT_Y = 0.205; // front-centre rim height of the untouched model

  type NeckCfg = { shape: "round" | "v" | "scoop"; depth: number; halfWidth: number; gate?: [number, number] };
  type ShirtCfg = {
    neck?: NeckCfg;
    body?: "oversized" | "slim" | "crop";
    sleeve?: number;       // sleeve length multiplier (1 = model default)
    rib?: number;          // radius of the ribbed neck band (0 = none)
    collar?: boolean;      // fold-over polo collar
    placket?: { length: number; buttons: number; width: number } | { slit: true; length: number };
    cuffRib?: boolean;
    stripes?: boolean;
  };
  const CREW: NeckCfg = { shape: "round", depth: 0.012, halfWidth: 0.082 };
  const SHIRT_CFG: Record<string, ShirtCfg> = {
    "crew-neck":   { neck: CREW, rib: 0.0085 },
    "v-neck":      { neck: { shape: "v", depth: 0.095, halfWidth: 0.083, gate: [-0.024, 0.008] }, rib: 0.0062 },
    "polo":        { neck: { shape: "round", depth: 0.028, halfWidth: 0.08 }, collar: true, placket: { length: 0.105, buttons: 2, width: 0.03 }, cuffRib: true },
    "henley":      { neck: { shape: "round", depth: 0.03, halfWidth: 0.08 }, rib: 0.0075, placket: { length: 0.13, buttons: 3, width: 0.032 } },
    "round-neck":  { neck: { shape: "round", depth: 0.026, halfWidth: 0.08 }, rib: 0.0058 },
    "scoop-neck":  { neck: { shape: "scoop", depth: 0.075, halfWidth: 0.098 }, rib: 0.0052 },
    "collar":      { neck: { shape: "round", depth: 0.02, halfWidth: 0.08 }, collar: true, placket: { slit: true, length: 0.085 } },
    "graphic":     { neck: CREW, rib: 0.0085 },
    "plain":       { neck: CREW, rib: 0.0085 },
    "striped":     { neck: CREW, rib: 0.0085, stripes: true },
    "oversized":   { neck: CREW, body: "oversized", sleeve: 1.5, rib: 0.0095 },
    "slim-fit":    { neck: CREW, body: "slim", rib: 0.0075 },
    "long-sleeve": { neck: CREW, sleeve: 3.4, rib: 0.0085, cuffRib: true },
    "crop":        { neck: CREW, body: "crop", rib: 0.0085 },
  };
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const isLight = () => {
    const c = new THREE.Color(curColor);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.35;
  };
  function updateExtraColors() {
    const light = isLight();
    const base = new THREE.Color(curColor);
    const cloth = base.clone().multiplyScalar(0.96);
    const rib = base.clone().multiplyScalar(light ? 0.9 : 1.12);
    const trim = base.clone().multiplyScalar(light ? 0.72 : 1.5);
    const button = new THREE.Color(light ? "#2b2b2b" : "#f4f4f4");
    const hole = new THREE.Color(light ? "#0c0c0c" : "#555555");
    extras.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const role = m.userData.role as string | undefined;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (role === "cloth") mat.color.copy(cloth);
      else if (role === "rib") mat.color.copy(rib);
      else if (role === "trim") mat.color.copy(trim);
      else if (role === "button") mat.color.copy(button);
      else if (role === "hole") mat.color.copy(hole);
    });
    stripeU.uStripeCol.value.set(light ? "#1a1f3a" : "#f4f4f4");
  }
  function clearExtras() {
    extras.children.slice().forEach((o) => {
      extras.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
  // Smooth normals for the deformed mesh. UV seams duplicate vertices, so normals are averaged across
  // vertices that shared a position in the original model; otherwise the seams would shade as hard lines.
  let weldGroups: Int32Array | null = null;
  function recomputeNormals(geo: THREE.BufferGeometry, base: Float32Array) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
    const index = geo.index;
    if (!nor || !index) return;
    const n = pos.count;
    if (!weldGroups) {
      const map = new Map<string, number>();
      weldGroups = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const k = `${Math.round(base[i * 3] * 1e4)},${Math.round(base[i * 3 + 1] * 1e4)},${Math.round(base[i * 3 + 2] * 1e4)}`;
        let g = map.get(k);
        if (g === undefined) { g = map.size; map.set(k, g); }
        weldGroups[i] = g;
      }
    }
    const groups = weldGroups;
    let maxG = 0;
    for (let i = 0; i < n; i++) if (groups[i] > maxG) maxG = groups[i];
    const sum = new Float32Array((maxG + 1) * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      const i0 = index.getX(t), i1 = index.getX(t + 1), i2 = index.getX(t + 2);
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      b.sub(a); c.sub(a); b.cross(c); // area-weighted face normal
      for (const i of [i0, i1, i2]) {
        const g = groups[i] * 3;
        sum[g] += b.x; sum[g + 1] += b.y; sum[g + 2] += b.z;
      }
    }
    for (let i = 0; i < n; i++) {
      const g = groups[i] * 3;
      const x = sum[g], y = sum[g + 1], z = sum[g + 2];
      const len = Math.hypot(x, y, z) || 1;
      // keep the model's own facing: flip if the recomputed normal points against the original
      let nx = x / len, ny = y / len, nz = z / len;
      if (nx * nor.getX(i) + ny * nor.getY(i) + nz * nor.getZ(i) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      nor.setXYZ(i, nx, ny, nz);
    }
    nor.needsUpdate = true;
  }
  function applyShirtType(id: string) {
    curType = id;
    const mesh = shirtMesh, base = basePos;
    if (!mesh || !base) return;
    const cfg = SHIRT_CFG[id] ?? SHIRT_CFG["crew-neck"];

    // One deformation for everything (mesh vertices and the measured rings).
    const deform = (x0: number, y0: number, z0: number): [number, number, number] => {
      let x = x0, y = y0, z = z0;
      const ax = Math.abs(x0);
      if (cfg.neck) {
        const { shape, depth, halfWidth } = cfg.neck;
        const u = Math.min(1, ax / halfWidth);
        const s = shape === "v" ? 1 - u : shape === "scoop" ? 1 - Math.pow(u, 2.6) : 1 - u * u;
        // only the front panel drops; the band below the rim blends out so the fabric never folds over
        const band = depth * 1.7 + 0.05;
        const fall = y0 >= NECK_FRONT_Y ? 1 : smooth(NECK_FRONT_Y - band, NECK_FRONT_Y, y0);
        const [g0, g1] = cfg.neck.gate ?? [-0.012, 0.03];
        y -= depth * s * smooth(g0, g1, z0) * fall;
      }
      // sleeves (everything outside the torso side seam): stretch down and narrow towards the cuff
      const k = cfg.sleeve ?? 1;
      if (k !== 1 && ax > 0.15) {
        const g = smooth(0.15, 0.19, ax) * smooth(0.14, 0.08, y0);
        const hang = Math.max(0, 0.1 - y0);
        y -= g * hang * (k - 1);
        if (k > 1.6) {
          const t = g * smooth(0.08, -0.02, y0);
          const sx = Math.sign(x0), xc = sx * 0.222;
          x = xc + (x - xc) * (1 - 0.2 * t);
          z = -0.03 + (z - -0.03) * (1 - 0.15 * t);
        }
      }
      if (cfg.body === "oversized") {
        x *= 1.16; z *= 1.14;
        if (y < 0.1) y -= (0.1 - y) * 0.1;
      } else if (cfg.body === "slim") {
        x *= 0.88; z *= 0.9;
      } else if (cfg.body === "crop" && y < -0.02) {
        y += (-0.02 - y) * 0.42 * (1 - smooth(0.15, 0.19, ax));
      }
      return [x, y, z];
    };

    const attr = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < base.length; i += 3) {
      const [x, y, z] = deform(base[i], base[i + 1], base[i + 2]);
      arr[i] = x; arr[i + 1] = y; arr[i + 2] = z;
    }
    attr.needsUpdate = true;
    recomputeNormals(mesh.geometry, base);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.updateMatrixWorld(true);

    /* ---- dress-up pieces ---- */
    clearExtras();
    const ray = new THREE.Raycaster();
    const frontZ = (x: number, y: number) => {
      ray.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(mesh)[0];
      return hit ? hit.point.z : 0.12;
    };
    const mat = (rough = 0.9) => new THREE.MeshStandardMaterial({
      roughness: rough, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const add = (geo: THREE.BufferGeometry, role: string, pos?: THREE.Vector3) => {
      const m = new THREE.Mesh(geo, mat(role === "button" ? 0.35 : 0.9));
      m.userData.role = role;
      if (pos) m.position.copy(pos);
      extras.add(m);
      return m;
    };
    const ringPts = (ring: [number, number, number][]) => ring.map(([x, y, z]) => new THREE.Vector3(...deform(x, y, z)));
    const tubeRib = (ring: [number, number, number][], r: number, lift = 0) => {
      const pts = ringPts(ring);
      if (lift) pts.forEach((p) => { p.y += lift; });
      const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
      add(new THREE.TubeGeometry(curve, ring.length * 5, r, 10, true), "rib");
    };
    // local surface frames along a ring: p = point, n = outward surface normal, u = direction along the cloth
    const dPos = attr.array as Float32Array;
    const dNor = (mesh.geometry.attributes.normal as THREE.BufferAttribute).array as Float32Array;
    const normalAt = (p: THREE.Vector3) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < dPos.length; i += 3) {
        const dx = dPos[i] - p.x, dy = dPos[i + 1] - p.y, dz = dPos[i + 2] - p.z;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < bd) { bd = dd; bi = i; }
      }
      return new THREE.Vector3(dNor[bi], dNor[bi + 1], dNor[bi + 2]).normalize();
    };
    const bodyC = new THREE.Vector3(0, -0.05, 0);
    const frames = (ring: [number, number, number][], away: "hole" | "up") => {
      const pts = ringPts(ring);
      const N = pts.length;
      const out = pts.map((p) => {
        const n = normalAt(p);
        if (n.dot(p.clone().sub(bodyC)) < 0) n.negate();
        return { p, n, u: new THREE.Vector3() };
      });
      const holeC = new THREE.Vector3(0, 0.235, 0.002);
      let score = 0;
      out.forEach((f, i) => {
        const t = out[(i + 1) % N].p.clone().sub(out[(i - 1 + N) % N].p).normalize();
        f.u.crossVectors(f.n, t).normalize();
        score += away === "hole" ? f.u.dot(f.p.clone().sub(holeC).normalize()) : f.u.y;
      });
      if (score < 0) out.forEach((f) => f.u.negate());
      if (away === "up") {
        // hems / cuffs: pick the side that really has cloth, i.e. the one whose offset points stay close to the mesh
        const nearest = (q: THREE.Vector3) => {
          let bd = Infinity;
          for (let i = 0; i < dPos.length; i += 3) {
            const dx = dPos[i] - q.x, dy = dPos[i + 1] - q.y, dz = dPos[i + 2] - q.z;
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < bd) bd = dd;
          }
          return Math.sqrt(bd);
        };
        let plus = 0, minus = 0;
        for (let i = 0; i < N; i += 2) {
          plus += nearest(out[i].p.clone().addScaledVector(out[i].u, 0.012));
          minus += nearest(out[i].p.clone().addScaledVector(out[i].u, -0.012));
        }
        if (minus < plus) out.forEach((f) => f.u.negate());
      }
      return out;
    };
    const loopTube = (pts: THREE.Vector3[], r: number, role: string) => {
      const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
      add(new THREE.TubeGeometry(curve, pts.length * 4, r, 6, true), role);
    };
    /** flat ribbed collar band lying on the fabric: folded inner lip, flat band, stitched outer edge */
    const flatRib = (ring: [number, number, number][], w: number) => {
      const fr = frames(ring, "hole");
      const N = fr.length;
      const pos: number[] = [], idx: number[] = [];
      fr.forEach(({ p, n, u }) => {
        const a = p.clone().addScaledVector(n, 0.0012);
        const b = p.clone().addScaledVector(u, w).addScaledVector(n, 0.0016);
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      });
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = ((i + 1) % N) * 2;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      add(g, "rib");
      loopTube(fr.map(({ p, n }) => p.clone().addScaledVector(n, 0.0007)), 0.0019, "rib"); // folded lip
      loopTube(fr.map(({ p, u, n }) => p.clone().addScaledVector(u, w).addScaledVector(n, 0.0018)), 0.00065, "trim"); // stitch
    };
    /** double-needle topstitch at the given distances from a hem / cuff edge */
    // (kept for later use; not called so no stitch lines are drawn)
    const stitch = (ring: [number, number, number][], offsets: number[]) => {
      const fr = frames(ring, "up");
      offsets.forEach((o) => loopTube(fr.map(({ p, u, n }) => p.clone().addScaledVector(u, o).addScaledVector(n, 0.001)), 0.0006, "trim"));
    };
    /** a strip that hugs the chest: columns x0..x1, rows from yTop down to yBot */
    const chestStrip = (x0: number, x1: number, yTop: number, yBot: number, lift: number) => {
      const nx = 2, ny = 24;
      const p: number[] = [], idx: number[] = [];
      for (let j = 0; j <= ny; j++) {
        const y = yTop + ((yBot - yTop) * j) / ny;
        for (let i = 0; i <= nx; i++) {
          const x = x0 + ((x1 - x0) * i) / nx;
          p.push(x, y, frontZ(x, y) + lift);
        }
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const slopeAt = (y: number) => (frontZ(0, y + 0.01) - frontZ(0, y - 0.01)) / 0.02; // dz/dy of the chest

    // ribbed neck band
    if (cfg.rib) flatRib(NECK_RING, cfg.rib * 1.5);
    // ribbed sleeve cuffs (polo / long sleeve only); plain sleeves and hem stay clean, no stitch lines
    if (cfg.cuffRib) { tubeRib(CUFF_RING_R, 0.0072); tubeRib(CUFF_RING_L, 0.0072); }

    // fold-over collar: stand band round back + sides, two pointed flaps on the chest
    const neckPts = ringPts(NECK_RING);
    const frontRimY = deform(0, NECK_FRONT_Y, 0.07)[1];
    if (cfg.collar) {
      const cz = 0.002;
      const pos: number[] = [], idx: number[] = [];
      const rows: THREE.Vector3[][] = [];
      // sort ring by angle so the band is a clean loop
      const ordered = neckPts.map((v) => ({ v, a: Math.atan2(v.x, -(v.z - cz)) })).sort((a, b) => a.a - b.a); // cut at front-centre
      const back = ordered.filter((o) => o.v.z < 0.04 || Math.abs(o.v.x) > 0.045);
      back.forEach(({ v }) => {
        const nrm = new THREE.Vector2(v.x, v.z - cz).normalize();
        rows.push([
          new THREE.Vector3(v.x + nrm.x * 0.002, v.y - 0.001, v.z + nrm.y * 0.002),
          new THREE.Vector3(v.x + nrm.x * 0.011, v.y + 0.022, v.z + nrm.y * 0.011),
        ]);
      });
      rows.forEach((r) => r.forEach((v) => pos.push(v.x, v.y, v.z)));
      for (let i = 0; i < rows.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      add(g, "cloth");
      // flaps
      const tipY = frontRimY - 0.047;
      for (const s of [-1, 1]) {
        const ringY = (x: number) => {
          let best = neckPts[0], bd = 9;
          for (const v of neckPts) { const d = Math.abs(v.x - s * x) + (v.z < 0.01 ? 1 : 0); if (d < bd) { bd = d; best = v; } }
          return best.y;
        };
        const poly: [number, number][] = [
          [s * 0.004, frontRimY + 0.004],
          [s * 0.03, ringY(0.03) + 0.004],
          [s * 0.058, ringY(0.058) + 0.006],
          [s * 0.082, 0.252],
          [s * 0.089, 0.236],
          [s * 0.081, tipY + 0.026],
          [s * 0.064, tipY],
          [s * 0.03, frontRimY - 0.022],
        ];
        const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
        const sg = new THREE.ShapeGeometry(shape);
        const sp = sg.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < sp.count; i++) sp.setZ(i, frontZ(sp.getX(i), sp.getY(i)) + 0.0042);
        sg.computeVertexNormals();
        add(sg, "cloth");
        // fold-edge: a thin tube along the collar's lower edge gives it thickness
        const edge = [poly[3], poly[4], poly[5], poly[6], poly[7]].map(([x, y]) => new THREE.Vector3(x, y, frontZ(x, y) + 0.0045));
        add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, false, "centripetal"), 30, 0.0021, 6, false), "trim");
      }
    }

    // placket, stitching, buttons
    const pk = cfg.placket;
    if (pk) {
      const top = frontRimY - 0.001;
      if ("slit" in pk) {
        add(chestStrip(-0.0016, 0.0016, top, top - pk.length, 0.0042), "trim");
      } else {
        const w = pk.width, len = pk.length, bot = top - len;
        add(chestStrip(-w / 2, w / 2, top, bot, 0.0028), "cloth");
        for (const s of [-1, 1]) add(chestStrip(s * (w / 2 - 0.0018), s * (w / 2 - 0.0007), top, bot, 0.0034), "trim");
        add(chestStrip(-w / 2, w / 2, bot + 0.0035, bot + 0.0023, 0.0034), "trim"); // bar-tack at the bottom
        for (let b = 0; b < pk.buttons; b++) {
          const by = top - len * ((b + 0.7) / (pk.buttons + 0.15)) + (pk.buttons === 2 ? 0.0 : 0.002);
          const bz = frontZ(0, by) + 0.0042;
          const tilt = Math.atan(slopeAt(by));
          const grp = new THREE.Group();
          grp.position.set(0, by, bz);
          grp.rotation.x = tilt;
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.0078, 0.0078, 0.0028, 28), mat(0.35));
          disc.userData.role = "button"; disc.rotation.x = Math.PI / 2; grp.add(disc);
          const dish = new THREE.Mesh(new THREE.TorusGeometry(0.0054, 0.0007, 8, 24), mat(0.35));
          dish.userData.role = "button"; dish.position.z = 0.0015; grp.add(dish);
          for (const [hx, hy] of [[-0.0022, -0.0022], [0.0022, -0.0022], [-0.0022, 0.0022], [0.0022, 0.0022]]) {
            const h = new THREE.Mesh(new THREE.CylinderGeometry(0.00085, 0.00085, 0.0008, 8), mat(0.5));
            h.userData.role = "hole"; h.rotation.x = Math.PI / 2; h.position.set(hx, hy, 0.0016); grp.add(h);
          }
          extras.add(grp);
        }
      }
    }
    void stitch;
    stripeU.uStripe.value = cfg.stripes ? 1 : 0;
    updateExtraColors();
    buildDecals();
    renderShirtRef();
  }

    new GLTFLoader().load(
    "/shirt.glb",
    (gltf) => {
      if (disposed) return;
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      if (!mesh) { ev.current.onError("Shirt mesh not found"); return; }
      const shirt: THREE.Mesh = mesh;
      shirtMat = shirt.material as THREE.MeshStandardMaterial;
      shirtMat.color.set(curColor);
      shirtMat.roughness = 0.82;
      shirtMat.metalness = 0;
      shirtMat.envMapIntensity = 0.9;
      // the model ships a blotchy baked AO map that smears the back panel; tone it down
      shirtMat.aoMapIntensity = 0.12;
      // horizontal stripes (toggled by the "striped" shirt type) drawn in object space
      shirtMat.onBeforeCompile = (shader) => {
        shader.uniforms.uStripe = stripeU.uStripe;
        shader.uniforms.uStripeCol = stripeU.uStripeCol;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying float vObjY;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjY = position.y;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vObjY;\nuniform float uStripe;\nuniform vec3 uStripeCol;")
          .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uStripeCol, uStripe * step(0.5, fract(vObjY * 32.0)));");
      };
      scene.add(gltf.scene);
      gltf.scene.updateMatrixWorld(true);
      shirtRoot = gltf.scene;

      const addDecal = (k: Side) => {
        const z = ZONES[k];
        const ray = new THREE.Raycaster(
          new THREE.Vector3(z.x + z.nx * 1.2, z.y + z.ny * 1.2, z.nz * 1.2),
          new THREE.Vector3(-z.nx, -z.ny, -z.nz),
        );
        const hit = ray.intersectObject(shirt)[0];
        const p = hit ? hit.point : new THREE.Vector3(z.x, z.y, z.back ? -0.117 : 0.133);
        const rotY = k === "back" ? Math.PI : 0;
        const geo = new DecalGeometry(
          shirt, p, new THREE.Euler(0, rotY, z.tilt), new THREE.Vector3(z.dw, z.dh, 0.2),
        );
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            map: tex[k], transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
            polygonOffset: true, polygonOffsetFactor: -4,
          }),
        );
        m.visible = !plain;
        decals.push(m);
        scene.add(m);
      };
      shirtMesh = shirt;
      basePos = new Float32Array((shirt.geometry.attributes.position as THREE.BufferAttribute).array as ArrayLike<number>);
      buildDecals = () => {
        decals.splice(0).forEach((m) => {
          scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        });
        SIDES.forEach((k) => addDecal(k));
      };
      gltf.scene.add(extras);
      applyShirtType(curType);
      renderShirtRef();
      ev.current.onReady();
    },
    undefined,
    (err) => { console.error(err); ev.current.onError("Model failed to load"); },
  );

  /* ---------------- public actions ---------------- */
  function setSide(s: Side) {
    side = s;
    SIDES.forEach((k) => {
      wrap(fc[k]).style.display = k === s ? "" : "none";
      fc[k].discardActiveObject();
      fc[k].renderAll();
    });
    goCam(ZONES[s].az, ZONES[s].zoom, ZONES[s].camY);
    placeRefImg();
    emitHist();
    emitSel();
  }

  function setColor(hex: string) {
    curColor = hex;
    shirtMat?.color.set(hex);
    updateExtraColors();
    renderShirtRef();
  }

  async function loadProject(project: EngineProject) {
    lock = true;
    try {
      await Promise.all(SIDES.map((k) => fc[k].loadFromJSON(project[k])));
      setColor(project.color);
      SIDES.forEach((k) => {
        fc[k].discardActiveObject();
        fc[k].renderAll();
        hist[k].s = [JSON.stringify(fc[k].toObject(EXTRA))];
        hist[k].i = 0;
      });
      setSide(project.side);
    } finally {
      lock = false;
    }
  }

  function addImageFile(f: File, at?: { x: number; y: number }) {
    if (!/^image\//.test(f.type)) return;
    const r = new FileReader();
    r.onload = async () => {
      if (typeof r.result !== "string") {
        ev.current.onError("Image file could not be read");
        return;
      }
      const src = r.result;
      let img: fabric.Image;
      try {
        img = await fabric.Image.fromURL(src);
      } catch (error) {
        console.error(error);
        ev.current.onError("Image failed to load");
        return;
      }
      (img as ArtObj)._orig = src;
      (img as ArtObj)._fileName = f.name;
      const s = Math.min((CW * 0.45) / (img.width ?? 1), (ZONES[side].ch * 0.45) / (img.height ?? 1));
      img.scale(s);
      const c = fc[side];
      c.add(img);
      img.set({
        left: at ? Math.max(0, Math.min(CW, at.x)) : CW / 2,
        top: at ? Math.max(0, Math.min(ZONES[side].ch, at.y)) : ZONES[side].ch / 2,
        originX: "center",
        originY: "center",
      });
      img.setCoords();
      c.setActiveObject(img);
      c.renderAll();
      ev.current.onToast("Artwork added");
    };
    r.onerror = () => {
      console.error(r.error);
      ev.current.onError("Image file could not be read");
    };
    r.readAsDataURL(f);
  }

  function replaceSelectedImage(file: File) {
    const target = activeImg();
    if (!target) {
      ev.current.onToast("Select an image to replace");
      return;
    }
    if (!/^image\//.test(file.type)) {
      ev.current.onError("Choose a valid image file");
      return;
    }
    const canvas = target.canvas;
    if (!canvas) {
      ev.current.onError("Selected image is no longer available");
      return;
    }
    const width = Math.max(target.getScaledWidth(), 1);
    const height = Math.max(target.getScaledHeight(), 1);
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") {
        ev.current.onError("Replacement image could not be read");
        return;
      }
      try {
        const image = target as unknown as fabric.Image;
        await image.setSrc(reader.result);
        if (target.canvas !== canvas) return;
        const scale = Math.min(width / (image.width ?? 1), height / (image.height ?? 1));
        target.set({ scaleX: scale, scaleY: scale });
        target.setCoords();
        const artwork = target as ArtObj;
        artwork._orig = reader.result;
        artwork._key = null;
        artwork._fileName = file.name;
        canvas.requestRenderAll();
        snap(sideOf(canvas));
        emitSel();
        ev.current.onToast("Image replaced");
      } catch (error) {
        console.error(error);
        ev.current.onError("Replacement image could not be loaded");
      }
    };
    reader.onerror = () => {
      console.error(reader.error);
      ev.current.onError("Replacement image could not be read");
    };
    reader.readAsDataURL(file);
  }

  function addText(text: string, font: string, color: string, at?: { x: number; y: number }) {
    const c = fc[side];
    const t = new fabric.IText(text || "Text", {
      left: at ? Math.max(0, Math.min(CW, at.x)) : CW / 2,
      top: at ? Math.max(0, Math.min(ZONES[side].ch, at.y)) : ZONES[side].ch / 2,
      originX: "center",
      originY: "center",
      fontFamily: font, fontSize: 60, fill: color,
    });
    c.add(t);
    c.setActiveObject(t);
    c.renderAll();
  }

  function deleteSelected() {
    const c = fc[side];
    const objs = c.getActiveObjects();
    if (!objs.length) { ev.current.onToast("Select a design first"); return; }
    objs.forEach((o) => c.remove(o));
    c.discardActiveObject();
    c.renderAll();
  }

  const redraw = () => fc[side].requestRenderAll();

  /* background remove */
  const bg = { tol: 25, contig: true, pick: false, busy: false };
  async function applyBg(o: ArtObj) {
    if (!o._key || !o._orig) return;
    try {
      const url = await removeBackground(o._orig, o._key, bg.tol, bg.contig);
      const dispW = o.getScaledWidth();
      const c = o.canvas as fabric.Canvas | undefined;
      await (o as unknown as fabric.Image).setSrc(url);
      o.scaleToWidth(dispW);
      o.setCoords();
      c?.requestRenderAll();
      if (c) snap(sideOf(c));
      ev.current.onBgMessage("Background removed. Adjust with the tolerance slider.");
    } catch (error) {
      console.error(error);
      ev.current.onError("Could not remove the image background");
    }
  }
  const activeImg = () => { const o = active(); return o && o.type === "image" ? o : null; };

  SIDES.forEach((k) =>
    fc[k].on("mouse:down", (e) => {
      if (!bg.pick) return;
      const c = fc[k];
      const o = e.target && e.target.type === "image" ? (e.target as ArtObj) : null;
      if (!o) { ev.current.onToast("Tap on the image"); return; }
      const p = c.getScenePoint(e.e);
      const rs = retina(c);
      const px = c.getElement().getContext("2d")!.getImageData(Math.round(p.x * rs), Math.round(p.y * rs), 1, 1).data;
      if (px[3] < 10) { ev.current.onToast("That spot is already transparent"); return; }
      bg.pick = false;
      o._key = [px[0], px[1], px[2]];
      c.setActiveObject(o);
      void applyBg(o);
    }),
  );

  /* ---------------- render loop ---------------- */
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (camAnim && camAnim(performance.now())) camAnim = null;
    controls.update();
    renderer.render(scene, camera);
  };
  resize();
  fit();
  emitHist();
  loop();

  return {
    setSide,
    resetView: () => goCam(ZONES[side].az, ZONES[side].zoom ?? 1.9, ZONES[side].camY),
    setColor,
    setShirtType: applyShirtType,
    setPlain: (on) => { plain = on; decals.forEach((m) => (m.visible = !on)); },
    setSpin: (on) => { controls.autoRotate = on; },
    fit,
    addImageFile,
    replaceSelectedImage,
    addText,
    deleteSelected,
    undo: () => { const h = hist[side]; if (h.i > 0) restore(side, h.i - 1); },
    redo: () => { const h = hist[side]; if (h.i < h.s.length - 1) restore(side, h.i + 1); },
    exportPng: () => {
      if (!shirtMat) return null;
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    },
    setText: (v) => { const o = active(); if (o) { o.set("text" as keyof fabric.Object, v as never); redraw(); } },
    setFill: (v) => { const o = active(); if (o) { o.set("fill", v); redraw(); } },
    setFont: (v) => { const o = active(); if (o) { o.set("fontFamily" as keyof fabric.Object, v as never); redraw(); snap(side); } },
    setOpacity: (v) => { const o = active(); if (o) { o.set("opacity", v / 100); redraw(); } },
    setAngle: (degrees) => {
      const o = active();
      if (!o) return;
      o.set("angle", degrees);
      o.setCoords();
      redraw();
      emitSel();
    },
    setGeometry: (values) => {
      const o = active();
      if (!o) return;
      const width = Math.max(o.getScaledWidth(), 1);
      const height = Math.max(o.getScaledHeight(), 1);
      const center = o.getCenterPoint();
      o.set({
        originX: "center",
        originY: "center",
        left: values.x ?? center.x,
        top: values.y ?? center.y,
        scaleX: (o.scaleX ?? 1) * (Math.max(values.width ?? width, 1) / width),
        scaleY: (o.scaleY ?? 1) * (Math.max(values.height ?? height, 1) / height),
      });
      o.setCoords();
      redraw();
      emitSel();
    },
    commit: () => snap(side),
    align: (position) => {
      const o = active(), c = fc[side];
      if (!o) return;
      const bounds = o.getBoundingRect();
      const center = o.getCenterPoint();
      let x = center.x;
      let y = center.y;
      if (position === "left") x -= bounds.left;
      if (position === "centerX") x += CW / 2 - (bounds.left + bounds.width / 2);
      if (position === "right") x += CW - bounds.left - bounds.width;
      if (position === "top") y -= bounds.top;
      if (position === "centerY") y += ZONES[side].ch / 2 - (bounds.top + bounds.height / 2);
      if (position === "bottom") y += ZONES[side].ch - bounds.top - bounds.height;
      o.set({ originX: "center", originY: "center", left: x, top: y });
      o.setCoords();
      c.requestRenderAll();
      snap(side);
      emitSel();
    },
    mirror: () => { const o = active(); if (o) { o.set("flipX", !o.flipX); redraw(); snap(side); } },
    flipVertical: () => { const o = active(); if (o) { o.set("flipY", !o.flipY); redraw(); snap(side); } },
    toggleLock: () => {
      const o = active();
      if (!o) return;
      const locked = Boolean(o.lockMovementX && o.lockMovementY && o.lockScalingX && o.lockScalingY && o.lockRotation);
      const next = !locked;
      o.set({
        lockMovementX: next,
        lockMovementY: next,
        lockScalingX: next,
        lockScalingY: next,
        lockRotation: next,
      });
      redraw();
      snap(side);
      emitSel();
    },
    center: () => { const o = active(); if (o) { fc[side].centerObject(o); o.setCoords(); redraw(); snap(side); } },
    zoomIn: () => {
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * 0.85, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    zoomOut: () => {
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * 1.18, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    duplicate: () => {
      const o = active(), c = fc[side];
      if (!o) return;
      void o.clone(EXTRA).then((cl) => {
        cl.set({ left: (o.left ?? 0) + 30, top: (o.top ?? 0) + 30 });
        c.discardActiveObject();
        c.add(cl);
        c.setActiveObject(cl);
        c.requestRenderAll();
      }).catch((error: unknown) => {
        console.error(error);
        ev.current.onError("Could not duplicate design");
      });
    },
    forward: () => { const o = active(); if (o) { fc[side].bringObjectForward(o); snap(side); } },
    backward: () => { const o = active(); if (o) { fc[side].sendObjectBackwards(o); snap(side); } },
    getOriginalImages: () => {
      const seen: Record<Side, Set<string>> = { front: new Set(), back: new Set() };
      const images: OriginalArtwork[] = [];
      SIDES.forEach((k) => {
        fc[k].getObjects().forEach((object) => {
          const image = object as ArtObj;
          if (image.type !== "image" || !image._orig || seen[k].has(image._orig)) return;
          seen[k].add(image._orig);
          const mimeSubtype = /^data:image\/([^;,]+)/i.exec(image._orig)?.[1]?.replace("jpeg", "jpg") ?? "png";
          images.push({
            side: k,
            fileName: image._fileName || `artwork-${images.length + 1}.${mimeSubtype}`,
            dataUrl: image._orig,
          });
        });
      });
      return images;
    },
    exportSideViews: () => {
      if (!shirtMat) return null;
      const originalPosition = camera.position.clone();
      const originalQuaternion = camera.quaternion.clone();
      const originalLightPosition = key.position.clone();
      const radius = Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
      const views = {} as Record<Side, string>;
      try {
        SIDES.forEach((k) => {
          const zone = ZONES[k];
          const r = zone.zoom ?? radius;
          key.position.z = zone.back ? -3 : 3;
          camera.position.set(
            controls.target.x + Math.sin(zone.az) * r,
            zone.camY,
            controls.target.z + Math.cos(zone.az) * r,
          );
          camera.lookAt(controls.target);
          camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          views[k] = renderer.domElement.toDataURL("image/png");
        });
        return views;
      } finally {
        camera.position.copy(originalPosition);
        camera.quaternion.copy(originalQuaternion);
        key.position.copy(originalLightPosition);
        camera.updateMatrixWorld(true);
      }
    },
    exportProject: () => ({
      side,
      color: curColor,
      front: JSON.stringify(fc.front.toObject(EXTRA)),
      back: JSON.stringify(fc.back.toObject(EXTRA)),
    }),
    loadProject,
    bgAuto: async () => {
      const o = activeImg();
      if (!o || !o._orig) { ev.current.onBgMessage("Select an image in the placement box first."); return; }
      const keyCol = await sampleCornerColor(o._orig);
      if (!keyCol) { ev.current.onBgMessage("The corners are already transparent, nothing to remove."); return; }
      o._key = keyCol;
      await applyBg(o);
    },
    bgPick: () => {
      if (!activeImg()) { ev.current.onBgMessage("Select an image in the placement box first."); return; }
      bg.pick = true;
      ev.current.onBgMessage("Now tap the background color on the image.");
    },
    bgReset: () => {
      const o = activeImg();
      if (!o || !o._orig) { ev.current.onBgMessage("Select an image first."); return; }
      const dispW = o.getScaledWidth();
      const c = o.canvas as fabric.Canvas | undefined;
      o._key = null;
      void (o as unknown as fabric.Image).setSrc(o._orig).then(() => {
        o.scaleToWidth(dispW);
        o.setCoords();
        c?.requestRenderAll();
        if (c) snap(sideOf(c));
        ev.current.onBgMessage("Original image restored.");
      }).catch((error: unknown) => {
        console.error(error);
        ev.current.onError("Could not restore the original image");
      });
    },
    bgRetune: (tol, contig) => {
      bg.tol = tol;
      bg.contig = contig;
      const o = activeImg();
      if (!o || !o._key || bg.busy) return;
      bg.busy = true;
      requestAnimationFrame(async () => { await applyBg(o); bg.busy = false; });
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      roView.disconnect();
      roPlace.disconnect();
      controls.dispose();
      SIDES.forEach((k) => { tex[k].dispose(); fc[k].dispose(); });
      stage.replaceChildren();
      refImg.remove();
      refRT?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}