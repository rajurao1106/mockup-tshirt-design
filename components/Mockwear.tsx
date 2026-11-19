"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CW, createEngine, SIDES, ZONES, type Engine, type EngineEvents, type SelInfo, type Side } from "@/lib/engine";
import { DESIGN_CATEGORIES, type CatalogDesign } from "@/lib/designCatalog";
import { Icon, type IconName } from "./icons";

type SheetName = "color" | "add" | "edit" | "order";
type ToolName = SheetName | "designs" | "print" | "flip" | "plain" | "spin";

const SWATCHES = ["#efede8", "#1a1a1a", "#3d3d3a", "#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#9ca3af", "#0f766e"];
const FONTS = ["Impact", "Georgia", "Courier New", "Arial", "Trebuchet MS"];
const TOOLS: { name: ToolName; label: string; icon: IconName }[] = [
  { name: "color", label: "Color", icon: "color" },
  { name: "add", label: "Add", icon: "add" },
  { name: "designs", label: "Designs", icon: "add" },
  { name: "print", label: "Print", icon: "print" },
  { name: "edit", label: "Edit", icon: "edit" },
  { name: "flip", label: "Flip", icon: "flip" },
  { name: "plain", label: "Plain", icon: "plain" },
  { name: "spin", label: "Spin", icon: "spin" },
];
const SHEET_TITLE: Record<SheetName, string> = {
  color: "Shirt color",
  add: "Add design",
  edit: "Edit selected",
  order: "Confirm mockup order",
};

/* ---------- small UI helpers ---------- */
const btn =
  "rounded-[10px] border border-[#3a3a36] bg-[#2a2a27] px-3.5 py-2 text-[13px] font-semibold text-[#f1f0ea] transition hover:bg-[#34342f]";
const btnPri = "rounded-[10px] border border-white bg-white px-3.5 py-2 text-[13px] font-semibold text-[#111] transition hover:bg-[#e8e8e2]";
const input =
  "min-w-0 rounded-[10px] border border-[#3a3a36] bg-[#111110] px-3 py-2 text-sm text-[#f1f0ea] outline-none focus:border-white/60";
const colorInput = "size-[38px] cursor-pointer rounded-[10px] border border-white/20 bg-transparent p-0";

