import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import * as fabric from "fabric";
import { removeBackground, sampleCornerColor, type RGB } from "./bgRemove";

export type Side = "front" | "back";

export interface SelInfo {
  kind: "text" | "image";
  text: string;
  fill: string;
  font: string;
  opacity: number;
}

export interface EngineEvents {
  onSelection(info: SelInfo | null): void;
  onHistory(canUndo: boolean, canRedo: boolean): void;
  onToast(msg: string): void;
  onBgMessage(msg: string): void;
  onReady(): void;
  onError(msg: string): void;
}

type ArtObj = fabric.Object & { _orig?: string; _key?: RGB | null };

export interface Engine {
  setSide(s: Side): void;
  resetView(): void;
  setColor(hex: string): void;
  setPlain(on: boolean): void;
  setSpin(on: boolean): void;
  fit(): void;
  addImageFile(f: File): void;
  addText(text: string, font: string, color: string): void;
  deleteSelected(): void;
  undo(): void;
  redo(): void;
  exportPng(): string | null;
  // edit selected
  setText(v: string): void;
  setFill(v: string): void;
  setFont(v: string): void;
  setOpacity(v: number): void;
  commit(): void;
  mirror(): void;
  center(): void;
  duplicate(): void;
  forward(): void;
  backward(): void;
  bgAuto(): Promise<void>;
  bgPick(): void;
  bgReset(): void;
  bgRetune(tol: number, contig: boolean): void;
  dispose(): void;
}

const DW = 0.2, DH = 0.233; // print area size in model units
export const CW = 600;
export const CH = Math.round((CW * DH) / DW);
const EXTRA = ["_orig", "_key"];
const FRONT_AZ = 0.08, BACK_AZ = Math.PI + 0.08;

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

  const makeEditor = () => {
    const el = document.createElement("canvas");
    stage.appendChild(el);
    return new fabric.Canvas(el, { width: CW, height: CH, preserveObjectStacking: true });
  };
  const fc: Record<Side, fabric.Canvas> = { front: makeEditor(), back: makeEditor() };
  wrap(fc.back).style.display = "none";

  // The visible fabric canvas also contains selection handles, so the 3D texture is
  // fed from a separate offscreen canvas rendered without any controls.
  const TEX_SCALE = 2;
  const tex = {} as Record<Side, THREE.CanvasTexture>;
  (["front", "back"] as Side[]).forEach((k) => {
    const cv = document.createElement("canvas");
    cv.width = CW * TEX_SCALE;
    cv.height = CH * TEX_SCALE;
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
  fc.front.add(new fabric.IText("MOCKWEAR", {
    left: CW / 2, top: CH / 2 - 30, originX: "center", originY: "center",
    fontFamily: "Impact", fontSize: 96, fill: "#111111",
  }));
  fc.front.add(new fabric.IText("est. 2026", {
    left: CW / 2, top: CH / 2 + 60, originX: "center", originY: "center",
    fontFamily: "Georgia", fontSize: 48, fill: "#e11d48",
  }));
  fc.front.renderAll();

  function fit() {
    const r = place.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return;
    const s = Math.min((r.width - 36) / CW, (r.height - 56) / CH);
    (["front", "back"] as Side[]).forEach((k) =>
      fc[k].setDimensions(
        { width: `${Math.floor(CW * s)}px`, height: `${Math.floor(CH * s)}px` },
        { cssOnly: true },
      ),
    );
  }
  const roPlace = new ResizeObserver(fit);
  roPlace.observe(place);

  /* ---------------- undo / redo ---------------- */
  const hist: Record<Side, { s: string[]; i: number }> = {
    front: { s: [], i: -1 },
    back: { s: [], i: -1 },
  };
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
    };
  }
  function emitSel() { ev.current.onSelection(readSel()); }

  (["front", "back"] as Side[]).forEach((k) => {
    snap(k);
    (["object:added", "object:modified", "object:removed", "text:changed"] as const).forEach((n) =>
      fc[k].on(n, () => snap(k)),
    );
    (["selection:created", "selection:updated", "selection:cleared"] as const).forEach((n) =>
      fc[k].on(n, emitSel),
    );
  });

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

      const addDecal = (k: Side) => {
        const back = k === "back", y = 0.03;
        const ray = new THREE.Raycaster(
          new THREE.Vector3(0, y, back ? -1 : 1),
          new THREE.Vector3(0, 0, back ? 1 : -1),
        );
        const hit = ray.intersectObject(shirt)[0];
        const p = hit ? hit.point : new THREE.Vector3(0, y, back ? -0.117 : 0.133);
        const geo = new DecalGeometry(shirt, p, new THREE.Euler(0, back ? Math.PI : 0, 0), new THREE.Vector3(DW, DH, 0.1));
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
      addDecal("front");
      addDecal("back");
      ev.current.onReady();
    },
    undefined,
    (err) => { console.error(err); ev.current.onError("Model failed to load"); },
  );

  /* ---------------- public actions ---------------- */
  function setSide(s: Side) {
    side = s;
    wrap(fc.front).style.display = s === "front" ? "" : "none";
    wrap(fc.back).style.display = s === "back" ? "" : "none";
    goCam(s === "front" ? FRONT_AZ : BACK_AZ, null, 0.02);
    fc.front.discardActiveObject();
    fc.front.renderAll();
    fc.back.discardActiveObject();
    fc.back.renderAll();
    emitHist();
    emitSel();
  }

  function setColor(hex: string) {
    curColor = hex;
    shirtMat?.color.set(hex);
    stage.querySelectorAll<HTMLElement>(".canvas-container").forEach((e) => { e.style.background = hex; });
  }

  function addImageFile(f: File) {
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
      const s = Math.min((CW * 0.7) / (img.width ?? 1), (CH * 0.7) / (img.height ?? 1));
      img.scale(s);
      const c = fc[side];
      c.add(img);
      c.centerObject(img);
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

  function addText(text: string, font: string, color: string) {
    const c = fc[side];
    const t = new fabric.IText(text || "Text", {
      left: CW / 2, top: CH / 2, originX: "center", originY: "center",
      fontFamily: font, fontSize: 90, fill: color,
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
      if (c) snap(c === fc.front ? "front" : "back");
      ev.current.onBgMessage("Background removed. Adjust with the tolerance slider.");
    } catch (error) {
      console.error(error);
      ev.current.onError("Could not remove the image background");
    }
  }
  const activeImg = () => { const o = active(); return o && o.type === "image" ? o : null; };

  (["front", "back"] as Side[]).forEach((k) =>
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
    resetView: () => goCam(side === "front" ? FRONT_AZ : BACK_AZ, 1.9, 0.02),
    setColor,
    setPlain: (on) => { plain = on; decals.forEach((m) => (m.visible = !on)); },
    setSpin: (on) => { controls.autoRotate = on; },
    fit,
    addImageFile,
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
    commit: () => snap(side),
    mirror: () => { const o = active(); if (o) { o.set("flipX", !o.flipX); redraw(); snap(side); } },
    center: () => { const o = active(); if (o) { fc[side].centerObject(o); o.setCoords(); redraw(); snap(side); } },
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
        if (c) snap(c === fc.front ? "front" : "back");
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
      disposed = true;``
      cancelAnimationFrame(raf);
      roView.disconnect();
      roPlace.disconnect();
      controls.dispose();
      (["front", "back"] as Side[]).forEach((k) => { tex[k].dispose(); fc[k].dispose(); });
      stage.replaceChildren();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}