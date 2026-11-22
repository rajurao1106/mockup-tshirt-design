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
    fc[k].on("after:render", () => {
      if (busy) return;
      busy = true;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(fc[k].toCanvasElement(TEX_SCALE), 0, 0);
      t.needsUpdate = true;
      busy = false;
    });
  });

  let side: Side = "front";
  let renderShirtRef: () => void = () => {};
  fc.front.add(new fabric.IText("YOUR DESIGN", {
    left: CW / 2, top: 200, originX: "center", originY: "center",
    fontFamily: "Impact", fontSize: 64, fill: "#111111",
  }));
  fc.front.add(new fabric.IText("est. 2026", {
    left: CW / 2, top: 262, originX: "center", originY: "center",
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
      SIDES.forEach((k) => addDecal(k));
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