function IconBtn({ title, onClick, disabled, on, children }: {
  title: string; onClick: () => void; disabled?: boolean; on?: boolean; children: ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-[38px] place-items-center rounded-full transition disabled:cursor-default disabled:opacity-35 ${
        on ? "bg-white text-[#111]" : "bg-[#242422] text-[#f1f0ea] hover:bg-[#30302d]"
      }`}
    >
      {children}
    </button>
  );
}

const SecTitle = ({ children }: { children: ReactNode }) => (
  <p className="mb-2 text-[11px] uppercase tracking-[.12em] text-[#9a9a90]">{children}</p>
);
const Sep = () => <div className="my-3.5 h-px bg-[#33332f]" />;

/* ================= main component ================= */
export default function Mockwear() {
  const viewRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const eng = useRef<Engine | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("front");
  const [color, setColor] = useState(SWATCHES[0]);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [printOn, setPrintOn] = useState(true);
  const [plain, setPlain] = useState(false);
  const [spin, setSpin] = useState(false);
  const [gridOn, setGridOn] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [sel, setSel] = useState<SelInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bgMsg, setBgMsg] = useState("Select an image, then tap Auto remove.");
  const [dragOver, setDragOver] = useState(false);
  const [placeDragOver, setPlaceDragOver] = useState(false);
  const [catalog, setCatalog] = useState<CatalogDesign[]>([]);
  const [catalogCategory, setCatalogCategory] = useState<string>("All");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");

  // add-text form
  const [txt, setTxt] = useState("Hello");
  const [txtFont, setTxtFont] = useState("Impact");
  const [txtCol, setTxtCol] = useState("#111111");
  // background-remove options
  const [tol, setTol] = useState(25);
  const [contig, setContig] = useState(true);
  const [orderName, setOrderName] = useState("");
  const [orderPhone, setOrderPhone] = useState("");
  const [orderAddress, setOrderAddress] = useState("");
  const [orderSize, setOrderSize] = useState("M");
  const [orderQty, setOrderQty] = useState("1");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [orderBusy, setOrderBusy] = useState(false);

  const showToast = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  // engine events always point at the latest closures
  const events = useRef<EngineEvents>({
    onSelection: () => {}, onHistory: () => {}, onToast: () => {}, onBgMessage: () => {}, onReady: () => {}, onError: () => {},
  });
  useEffect(() => {
    events.current = {
      onSelection: setSel,
      onHistory: (u, r) => { setCanUndo(u); setCanRedo(r); },
      onToast: showToast,
      onBgMessage: setBgMsg,
      onReady: () => setReady(true),
      onError: setError,
    };
  }, [showToast]);

  /* create / destroy the 3D + 2D engine */
  useEffect(() => {
    const e = createEngine(viewRef.current!, placeRef.current!, stageRef.current!, events);
    eng.current = e;
    return () => { e.dispose(); eng.current = null; };
  }, []);

  /* keep engine in sync with React state */
  useEffect(() => { eng.current?.setSide(side); }, [side]);
  useEffect(() => { eng.current?.setColor(color); }, [color]);
  useEffect(() => { eng.current?.setPlain(plain); }, [plain]);
  useEffect(() => { eng.current?.setSpin(spin); }, [spin]);
  useEffect(() => {
    let active = true;
    void fetch("/api/designs", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { designs?: CatalogDesign[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Design library could not be loaded");
        if (active) setCatalog(result.designs ?? []);
      })
      .catch((reason: unknown) => {
        if (active) setCatalogError(reason instanceof Error ? reason.message : "Design library could not be loaded");
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => { active = false; };
  }, []);

  /* Delete key + paste image */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const a = document.activeElement;
      if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
      eng.current?.deleteSelected();
    };
    const onPaste = (e: ClipboardEvent) => {
      Array.from(e.clipboardData?.files ?? []).forEach((f) => eng.current?.addImageFile(f));
    };
    addEventListener("keydown", onKey);
    addEventListener("paste", onPaste);
    return () => { removeEventListener("keydown", onKey); removeEventListener("paste", onPaste); };
  }, []);

  /* ---------- handlers ---------- */
  const openSheet = (n: SheetName) => {
    if (sheet === n) { setSheet(null); return; }
    if ((n === "add" || n === "edit") && !printOn) setPrintOn(true);
    setSheet(n);
  };
  const onTool = (n: ToolName) => {
    if (n === "designs") {
      setSheet(null);
      document.getElementById("design-library")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (n === "color" || n === "add" || n === "edit") openSheet(n);
    else if (n === "print") setPrintOn((v) => !v);
    else if (n === "flip") setSide((s) => (s === "front" ? "back" : "front"));
    else if (n === "plain") { setPlain((v) => { showToast(!v ? "Plain shirt (design hidden)" : "Design shown"); return !v; }); }
    else if (n === "spin") setSpin((v) => !v);
  };
  const isOn = (n: ToolName) =>
    n === "print" ? printOn : n === "plain" ? plain : n === "spin" ? spin : n === "flip" || n === "designs" ? false : sheet === n;

  const addFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((f) => eng.current?.addImageFile(f));
    setSheet(null);
  };
  const addFilesAt = (files: FileList | File[], clientX: number, clientY: number) => {
    const canvasEl = stageRef.current?.querySelector<HTMLElement>(".canvas-container");
    if (!canvasEl) {
      addFiles(files);
      return;
    }
    const r = canvasEl.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) {
      addFiles(files);
      return;
    }
    const x = ((clientX - r.left) / r.width) * CW;
    const y = ((clientY - r.top) / r.height) * ZONES[side].ch;
    Array.from(files).forEach((f) => eng.current?.addImageFile(f, { x, y }));
    setPrintOn(true);
    setSheet(null);
  };
  const exportPng = () => {
    const url = eng.current?.exportPng();
    if (!url) { showToast("Model still loading"); return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = `mockwear-${side}.png`;
    a.click();
    showToast("PNG downloaded");
  };
  const openOrderSheet = () => setSheet("order");
  const dataUrlToBlob = async (dataUrl: string) => {
    const res = await fetch(dataUrl);
    return res.blob();
  };
  const sendWhatsAppOrder = async () => {
    const name = orderName.trim();
    const phone = orderPhone.trim();
    const quantity = Number(orderQty);
    if (!name || !phone) {
      showToast("Name aur phone number zaroori hain");
      return;
    }
    if (fulfillment === "delivery" && !orderAddress.trim()) {
      showToast("Delivery address zaroori hai");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      showToast("Quantity valid number mein bharein");
      return;
    }
    const mockup = eng.current?.exportPng();
    if (!mockup) {
      showToast("Mockup abhi ready nahi hai");
      return;
    }

    setOrderBusy(true);
    try {
      let imageUrl = "";
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
      if (cloudName && uploadPreset) {
        const form = new FormData();
        form.append("file", await dataUrlToBlob(mockup), `mockwear-${Date.now()}.png`);
        form.append("upload_preset", uploadPreset);
        const uploaded = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
          method: "POST",
          body: form,
        });
        const result = await uploaded.json() as { secure_url?: string; error?: { message?: string } };
        if (!uploaded.ok) {
          throw new Error(result.error?.message ?? `Cloudinary upload failed (${uploaded.status})`);
        }
        imageUrl = result.secure_url ?? "";
      }

      if (!imageUrl) {
        showToast("Cloudinary preset configure nahi hai");
      }

      const addressLine = fulfillment === "delivery"
        ? `Delivery address: ${orderAddress.trim()}`
        : "Fulfillment: Customer shop visit / pickup";
      const message = [
        "New T-Shirt Mockup Order",
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Size: ${orderSize}`,
        `Quantity: ${quantity}`,
        `Shirt color: ${color}`,
        `View: ${ZONES[side].label}`,
        addressLine,
        imageUrl ? `Mockup image: ${imageUrl}` : "Mockup image: please find the downloaded PNG",
        "Please call the customer to confirm price, print, and delivery/pickup.",
      ].join("\n");
      const ownerPhone = (process.env.NEXT_PUBLIC_OWNER_WHATSAPP ?? "917470578448").replace(/\D/g, "");
      window.open(`https://wa.me/${ownerPhone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
      setSheet(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("whitelisted for unsigned uploads")) {
        showToast("Preset unsigned whitelist nahi hai. Cloudinary Settings > Upload presets mein preset Unsigned karein.");
      } else {
        showToast(`Cloudinary error: ${message || "Image upload failed"}`);
      }
    } finally {
      setOrderBusy(false);
    }
  };
  const pickColor = (c: string) => setColor(c);
  const addCatalogDesign = async (design: CatalogDesign) => {
    try {
      const response = await fetch(design.imageUrl);
      if (!response.ok) throw new Error("Artwork could not be downloaded");
      const blob = await response.blob();
      const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
      eng.current?.addImageFile(new File([blob], `${design.id}.${ext}`, { type: blob.type || "image/png" }));
      setPrintOn(true);
      setSheet(null);
      showToast(`${design.title} added to ${ZONES[side].label}`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Artwork could not be added");
    }
  };
  const filteredCatalog = catalogCategory === "All"
    ? catalog
    : catalog.filter((design) => design.category === catalogCategory);
  const availableCategories = DESIGN_CATEGORIES.filter((category) =>
    catalog.some((design) => design.category === category),
  );
  const popularDesigns = catalog.filter((design) => design.popular);

  /* ---------- render ---------- */
  return (
    <div className="relative mx-auto max-w-[1120px] px-4 pb-[calc(28px+env(safe-area-inset-bottom))] pt-[22px] lg:px-10 lg:pb-11 lg:pt-[34px] min-[1300px]:max-w-[1240px]">
      {/* hero */}
      <div className="mb-[26px] flex items-center justify-between lg:mb-[34px]">
        <span className="text-xs font-bold tracking-[.34em]">MOCKWEAR</span>
        <span className="text-xs tracking-[.12em] text-[#6f7163]">01 / 04</span>
      </div>
      <h1 className="text-[clamp(34px,7vw,66px)] font-extrabold leading-[1.02] tracking-[-.025em]">
        Get the placement
        <em className="block not-italic text-[#4d6a1f]">just right.</em>
      </h1>
      <p className="mb-[26px] mt-3 text-[clamp(13px,1.6vw,16px)] text-[#6f7163]">See how your artwork sits on the fabric.</p>
      <div className="absolute bottom-[140px] left-2.5 hidden rotate-180 text-[10px] tracking-[.3em] text-[#6f7163] [writing-mode:vertical-rl] lg:block">
        YOUR DESIGN. YOUR DETAILS.
      </div>

      {/* device */}
      <section
        className={`relative mx-auto grid max-w-[440px] grid-cols-1 gap-2.5 rounded-[30px] bg-[#0e0e0d] p-3 text-[#f1f0ea] shadow-[0_30px_70px_-20px_rgba(20,22,15,.45),0_0_0_6px_#1c1c1a] lg:h-[clamp(580px,76vh,760px)] lg:max-w-none lg:gap-3 lg:rounded-[34px] lg:p-4 ${
          printOn
            ? "lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_minmax(0,1fr)_auto_auto]"
            : "lg:grid-cols-1 lg:grid-rows-[auto_minmax(0,1fr)_auto]"
        }`}
      >
        {/* top bar */}
        <div className="flex items-center justify-between px-0.5 pt-0.5 lg:col-span-full">
          <IconBtn title="Reset view" onClick={() => eng.current?.resetView()}><Icon name="back" /></IconBtn>
          <div className="flex gap-2">
            <IconBtn title="Undo" onClick={() => eng.current?.undo()} disabled={!canUndo}><Icon name="undo" /></IconBtn>
            <IconBtn title="Redo" onClick={() => eng.current?.redo()} disabled={!canRedo}><Icon name="redo" /></IconBtn>
            <IconBtn title="Guides" onClick={() => setGridOn((v) => !v)} on={gridOn}><Icon name="grid" /></IconBtn>
            <IconBtn title="Download PNG" onClick={exportPng}><Icon name="share" /></IconBtn>
            <button
              title="Confirm order"
              onClick={openOrderSheet}
              className="rounded-full bg-[#25D366] px-3.5 text-[12px] font-bold text-[#102015] transition hover:bg-[#36df78]"
            >
              WhatsApp Order
            </button>
          </div>
        </div>

        {/* 3D viewer */}
        <div
          ref={viewRef}
          className={`relative h-[min(52vh,400px)] min-h-[300px] overflow-hidden rounded-[18px] bg-[radial-gradient(ellipse_at_50%_38%,#34342f_0%,#1a1a18_55%,#0c0c0b_100%)] lg:h-auto lg:min-h-0 ${
            printOn ? "lg:row-span-2" : ""
          }`}
        >
          {!ready && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-[#9a9a90]">
              {error ?? "Loading 3D model…"}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2.5 left-3 text-[11px] text-[#8d8d84]">Drag to rotate · Scroll to zoom</div>
          <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/15 bg-black/60 px-2.5 py-[5px] text-[11px] font-semibold uppercase tracking-[.08em] text-white">
            {ZONES[side].label}
          </div>
        </div>

        {/* placement editor */}
        <div
          ref={placeRef}
          onDragEnter={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              setPlaceDragOver(true);
            }
          }}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setPlaceDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setPlaceDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setPlaceDragOver(false);
            if (e.dataTransfer.files.length) addFilesAt(e.dataTransfer.files, e.clientX, e.clientY);
          }}
          className={`relative h-[270px] place-items-center overflow-hidden rounded-[18px] border border-[#2d2d2a] bg-[#121211] lg:h-auto lg:min-h-0 ${
            printOn ? "grid" : "hidden"
          } ${gridOn ? "guides" : ""}`}
        >
          <div className="pointer-events-none absolute left-3 top-2.5 text-[10px] uppercase tracking-[.16em] text-[#9a9a90]">
            Placement · {ZONES[side].label}
          </div>
          <div ref={stageRef} className="relative grid place-items-center" />
          {placeDragOver && (
            <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-[14px] border-2 border-dashed border-white bg-black/75 text-center">
              <div>
                <div className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-white text-xl text-[#111]">+</div>
                <b className="text-sm text-white">Drop to place on shirt</b>
              </div>
            </div>
          )}
          <div className="absolute inset-x-2 bottom-2 z-10 flex flex-wrap justify-center gap-1.5">
            {SIDES.map((k) => (
              <button
                key={k}
                onClick={() => setSide(k)}
                aria-pressed={side === k}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  side === k ? "bg-white text-[#111]" : "bg-[#242422] text-[#9a9a90] hover:text-[#f1f0ea]"
                }`}
              >
                {ZONES[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className={printOn ? "" : "hidden"}>
          <button
            onClick={() => eng.current?.deleteSelected()}
            className="h-[52px] w-full rounded-[14px] bg-[#ee5a2b] text-base font-bold text-white transition hover:bg-[#d94a1d] active:scale-[.985]"
          >
            Delete
          </button>
        </div>

        {/* sheet */}
        {sheet && (
          <div className="absolute inset-x-3 bottom-[84px] z-20 mx-auto max-h-[62%] max-w-[560px] overflow-auto rounded-[18px] border border-[#3a3a36] bg-[#1d1d1b] p-3.5 shadow-[0_20px_50px_#000a] lg:bottom-[94px]">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-xs uppercase tracking-[.14em] text-[#9a9a90]">{SHEET_TITLE[sheet]}</b>
              <button onClick={() => setSheet(null)} aria-label="Close" className="size-[30px] rounded-full bg-[#2a2a27]">✕</button>
            </div>

            {sheet === "color" && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-2">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      aria-label={c}
                      onClick={() => pickColor(c)}
                      style={{ background: c }}
                      className={`size-[34px] rounded-full border-2 border-white/30 ${color === c ? "outline-2 outline-offset-2 outline-white" : ""}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" value={color} onChange={(e) => pickColor(e.target.value)} className={colorInput} />
                  <span className="text-xs text-[#9a9a90]">Custom shirt color</span>
                </div>
              </div>
            )}

            {sheet === "add" && (
              <div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div
                  tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed px-3 py-[22px] text-center transition ${
                    dragOver ? "border-white bg-white/5" : "border-[#4a4a44] hover:border-white hover:bg-white/5"
                  }`}
                >
                  <div className="grid size-[38px] place-items-center rounded-full bg-white text-[22px] leading-none text-[#111]">+</div>
                  <b className="text-sm">Upload artwork</b>
                  <small className="text-xs text-[#9a9a90]">Click, drag &amp; drop or paste (Ctrl+V) · PNG, JPG, WebP, SVG · transparent PNG is best</small>
                </div>
                <Sep />
                <SecTitle>Text</SecTitle>
                <div className="flex gap-2">
                  <input className={`${input} flex-1`} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Your text" />
                  <input type="color" value={txtCol} onChange={(e) => setTxtCol(e.target.value)} className={colorInput} />
                </div>
                <div className="mt-2.5 flex gap-2">
                  <select className={input} value={txtFont} onChange={(e) => setTxtFont(e.target.value)}>
                    {FONTS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <button className={btnPri} onClick={() => { eng.current?.addText(txt, txtFont, txtCol); setSheet(null); }}>Add text</button>
                </div>
              </div>
            )}

            {sheet === "edit" && (
              <div>
                {!sel && <p className="text-xs text-[#9a9a90]">Select a design in the placement box to edit it.</p>}

                {sel?.kind === "text" && (
                  <>
                    <SecTitle>Text</SecTitle>
                    <div className="flex gap-2">
                      <input className={`${input} flex-1`} value={sel.text}
                        onChange={(e) => { setSel({ ...sel, text: e.target.value }); eng.current?.setText(e.target.value); }}
                        onBlur={() => eng.current?.commit()} />
                      <input type="color" value={sel.fill} className={colorInput}
                        onChange={(e) => { setSel({ ...sel, fill: e.target.value }); eng.current?.setFill(e.target.value); }}
                        onBlur={() => eng.current?.commit()} />
                    </div>
                    <div className="mt-2.5">
                      <select className={input} value={sel.font}
                        onChange={(e) => { setSel({ ...sel, font: e.target.value }); eng.current?.setFont(e.target.value); }}>
                        {FONTS.map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                    <Sep />
                  </>
                )}

                {sel?.kind === "image" && (
                  <>
                    <SecTitle>Remove background</SecTitle>
                    <div className="flex flex-wrap gap-2">
                      <button className={btnPri} onClick={() => void eng.current?.bgAuto()}>Auto remove</button>
                      <button className={btn} onClick={() => { eng.current?.bgPick(); if (innerWidth < 1024) setSheet(null); }}>Pick color</button>
                      <button className={btn} onClick={() => eng.current?.bgReset()}>Restore</button>
                    </div>
                    <label className="mt-2.5 flex items-center gap-2.5 text-xs text-[#9a9a90]">
                      Tolerance
                      <input type="range" min={2} max={80} value={tol} className="flex-1 accent-white"
                        onChange={(e) => { const v = Number(e.target.value); setTol(v); eng.current?.bgRetune(v, contig); }} />
                    </label>
                    <label className="mt-2.5 flex items-center gap-2.5 text-xs text-[#9a9a90]">
                      <input type="checkbox" checked={contig}
                        onChange={(e) => { setContig(e.target.checked); eng.current?.bgRetune(tol, e.target.checked); }} />
                      Only remove area connected to edges
                    </label>
                    <p className="mt-2 text-xs leading-snug text-[#9a9a90]">{bgMsg}</p>
                    <Sep />
                  </>
                )}

                {sel && (
                  <>
                    <SecTitle>Arrange</SecTitle>
                    <label className="flex items-center gap-2.5 text-xs text-[#9a9a90]">
                      Opacity
                      <input type="range" min={5} max={100} value={sel.opacity} className="flex-1 accent-white"
                        onChange={(e) => { const v = Number(e.target.value); setSel({ ...sel, opacity: v }); eng.current?.setOpacity(v); }}
                        onPointerUp={() => eng.current?.commit()} onKeyUp={() => eng.current?.commit()} />
                    </label>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button className={btn} onClick={() => eng.current?.mirror()}>Mirror</button>
                      <button className={btn} onClick={() => eng.current?.center()}>Center</button>
                      <button className={btn} onClick={() => eng.current?.duplicate()}>Duplicate</button>
                      <button className={btn} onClick={() => eng.current?.forward()}>Forward</button>
                      <button className={btn} onClick={() => eng.current?.backward()}>Backward</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {sheet === "order" && (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-[#aaa99f]">
                  Details submit karein. Final design Cloudinary link ke saath owner ko WhatsApp par bheja jayega. Owner call confirmation ke baad delivery ya shop pickup confirm karega.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className={input}
                    value={orderName}
                    onChange={(e) => setOrderName(e.target.value)}
                    placeholder="Customer name"
                    autoComplete="name"
                  />
                  <input
                    className={input}
                    value={orderPhone}
                    onChange={(e) => setOrderPhone(e.target.value)}
                    placeholder="WhatsApp number"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                  <select className={input} value={orderSize} onChange={(e) => setOrderSize(e.target.value)}>
                    {["S", "M", "L", "XL", "XXL", "3XL"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <input
                    className={input}
                    value={orderQty}
                    onChange={(e) => setOrderQty(e.target.value)}
                    placeholder="Quantity"
                    inputMode="numeric"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFulfillment("delivery")}
                    className={`rounded-[10px] border px-3 py-2.5 text-xs font-semibold ${fulfillment === "delivery" ? "border-white bg-white text-[#111]" : "border-[#3a3a36] bg-[#242422] text-[#d8d8d0]"}`}
                  >
                    Home delivery
                  </button>
                  <button
                    type="button"
                    onClick={() => setFulfillment("pickup")}
                    className={`rounded-[10px] border px-3 py-2.5 text-xs font-semibold ${fulfillment === "pickup" ? "border-white bg-white text-[#111]" : "border-[#3a3a36] bg-[#242422] text-[#d8d8d0]"}`}
                  >
                    Visit shop
                  </button>
                </div>

                {fulfillment === "delivery" && (
                  <textarea
                    className={`${input} min-h-[72px] w-full resize-none`}
                    value={orderAddress}
                    onChange={(e) => setOrderAddress(e.target.value)}
                    placeholder="Full delivery address, landmark, and PIN code"
                    autoComplete="street-address"
                  />
                )}

                <div className="rounded-[12px] border border-[#3a3a36] bg-[#171715] p-3 text-xs text-[#aaa99f]">
                  <div className="flex justify-between gap-3"><span>Selected side</span><b className="text-[#f1f0ea]">{ZONES[side].label}</b></div>
                  <div className="mt-1.5 flex justify-between gap-3"><span>Shirt color</span><b className="font-mono text-[#f1f0ea]">{color}</b></div>
                </div>

                <button
                  type="button"
                  disabled={orderBusy}
                  onClick={() => void sendWhatsAppOrder()}
                  className="h-[48px] w-full rounded-[12px] bg-[#25D366] text-sm font-bold text-[#102015] transition disabled:cursor-wait disabled:opacity-60"
                >
                  {orderBusy ? "Uploading mockup..." : "Send order on WhatsApp"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* toolbar */}
        <nav className="grid grid-cols-8 gap-1 rounded-[18px] border border-[#2d2d2a] bg-[#181816] p-1.5 lg:col-span-full lg:w-full lg:max-w-[720px] lg:justify-self-center">
          {TOOLS.map((t) => (
            <button
              key={t.name}
              onClick={() => onTool(t.name)}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl pb-1.5 pt-2 text-[10px] font-semibold transition lg:pb-2 lg:pt-2.5 lg:text-[11px] ${
                isOn(t.name) ? "bg-white text-[#111]" : "text-[#9a9a90] hover:bg-white/5 hover:text-[#f1f0ea]"
              }`}
            >
              <Icon name={t.icon} />
              <span className="leading-none">{t.label}</span>
            </button>
          ))}
        </nav>
      </section>

      <section
        id="design-library"
        className="mx-auto mt-10 max-w-[1120px] scroll-mt-6 rounded-[24px] border border-[#deddd4] bg-white p-5 shadow-[0_16px_50px_-35px_#30302066] sm:p-7 lg:mt-14"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#75805e]">Design library</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Pick a design for your shirt</h2>
            <p className="mt-1 text-sm text-[#77776e]">Tap any artwork to add it to the selected shirt side.</p>
          </div>
          <Link href="/admin" className="rounded-full border border-[#deddd4] px-4 py-2 text-xs font-semibold text-[#4d6a1f] transition hover:border-[#4d6a1f]">
            Admin upload
          </Link>
        </div>

        {catalogLoading && <p className="mt-6 text-sm text-[#77776e]">Loading designs...</p>}
        {catalogError && <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{catalogError}</p>}
        {!catalogLoading && !catalogError && catalog.length === 0 && (
          <div className="mt-6 rounded-xl border border-dashed border-[#d6d5cd] px-4 py-10 text-center">
            <p className="text-sm font-semibold">No designs available yet</p>
            <p className="mt-1 text-xs text-[#77776e]">Admin se upload kiye designs yahan category-wise dikhengay.</p>
          </div>
        )}
        {!catalogLoading && !catalogError && catalog.length > 0 && (
          <>
            <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
              {["All", ...availableCategories].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCatalogCategory(item)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${
                    catalogCategory === item ? "bg-[#171713] text-white" : "border border-[#e2e1d9] text-[#66665d] hover:border-[#99998f]"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="mt-7 space-y-8">
              {catalogCategory === "All"
                ? availableCategories.map((category) => {
                  const categoryDesigns = catalog.filter((design) => design.category === category);
                  return (
                    <section key={category}>
                      <h3 className="mb-3 text-sm font-bold">{category}</h3>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {categoryDesigns.map((design) => (
                          <button
                            key={design.id}
                            type="button"
                            onClick={() => void addCatalogDesign(design)}
                            className="overflow-hidden rounded-[16px] border border-[#e7e6df] bg-white text-left transition hover:-translate-y-0.5 hover:border-[#858c71] hover:shadow-md"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={design.imageUrl} alt={design.title} className="aspect-square w-full bg-[#f5f4ef] object-contain p-4" />
                            <span className="block truncate px-3 py-2.5 text-xs font-semibold">{design.title}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })
                : (
                  <section>
                    <h3 className="mb-3 text-sm font-bold">{catalogCategory}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {filteredCatalog.map((design) => (
                        <button
                          key={design.id}
                          type="button"
                          onClick={() => void addCatalogDesign(design)}
                          className="overflow-hidden rounded-[16px] border border-[#e7e6df] bg-white text-left transition hover:-translate-y-0.5 hover:border-[#858c71] hover:shadow-md"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={design.imageUrl} alt={design.title} className="aspect-square w-full bg-[#f5f4ef] object-contain p-4" />
                          <span className="block truncate px-3 py-2.5 text-xs font-semibold">{design.title}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              {catalogCategory === "All" && availableCategories.length === 0 && (
                <p className="text-sm text-[#77776e]">Uploaded designs do not have a recognized category.</p>
              )}
            </div>

            {popularDesigns.length > 0 && (
              <section className="mt-9 border-t border-[#e8e7e0] pt-6">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-bold">Popular designs</h3>
                  <span className="rounded-full bg-[#f2f3ed] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#68764b]">Trending</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {popularDesigns.map((design) => (
                    <button
                      key={design.id}
                      type="button"
                      onClick={() => void addCatalogDesign(design)}
                      className="overflow-hidden rounded-[16px] border border-[#e7e6df] bg-white text-left transition hover:-translate-y-0.5 hover:border-[#858c71] hover:shadow-md"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={design.imageUrl} alt={design.title} className="aspect-square w-full bg-[#f5f4ef] object-contain p-4" />
                      <span className="block truncate px-3 py-2.5 text-xs font-semibold">{design.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </section>

      <div
        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#111] px-4 py-2.5 text-[13px] text-white transition ${
          toast ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
        }`}
      >
        {toast}
      </div>
    </div>
  );
}