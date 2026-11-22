"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { CW, createEngine, SIDES, ZONES, type Engine, type EngineEvents, type OriginalArtwork, type SelInfo, type Side } from "@/lib/engine";
import { DESIGN_CATEGORIES, type CatalogDesign } from "@/lib/designCatalog";
import { deleteSavedDesign, listSavedDesigns, loadDesign, saveDesign, type SavedDesignSummary } from "@/lib/savedDesigns";
import { Icon, type IconName } from "./icons";

type SheetName = "edit" | "help" | "order" | "saved";
type ToolName = "color" | "add" | "designs" | "text" | "upload" | "saved" | "spin" | "help";
type AsidePanelName = "color" | "add" | "text";
type ContextMenuName = "arrange" | "layers" | "more";

const SWATCHES = ["#efede8", "#1a1a1a", "#3d3d3a", "#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#9ca3af", "#0f766e"];
const FONTS = ["Impact", "Georgia", "Courier New", "Arial", "Trebuchet MS"];
const CUSTOM_UPLOAD_LIMIT = 5;
const CUSTOM_UPLOAD_COUNT_KEY = "mockwear-custom-upload-count-v1";
const OWNER_WHATSAPP = (process.env.NEXT_PUBLIC_OWNER_WHATSAPP ?? "917470578448").replace(/\D/g, "");
const TOOLS: { name: ToolName; label: string; icon: IconName }[] = [
  { name: "color", label: "Color", icon: "color" },
  { name: "designs", label: "Designs", icon: "designs" },
  { name: "add", label: "Add", icon: "add" },
  { name: "text", label: "Text", icon: "text" },
  { name: "upload", label: "Upload", icon: "upload" },
  { name: "spin", label: "Spin", icon: "spin" },
  { name: "help", label: "Help", icon: "help" },
];
const SHEET_TITLE: Record<SheetName, string> = {
  edit: "Edit selected",
  help: "Editor help",
  order: "Confirm mockup order",
  saved: "Save & load designs",
};
type UploadAccess = "checking" | "customer" | "admin";

function readCustomUploadCount() {
  const savedCount = localStorage.getItem(CUSTOM_UPLOAD_COUNT_KEY);
  if (savedCount === null) return 0;
  const count = Number(savedCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Custom upload limit data is invalid. Please contact us for help.");
  }
  return count;
}

/* ---------- small UI helpers ---------- */
const btn =
  "rounded-xl border border-[#34364a] bg-[#202235] px-3.5 py-2 text-[13px] font-semibold text-[#ececf7] transition hover:bg-[#292c43]";
const btnPri = "rounded-xl border border-[#803cff] bg-gradient-to-r from-[#5e19ff] to-[#a51eff] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:brightness-110";
const input =
  "min-w-0 rounded-xl border border-[#34364a] bg-[#171927] px-3 py-2 text-sm text-[#f1f0fa] outline-none focus:border-[#8d4bff]";
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
        on ? "bg-[#5f1cff] text-white shadow-[0_0_18px_#712aff88]" : "border border-[#292b3d] bg-[#171927] text-[#f1f0fa] hover:bg-[#24263a]"
      }`}
    >
      {children}
    </button>
  );
}

function ContextIconButton({ title, onClick, children, active = false }: {
  title: string; onClick: () => void; children: ReactNode; active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid size-8 shrink-0 place-items-center rounded-lg transition ${
        active ? "bg-[#e9e9e3] text-[#111]" : "text-[#44443e] hover:bg-[#ecece7]"
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
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const contextToolbarRef = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("front");
  const [editorHeight, setEditorHeight] = useState(40);
  const editorDrag = useRef(false);
  const [color, setColor] = useState(SWATCHES[0]);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [printOn, setPrintOn] = useState(true);
  const [spin, setSpin] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [designsOpen, setDesignsOpen] = useState(false);
  const [asidePanel, setAsidePanel] = useState<AsidePanelName | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [sel, setSel] = useState<SelInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuName | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState({ left: 8, top: 8 });
  const [toast, setToast] = useState<string | null>(null);
  const [bgMsg, setBgMsg] = useState("Select an image, then tap Auto remove.");
  const [dragOver, setDragOver] = useState(false);
  const [placeDragOver, setPlaceDragOver] = useState(false);
  const [uploadAccess, setUploadAccess] = useState<UploadAccess>("checking");
  const [customUploadCount, setCustomUploadCount] = useState(0);
  const [uploadQuotaError, setUploadQuotaError] = useState("");
  const [catalog, setCatalog] = useState<CatalogDesign[]>([]);
  const [catalogCategory, setCatalogCategory] = useState<string>("All");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [savedDesigns, setSavedDesigns] = useState<SavedDesignSummary[]>([]);
  const [savedName, setSavedName] = useState("");
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
  const [loadingSavedId, setLoadingSavedId] = useState<string | null>(null);
  const [savedError, setSavedError] = useState("");

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

  const reserveCustomUploads = useCallback((requestedCount: number) => {
    if (uploadAccess === "checking") {
      showToast("Checking upload access. Please try again in a moment.");
      return { count: 0, reachedLimit: false };
    }
    if (uploadAccess === "admin") return { count: requestedCount, reachedLimit: false };
    if (uploadQuotaError) {
      showToast(uploadQuotaError);
      return { count: 0, reachedLimit: false };
    }

    let currentCount: number;
    try {
      currentCount = readCustomUploadCount();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Upload limit data could not be read";
      setUploadQuotaError(message);
      showToast(message);
      return { count: 0, reachedLimit: false };
    }
    const availableSlots = Math.max(0, CUSTOM_UPLOAD_LIMIT - currentCount);
    if (availableSlots === 0) {
      setCustomUploadCount(currentCount);
      showToast("Upload limit reached. Contact us on WhatsApp to add more custom designs.");
      return { count: 0, reachedLimit: true };
    }
    const count = Math.min(requestedCount, availableSlots);
    const nextCount = currentCount + count;
    try {
      localStorage.setItem(CUSTOM_UPLOAD_COUNT_KEY, String(nextCount));
    } catch {
      const message = "Browser storage is unavailable, so the upload limit cannot be applied.";
      setUploadQuotaError(message);
      showToast(message);
      return { count: 0, reachedLimit: false };
    }
    setCustomUploadCount(nextCount);
    return { count, reachedLimit: nextCount >= CUSTOM_UPLOAD_LIMIT };
  }, [showToast, uploadAccess, uploadQuotaError]);

  const addCustomFiles = useCallback((files: FileList | File[], at?: { x: number; y: number }, closeSheet = true) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const engine = eng.current;
    if (!engine) {
      showToast("The design editor is not ready yet");
      return;
    }
    const reservation = reserveCustomUploads(images.length);
    if (reservation.count === 0) return;
    const acceptedImages = images.slice(0, reservation.count);
    acceptedImages.forEach((file) => engine.addImageFile(file, at));
    setPrintOn(true);
    setDesignsOpen(false);
    setAsidePanel(null);
    if (closeSheet) setSheet(null);
    if (reservation.reachedLimit || reservation.count < images.length) {
      showToast("Upload limit reached. Contact us on WhatsApp to add more custom designs.");
    }
  }, [reserveCustomUploads, showToast]);

  const replaceImage = useCallback((file: File) => {
    if (sel?.kind !== "image") {
      showToast("Select an image to replace");
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast("Choose a valid image file");
      return;
    }
    const reservation = reserveCustomUploads(1);
    if (reservation.count === 0) return;
    eng.current?.replaceSelectedImage(file);
    if (reservation.reachedLimit) {
      showToast("Upload limit reached. Contact us on WhatsApp to add more custom designs.");
    }
  }, [reserveCustomUploads, sel?.kind, showToast]);

  const updateSelectedGeometry = (fieldName: "x" | "y" | "width" | "height", value: number) => {
    if (!sel) return;
    const next = { ...sel, [fieldName]: value };
    setSel(next);
    eng.current?.setGeometry({ x: next.x, y: next.y, width: next.width, height: next.height });
  };

  // engine events always point at the latest closures
  const events = useRef<EngineEvents>({
    onSelection: () => {}, onHistory: () => {}, onToast: () => {}, onBgMessage: () => {}, onReady: () => {}, onError: () => {},
  });
  useEffect(() => {
    events.current = {
      onSelection: (info) => { setSel(info); if (!info) setContextMenu(null); },
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

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/session", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { authenticated?: boolean };
        if (!response.ok) throw new Error("Admin session could not be checked");
        if (!active) return;
        if (result.authenticated) {
          setUploadAccess("admin");
          return;
        }
        setCustomUploadCount(readCustomUploadCount());
        setUploadAccess("customer");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        try {
          setCustomUploadCount(readCustomUploadCount());
          setUploadAccess("customer");
          showToast("Admin access could not be verified; the five-upload limit applies.");
        } catch (storageError) {
          const message = storageError instanceof Error ? storageError.message : "Upload limit data could not be read";
          setUploadQuotaError(message);
          setUploadAccess("customer");
        }
        if (reason instanceof Error) console.error(reason);
      });
    return () => { active = false; };
  }, [showToast]);

  useEffect(() => {
    if (!sel || !printOn) return;

    const updateToolbarPosition = () => {
      const canvas = stageRef.current?.querySelector<HTMLElement>(".canvas-container");
      const placement = placeRef.current;
      if (!canvas || !placement) return;
      const canvasRect = canvas.getBoundingClientRect();
      const placementRect = placement.getBoundingClientRect();
      const scaleX = canvasRect.width / CW;
      const scaleY = canvasRect.height / ZONES[side].ch;
      const toolbarWidth = contextMenu === "arrange" ? 320 : contextToolbarRef.current?.offsetWidth ?? (sel.kind === "image" ? 272 : 200);
      const toolbarHeight = contextToolbarRef.current?.offsetHeight ?? 40;
      const menuHeight = contextMenu === "arrange" ? 280 : contextMenu === "more" ? 210 : contextMenu === "layers" ? 92 : 0;
      const objectCenterX = canvasRect.left - placementRect.left + (sel.bounds.left + sel.bounds.width / 2) * scaleX;
      const maxLeft = Math.max(8, placement.clientWidth - toolbarWidth - 8);
      const left = Math.max(8, Math.min(objectCenterX - toolbarWidth / 2, maxLeft));
      const objectTop = canvasRect.top - placementRect.top + sel.bounds.top * scaleY;
      const objectBottom = objectTop + sel.bounds.height * scaleY;
      const maxTop = Math.max(8, placement.clientHeight - toolbarHeight - 8);
      const preferredTop = objectTop - toolbarHeight - 6;
      let top = Math.min(preferredTop >= 8 ? preferredTop : objectBottom + 6, maxTop);
      if (menuHeight > 0) {
        top = Math.min(top, Math.max(8, placement.clientHeight - toolbarHeight - menuHeight - 8));
      }
      setToolbarPosition({ left, top: Math.max(8, top) });
    };

    updateToolbarPosition();
    window.addEventListener("resize", updateToolbarPosition);
    return () => window.removeEventListener("resize", updateToolbarPosition);
  }, [contextMenu, printOn, sel, side]);

  /* Delete key + paste image */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const a = document.activeElement;
      if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
      eng.current?.deleteSelected();
    };
    const onPaste = (e: ClipboardEvent) => {
      addCustomFiles(e.clipboardData?.files ?? [], undefined, false);
    };
    addEventListener("keydown", onKey);
    addEventListener("paste", onPaste);
    return () => { removeEventListener("keydown", onKey); removeEventListener("paste", onPaste); };
  }, [addCustomFiles]);

  /* ---------- handlers ---------- */
  const snapEditorHeight = (height: number) => {
    const snapPoints = [30, 40, 60];
    return snapPoints.reduce((nearest, point) =>
      Math.abs(point - height) < Math.abs(nearest - height) ? point : nearest,
    40);
  };

  const resizeEditorFromPointer = (clientY: number) => {
    const main = stageRef.current?.closest("main");
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const height = ((rect.bottom - clientY) / rect.height) * 100;
    setEditorHeight(Math.max(30, Math.min(60, snapEditorHeight(height))));
  };

  const onEditorPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    editorDrag.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onEditorPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (editorDrag.current) resizeEditorFromPointer(event.clientY);
  };

  const onEditorPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    editorDrag.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const openSheet = (n: SheetName) => {
    if (sheet === n) { setSheet(null); return; }
    setDesignsOpen(false);
    setAsidePanel(null);
    if (n === "saved") {
      setSavedError("");
      setSavedLoading(true);
      void listSavedDesigns()
        .then(setSavedDesigns)
        .catch((reason: unknown) => setSavedError(reason instanceof Error ? reason.message : "Saved designs could not be loaded"))
        .finally(() => setSavedLoading(false));
    }
    if (n === "edit" && !printOn) setPrintOn(true);
    setSheet(n);
  };
  const onTool = (n: ToolName) => {
    if (n === "designs") {
      setSheet(null);
      setAsidePanel(null);
      setDesignsOpen((current) => !current);
    } else if (n === "color" || n === "add" || n === "text") {
      setSheet(null);
      setDesignsOpen(false);
      setAsidePanel((current) => current === n ? null : n);
      if (n === "text" && !printOn) setPrintOn(true);
    } else if (n === "upload") {
      setSheet(null);
      setDesignsOpen(false);
      setAsidePanel(null);
      fileRef.current?.click();
    } else if (n === "saved" || n === "help") openSheet(n);
    else if (n === "spin") setSpin((v) => !v);
  };
  const isOn = (n: ToolName) =>
    n === "spin" ? spin
      : n === "designs" ? designsOpen
        : n === "color" || n === "add" || n === "text" ? asidePanel === n
          : sheet === n;

  const addFiles = (files: FileList | File[]) => {
    addCustomFiles(files);
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
    addCustomFiles(files, { x, y });
  };
  const exportPng = () => {
    const url = eng.current?.exportPng();
    if (!url) { showToast("Model still loading"); return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = `mockup-design-${side}.png`;
    a.click();
    showToast("PNG downloaded");
  };
  const saveCurrentDesign = async () => {
    const name = savedName.trim();
    if (!name) {
      setSavedError("Enter a name for this saved design");
      return;
    }
    const engine = eng.current;
    if (!engine) {
      setSavedError("The design editor is not ready yet");
      return;
    }
    setSavedBusy(true);
    setSavedError("");
    try {
      const createdAt = new Date().toISOString();
      const summary: SavedDesignSummary = {
        id: crypto.randomUUID(),
        name,
        color,
        side,
        createdAt,
      };
      await saveDesign(summary, engine.exportProject());
      setSavedDesigns((current) => [summary, ...current]);
      setSavedName("");
      showToast("Design saved in this browser");
    } catch (reason) {
      setSavedError(reason instanceof Error ? reason.message : "Design could not be saved");
    } finally {
      setSavedBusy(false);
    }
  };
  const loadSavedDesign = async (design: SavedDesignSummary) => {
    const engine = eng.current;
    if (!engine) {
      setSavedError("The design editor is not ready yet");
      return;
    }
    setLoadingSavedId(design.id);
    setSavedError("");
    try {
      const project = await loadDesign(design.id);
      await engine.loadProject(project);
      setColor(project.color);
      setSide(project.side);
      setPrintOn(true);
      setDesignsOpen(false);
      setAsidePanel(null);
      setSheet(null);
      showToast(`Loaded "${design.name}"`);
    } catch (reason) {
      setSavedError(reason instanceof Error ? reason.message : "Saved design could not be loaded");
    } finally {
      setLoadingSavedId(null);
    }
  };
  const removeSavedDesign = async (id: string) => {
    setSavedError("");
    try {
      await deleteSavedDesign(id);
      setSavedDesigns((current) => current.filter((design) => design.id !== id));
    } catch (reason) {
      setSavedError(reason instanceof Error ? reason.message : "Saved design could not be deleted");
    }
  };
  const openOrderSheet = () => {
    setDesignsOpen(false);
    setAsidePanel(null);
    setPrintOn(true);
    setSheet("order");
  };
  const dataUrlToBlob = async (dataUrl: string) => {
    const res = await fetch(dataUrl);
    return res.blob();
  };
  const uploadToCloudinary = async (blob: Blob, fileName: string, cloudName: string, uploadPreset: string) => {
    const form = new FormData();
    form.append("file", blob, fileName);
    form.append("upload_preset", uploadPreset);
    const uploaded = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
      method: "POST",
      body: form,
    });
    const result = await uploaded.json() as { secure_url?: string; error?: { message?: string } };
    if (!uploaded.ok || !result.secure_url) {
      throw new Error(result.error?.message ?? `Cloudinary upload failed (${uploaded.status})`);
    }
    return result.secure_url;
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
    const engine = eng.current;
    const sideViews = engine?.exportSideViews();
    if (!sideViews) {
      showToast("Mockup abhi ready nahi hai");
      return;
    }
    const originalArtworks = engine?.getOriginalImages() ?? [];
    const whatsappWindow = window.open("about:blank", "_blank");
    if (!whatsappWindow) {
      showToast("WhatsApp kholne ke liye browser popups allow karein");
      return;
    }
    whatsappWindow.opener = null;

    setOrderBusy(true);
    try {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
      if (!cloudName || !uploadPreset) {
        throw new Error("Cloudinary cloud name and upload preset must be configured to send the images");
      }

      const time = Date.now();
      const sideViewLinks = await Promise.all(SIDES.map(async (viewSide) => ({
        side: viewSide,
        url: await uploadToCloudinary(
          await dataUrlToBlob(sideViews[viewSide]),
          `mockup-${viewSide}-${time}.png`,
          cloudName,
          uploadPreset,
        ),
      })));
      let originalImageLinks: { side: Side; fileName: string; url: string }[] = [];
      originalImageLinks = await Promise.all(originalArtworks.map(async (artwork: OriginalArtwork, index) => {
        const safeName = artwork.fileName.replace(/[^\w.-]+/g, "_").slice(0, 100) || `artwork-${index + 1}.png`;
        const url = await uploadToCloudinary(
          await dataUrlToBlob(artwork.dataUrl),
          `original-${artwork.side}-${index + 1}-${time}-${safeName}`,
          cloudName,
          uploadPreset,
        );
        return { side: artwork.side, fileName: safeName, url };
      }));

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
        ...sideViewLinks.map((view) => `3D ${ZONES[view.side].label} view: ${view.url}`),
        ...originalImageLinks.map((artwork, index) =>
          `Original artwork ${index + 1} (${ZONES[artwork.side].label}, ${artwork.fileName}): ${artwork.url}`,
        ),
        "Please call the customer to confirm price, print, and delivery/pickup.",
      ].join("\n");
      whatsappWindow.location.href = `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(message)}`;
      setSheet(null);
    } catch (error) {
      whatsappWindow.close();
      const message = error instanceof Error ? error.message : "";
      if (message.includes("whitelisted for unsigned uploads")) {
        showToast("Preset unsigned whitelist nahi hai. Cloudinary Settings > Upload presets mein preset Unsigned karein.");
      } else if (message.includes("must be configured")) {
        showToast("Mockup aur original images bhejne ke liye Cloudinary upload setup zaroori hai");
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
      setDesignsOpen(false);
      setAsidePanel(null);
      setSheet(null);
      showToast(`${design.title} added to ${ZONES[side].label}`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Artwork could not be added");
    }
  };
  const filteredCatalog = catalog.filter((design) => {
    const matchesCategory = catalogCategory === "All"
      || (catalogCategory === "Trending" ? design.popular : design.category === catalogCategory);
    return matchesCategory && design.title.toLowerCase().includes(catalogSearch.trim().toLowerCase());
  });
  const availableCategories = DESIGN_CATEGORIES.filter((category) =>
    catalog.some((design) => design.category === category),
  );
  const colorPanelContent = (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={color === swatch}
            onClick={() => pickColor(swatch)}
            style={{ background: swatch }}
            className={`size-[34px] rounded-full border-2 border-white/30 ${color === swatch ? "outline-2 outline-offset-2 outline-[#923dff]" : ""}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={color} onChange={(event) => pickColor(event.target.value)} className={colorInput} />
        <span className="text-xs text-[#9a9a90]">Custom shirt color</span>
      </div>
    </div>
  );
  const addPanelContent = (
    <div>
      <p className="mb-2 text-xs text-[#9a9a90]">
        {uploadAccess === "checking"
          ? "Checking upload access..."
          : uploadAccess === "admin"
            ? "Admin account · unlimited custom uploads"
            : `Custom uploads used: ${customUploadCount}/${CUSTOM_UPLOAD_LIMIT}`}
      </p>
      {uploadQuotaError && <p role="alert" className="mb-2 text-xs text-red-300">{uploadQuotaError}</p>}
      {uploadAccess === "customer" && customUploadCount >= CUSTOM_UPLOAD_LIMIT && (
        <p className="mb-3 rounded-lg bg-white/10 px-3 py-2 text-xs leading-relaxed text-[#f1f0ea]">
          You’ve used all {CUSTOM_UPLOAD_LIMIT} custom uploads.{" "}
          <a
            href={`https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent("Hi, I would like to add more custom designs to my T-shirt mockup.")}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            Contact us on WhatsApp
          </a>{" "}
          to add more.
        </p>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); addFiles(event.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed px-3 py-[22px] text-center transition ${
          dragOver ? "border-white bg-white/5" : "border-[#4a4a44] hover:border-[#9b58ff] hover:bg-[#7a35ff]/5"
        }`}
      >
        <div className="grid size-[38px] place-items-center rounded-full bg-gradient-to-r from-[#5e19ff] to-[#a51eff] text-[22px] leading-none text-white">+</div>
        <b className="text-sm">Upload artwork</b>
        <small className="text-xs text-[#9a9a90]">Click, drag &amp; drop or paste (Ctrl+V) · PNG, JPG, WebP, SVG · transparent PNG is best</small>
      </div>
    </div>
  );
  const textPanelContent = (
    <div className="space-y-3">
      <input
        className={`${input} w-full`}
        value={txt}
        onChange={(event) => setTxt(event.target.value)}
        placeholder="Your text"
        aria-label="Text to add"
      />
      <div className="flex gap-2">
        <select className={`${input} min-w-0 flex-1`} value={txtFont} onChange={(event) => setTxtFont(event.target.value)}>
          {FONTS.map((font) => <option key={font}>{font}</option>)}
        </select>
        <input type="color" value={txtCol} onChange={(event) => setTxtCol(event.target.value)} className={colorInput} aria-label="Text color" />
      </div>
      <button
        type="button"
        className={`${btnPri} w-full`}
        onClick={() => {
          eng.current?.addText(txt, txtFont, txtCol);
          setPrintOn(true);
          setAsidePanel(null);
        }}
      >
        Add text to shirt
      </button>
    </div>
  );

  /* ---------- render ---------- */
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#090a14] text-[#f5f4ff]">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <header className="relative z-50 flex h-[68px] items-center justify-between border-b border-[#26283b] bg-[#0e101c]/95 px-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#4d16ff] to-[#a91dff] text-white shadow-[0_0_22px_#751dff77]">
            <Icon name="shirt" />
          </div>
          <div className="min-w-0">
            <b className="block truncate text-[15px] leading-tight sm:text-lg">
              <span className="sm:hidden">Mockup</span>
              <span className="hidden sm:inline">Mockup Design</span>
            </b>
            <span className="hidden text-[10px] text-[#9699af] sm:block">Design. Print. Wear.</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <IconBtn title="Undo" onClick={() => eng.current?.undo()} disabled={!canUndo}><Icon name="undo" /></IconBtn>
          <IconBtn title="Redo" onClick={() => eng.current?.redo()} disabled={!canRedo}><Icon name="redo" /></IconBtn>
          <IconBtn title="Design library" onClick={() => { setSheet(null); setAsidePanel(null); setDesignsOpen((current) => !current); }} on={designsOpen}>
            <Icon name="grid" />
          </IconBtn>
          <div className="hidden sm:block">
            <IconBtn title="Download PNG" onClick={exportPng}><Icon name="download" /></IconBtn>
          </div>
          <button
            type="button"
            title="Save Design"
            onClick={() => openSheet("saved")}
            className="flex h-[38px] items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#5e19ff] to-[#a51eff] px-2.5 text-xs font-semibold text-white transition hover:brightness-110 sm:px-4"
          >
            <Icon name="save" className="size-4" />
            <span className="hidden sm:inline">Save Design</span>
          </button>
          <button
            type="button"
            title="Confirm order"
            onClick={openOrderSheet}
            className="h-[38px] rounded-full bg-[#25d366] px-3 text-[11px] font-bold text-[#102015] transition hover:bg-[#36df78] sm:px-4 sm:text-xs"
          >
            <span className="sm:hidden">Order</span>
            <span className="hidden sm:inline">Order on WhatsApp</span>
          </button>
        </div>
      </header>

      <main className="relative h-[calc(100dvh-68px)] overflow-hidden">

        {/* 3D viewer */}
        <div
          ref={viewRef}
          style={printOn ? { height: `${100 - editorHeight}%` } : undefined}
          className="absolute inset-x-0 top-0 bottom-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_42%,#24253b_0%,#11131f_48%,#080912_100%)] md:!h-full"
        >
          {!ready && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-[#9a9a90]">
              {error ?? "Loading 3D model…"}
            </div>
          )}
          {!printOn && (
            <button
              type="button"
              title="Open design placement"
              aria-label="Open design placement"
              onClick={() => setPrintOn(true)}
              className="absolute right-3 top-3 z-30 flex h-11 items-center gap-2 rounded-full border border-[#5d42a8] bg-[#171927]/95 px-3.5 text-xs font-semibold text-white shadow-[0_10px_30px_#0009] backdrop-blur-xl md:hidden"
            >
              <Icon name="shirt" className="size-4" />
              <span>Design</span>
            </button>
          )}
          <div className="pointer-events-none absolute bottom-[76px] left-3 text-[11px] text-[#9699af] md:bottom-4 md:left-[94px]">Drag to rotate · Scroll to zoom</div>
          <div className="absolute bottom-[72px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#32344a] bg-[#111321]/90 px-2 py-1.5 shadow-[0_8px_24px_#0008] md:bottom-5">
            <IconBtn title="Zoom out" onClick={() => eng.current?.zoomOut()}><Icon name="zoomOut" className="size-4" /></IconBtn>
            <span className="min-w-[48px] text-center text-xs font-semibold text-[#d8d9eb]">{zoomPercent}%</span>
            <IconBtn
              title="Zoom in"
              onClick={() => {
                eng.current?.zoomIn();
                setZoomPercent((current) => Math.min(current + 20, 200));
              }}
            >
              <Icon name="zoomIn" className="size-4" />
            </IconBtn>
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
          style={printOn ? { height: `${editorHeight}%` } : undefined}
          className={`absolute z-20 flex flex-col overflow-hidden rounded-t-[24px] ${
            printOn
              ? "inset-x-0 bottom-[68px] w-full border-t border-[#2d3045] bg-[#10121f]/98 shadow-[0_-20px_60px_#000b] backdrop-blur-xl md:!h-auto md:right-4 md:left-auto md:top-4 md:bottom-4 md:w-[340px] md:rounded-[24px] md:border"
              : "pointer-events-none right-3 top-3 h-12 w-[62px] border-transparent bg-transparent shadow-none backdrop-blur-none md:right-4 md:top-4"
          }`}
        >
          {printOn && (
            <div
              role="separator"
              aria-label="Resize design panel"
              aria-orientation="horizontal"
              className="grid h-5 shrink-0 cursor-row-resize touch-none place-items-center md:hidden"
              onPointerDown={onEditorPointerDown}
              onPointerMove={onEditorPointerMove}
              onPointerUp={onEditorPointerUp}
              onPointerCancel={onEditorPointerUp}
            >
              <span className="h-1 w-12 rounded-full bg-[#62657a]" />
            </div>
          )}
          <div className={`pointer-events-auto flex h-11 shrink-0 items-center gap-2 px-3 ${printOn ? "border-b border-[#26283b]" : "justify-end"}`}>
            {printOn && (
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                {SIDES.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSide(k)}
                    aria-pressed={side === k}
                    className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                      side === k
                        ? "bg-gradient-to-r from-[#5e19ff] to-[#842bff] text-white shadow-[0_0_16px_#702aff66]"
                        : "bg-[#202235] text-[#b8b9cc] hover:bg-[#292c43]"
                    }`}
                  >
                    {ZONES[k].label}
                  </button>
                ))}
              </div>
            )}
            <IconBtn
              title={printOn ? "Close design placement" : "Open design placement"}
              onClick={() => {
                setContextMenu(null);
                if (printOn) setSheet(null);
                setPrintOn((current) => !current);
              }}
            >
              <Icon name={printOn ? "close" : "shirt"} className="size-4" />
            </IconBtn>
          </div>
          <div
            ref={stageRef}
            onPointerDown={() => setContextMenu(null)}
            className={printOn ? "relative grid min-h-[128px] flex-1 place-items-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#202237_0%,#111321_70%)]" : "hidden"}
          />
          {printOn && sel && (
            <div
              ref={contextToolbarRef}
              style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
              className="absolute z-30"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                ref={replaceFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) replaceImage(file);
                  event.target.value = "";
                }}
              />
              <div className="flex items-center gap-0.5 rounded-xl border border-[#deded6] bg-white p-1 shadow-[0_8px_24px_#0004]">
                {sel.kind === "image" && (
                  <>
                    <ContextIconButton
                      title="Remove background"
                      onClick={() => {
                        setSheet("edit");
                        setContextMenu(null);
                        const engine = eng.current;
                        if (!engine) return;
                        void engine.bgAuto().catch((reason: unknown) => {
                          console.error(reason);
                          showToast(reason instanceof Error ? reason.message : "Could not remove the image background");
                        });
                      }}
                    >
                      <Icon name="removeBackground" className="size-4" />
                    </ContextIconButton>
                    <ContextIconButton title="Replace image" onClick={() => replaceFileRef.current?.click()}>
                      <Icon name="replace" className="size-4" />
                    </ContextIconButton>
                  </>
                )}
                <ContextIconButton
                  title="Arrange: align, position, size, rotate"
                  active={contextMenu === "arrange"}
                  onClick={() => setContextMenu((current) => current === "arrange" ? null : "arrange")}
                >
                  <Icon name="sizePosition" className="size-4" />
                </ContextIconButton>
                <span className="mx-0.5 h-5 w-px bg-[#deded6]" aria-hidden="true" />
                <ContextIconButton
                  title="Layers"
                  active={contextMenu === "layers"}
                  onClick={() => setContextMenu((current) => current === "layers" ? null : "layers")}
                >
                  <Icon name="layers" className="size-4" />
                </ContextIconButton>
                <ContextIconButton title="Duplicate" onClick={() => eng.current?.duplicate()}>
                  <Icon name="duplicate" className="size-4" />
                </ContextIconButton>
                <ContextIconButton title="Delete" onClick={() => eng.current?.deleteSelected()}>
                  <Icon name="delete" className="size-4" />
                </ContextIconButton>
                <span className="mx-0.5 h-5 w-px bg-[#deded6]" aria-hidden="true" />
                <ContextIconButton
                  title="More actions"
                  active={contextMenu === "more"}
                  onClick={() => setContextMenu((current) => current === "more" ? null : "more")}
                >
                  <Icon name="more" className="size-4" />
                </ContextIconButton>
              </div>

              {contextMenu && (
                <div className={`absolute left-0 top-full z-40 mt-1 overflow-y-auto rounded-xl border border-[#30334a] bg-[#111321] text-sm text-[#e7e8f4] shadow-[0_12px_30px_#000b] ${
                  contextMenu === "arrange"
                    ? "max-h-[min(60vh,420px)] w-[min(320px,calc(100vw-24px))] p-3"
                    : "max-h-[min(55vh,320px)] min-w-[200px] p-1"
                }`}>
                  {contextMenu === "layers" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { eng.current?.forward(); setContextMenu(null); }}
                        className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                      >
                        Bring forward
                      </button>
                      <button
                        type="button"
                        onClick={() => { eng.current?.backward(); setContextMenu(null); }}
                        className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                      >
                        Send backward
                      </button>
                    </>
                  ) : contextMenu === "arrange" ? (
                    <div className="space-y-3">
                      <div>
                        <SecTitle>Align</SecTitle>
                        <div className="flex items-center justify-between gap-1">
                          {([
                            ["left", "alignLeft"],
                            ["centerX", "alignCenter"],
                            ["right", "alignRight"],
                            ["top", "alignTop"],
                            ["centerY", "alignMiddle"],
                            ["bottom", "alignBottom"],
                          ] as const).map(([alignment, icon]) => (
                            <button
                              key={alignment}
                              type="button"
                              title={`Align ${alignment}`}
                              onClick={() => eng.current?.align(alignment)}
                              className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#34364a] bg-[#1a1c2b] text-[#d9d9e8] hover:border-[#8d4bff] hover:bg-[#27223a]"
                            >
                              <Icon name={icon} className="size-4" />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ["x", "Position X", sel.x],
                          ["y", "Position Y", sel.y],
                          ["width", "Width", sel.width],
                          ["height", "Height", sel.height],
                        ] as const).map(([fieldName, label, value]) => (
                          <label key={fieldName} className="text-[11px] font-medium text-[#aeb0c4]">
                            {label}
                            <input
                              type="number"
                              min={fieldName === "width" || fieldName === "height" ? 1 : 0}
                              value={Math.round(value)}
                              disabled={sel.locked}
                              onChange={(event) => {
                                const nextValue = Number(event.target.value);
                                if (Number.isFinite(nextValue)) updateSelectedGeometry(fieldName, nextValue);
                              }}
                              onBlur={() => eng.current?.commit()}
                              className={`${input} mt-1 w-full py-1.5 text-xs disabled:opacity-50`}
                            />
                          </label>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-[#aeb0c4]">
                        Rotate
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          value={sel.angle}
                          disabled={sel.locked}
                          onChange={(event) => eng.current?.setAngle(Number(event.target.value))}
                          onPointerUp={() => eng.current?.commit()}
                          onKeyUp={() => eng.current?.commit()}
                          className="min-w-0 flex-1 accent-[#862dff]"
                        />
                        <span className="w-9 text-right text-[#e3e3ef]">{sel.angle}°</span>
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {sel.kind === "text" && (
                        <button
                          type="button"
                          onClick={() => { setSheet("edit"); setContextMenu(null); }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                        >
                          <Icon name="edit" className="size-4" />
                          Edit text
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { eng.current?.toggleLock(); setContextMenu(null); }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                      >
                        <Icon name={sel.locked ? "unlock" : "lock"} className="size-4" />
                        {sel.locked ? "Unlock" : "Lock"}
                      </button>
                      <label className="flex items-center gap-2 px-3 py-2 text-[11px] text-[#c4c6da]">
                        <Icon name="transparency" className="size-4" />
                        Opacity
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={sel.opacity}
                          onChange={(event) => {
                            const opacity = Number(event.target.value);
                            setSel({ ...sel, opacity });
                            eng.current?.setOpacity(opacity);
                          }}
                          onPointerUp={() => eng.current?.commit()}
                          onKeyUp={() => eng.current?.commit()}
                          className="min-w-0 flex-1 accent-[#862dff]"
                        />
                        <span className="w-8 text-right">{sel.opacity}%</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => { eng.current?.mirror(); setContextMenu(null); }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                      >
                        <Icon name="flipHorizontal" className="size-4" />
                        Flip horizontal
                      </button>
                      <button
                        type="button"
                        onClick={() => { eng.current?.flipVertical(); setContextMenu(null); }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10"
                      >
                        <Icon name="flipVertical" className="size-4" />
                        Flip vertical
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {printOn && placeDragOver && (
            <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-[14px] border-2 border-dashed border-white bg-black/75 text-center">
              <div>
                <div className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-white text-xl text-[#111]">+</div>
                <b className="text-sm text-white">Drop to place on shirt</b>
              </div>
            </div>
          )}
        </div>

        <nav className="absolute bottom-2 left-1/2 z-40 grid w-[calc(100%-1rem)] grid-cols-7 gap-0.5 rounded-2xl border border-[#26283b] bg-[#10121f]/95 p-1.5 shadow-[0_12px_30px_#0008] backdrop-blur-xl -translate-x-1/2 md:bottom-auto md:left-3 md:top-3 md:w-[72px] md:-translate-x-0 md:flex md:flex-col md:justify-start md:gap-1 md:overflow-y-auto">
          {TOOLS.map((tool) => (
            <button
              key={tool.name}
              type="button"
              onClick={() => onTool(tool.name)}
              aria-pressed={isOn(tool.name)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 text-[8px] font-semibold transition sm:text-[9px] md:min-h-[56px] md:w-full md:text-[10px] ${
                isOn(tool.name)
                  ? "bg-gradient-to-r from-[#5e19ff] to-[#842bff] text-white shadow-[0_0_16px_#702aff55]"
                  : "text-[#aeb0c4] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon name={tool.icon} className="size-[18px] md:size-5" />
              <span className="truncate leading-none">{tool.label}</span>
            </button>
          ))}
        </nav>

        {(designsOpen || asidePanel !== null) && (
          <aside className="absolute inset-x-2 top-2 bottom-[148px] z-40 flex flex-col overflow-hidden rounded-[24px] border border-[#2d3045] bg-[#10121f]/95 shadow-[0_24px_70px_#000b] backdrop-blur-xl md:inset-x-auto md:left-[92px] md:top-4 md:bottom-4 md:w-[320px]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#26283b] px-4">
              <div>
                <h2 className="text-base font-bold">
                  {designsOpen ? "Design Library" : asidePanel === "color" ? "Shirt color" : asidePanel === "add" ? "Add design" : "Add text"}
                </h2>
                <p className="text-[10px] text-[#9092a8]">
                  {designsOpen ? `${catalog.length} designs available` : asidePanel === "color" ? "Choose a color for your shirt" : asidePanel === "add" ? "Upload custom artwork" : "Personalize your shirt"}
                </p>
              </div>
              <IconBtn
                title="Close panel"
                onClick={() => { setDesignsOpen(false); setAsidePanel(null); }}
              >
                <Icon name="close" className="size-4" />
              </IconBtn>
            </div>
            {designsOpen && (
              <>
            <label className="relative mx-3 mt-3 block shrink-0">
              <Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9294aa]" />
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Search designs..."
                aria-label="Search designs"
                className={`${input} w-full pl-9`}
              />
            </label>
            <div className="mt-3 flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-1">
              {["All", "Trending", ...availableCategories].filter((category, index, list) => list.indexOf(category) === index).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCatalogCategory(category)}
                  aria-pressed={catalogCategory === category}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${
                    catalogCategory === category
                      ? "bg-[#661cff] text-white shadow-[0_0_14px_#702aff66]"
                      : "bg-[#202235] text-[#b8b9cc] hover:bg-[#292c43]"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
              {catalogLoading && <p className="py-8 text-center text-xs text-[#9699af]">Loading designs...</p>}
              {catalogError && <p role="alert" className="rounded-xl bg-red-950/60 p-3 text-xs text-red-200">{catalogError}</p>}
              {!catalogLoading && !catalogError && filteredCatalog.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold">No designs found</p>
                  <p className="mt-1 text-xs text-[#9294aa]">Try another search or category.</p>
                </div>
              )}
              {!catalogLoading && !catalogError && filteredCatalog.length > 0 && (
                <div className="grid grid-cols-2 gap-2.5">
                  {filteredCatalog.map((design) => (
                    <button
                      key={design.id}
                      type="button"
                      onClick={() => void addCatalogDesign(design)}
                      className="group overflow-hidden rounded-2xl border border-[#292c40] bg-[#171927] text-left transition hover:border-[#8a45ff] hover:shadow-[0_0_18px_#702aff33]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={design.imageUrl} alt={design.title} className="aspect-square w-full bg-[#1d2030] object-contain p-3" />
                      <span className="block truncate px-2.5 py-2 text-[11px] font-semibold text-[#edecf8]">{design.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-[#26283b] p-3">
              <button type="button" onClick={() => { setDesignsOpen(false); setAsidePanel("add"); }} className={`${btnPri} flex w-full items-center justify-center gap-2`}>
                <Icon name="upload" className="size-4" />
                Upload your own design
              </button>
              <Link href="/admin" className="mt-2 block text-center text-[10px] text-[#aeb0c4] hover:text-white">
                Admin design upload
              </Link>
            </div>
              </>
            )}
            {asidePanel && (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {asidePanel === "color" && colorPanelContent}
                {asidePanel === "add" && addPanelContent}
                {asidePanel === "text" && textPanelContent}
              </div>
            )}
          </aside>
        )}

        {/* sheet */}
        {sheet && (
          <div className="absolute left-1/2 top-1/2 z-50 max-h-[calc(100%-24px)] w-[min(520px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[24px] border border-[#2d3045] bg-[#111321]/98 p-4 shadow-[0_24px_70px_#000d] backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between border-b border-[#26283b] pb-3">
              <b className="text-sm font-bold">{SHEET_TITLE[sheet]}</b>
              <IconBtn title="Close panel" onClick={() => setSheet(null)}><Icon name="close" className="size-4" /></IconBtn>
            </div>

            {sheet === "saved" && (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-[#aaa99f]">Saved designs are kept in this browser. You can reopen them here later.</p>
                <div className="flex gap-2">
                  <input
                    className={`${input} min-w-0 flex-1`}
                    value={savedName}
                    onChange={(e) => setSavedName(e.target.value)}
                    maxLength={40}
                    placeholder="Name this design"
                    aria-label="Saved design name"
                  />
                  <button type="button" onClick={() => void saveCurrentDesign()} disabled={!ready || savedBusy} className={btnPri}>
                    {savedBusy ? "Saving..." : "Save"}
                  </button>
                </div>
                {savedError && <p role="alert" className="rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-200">{savedError}</p>}
                <Sep />
                <SecTitle>Saved designs</SecTitle>
                {savedLoading && <p className="text-xs text-[#9a9a90]">Loading saved designs...</p>}
                {!savedLoading && savedDesigns.length === 0 && (
                  <p className="text-xs text-[#9a9a90]">No saved designs yet. Save the current shirt design to find it here.</p>
                )}
                {!savedLoading && savedDesigns.map((design) => (
                  <div key={design.id} className="flex items-center gap-2 rounded-xl border border-[#2d3045] bg-[#171927] p-2">
                    <button
                      type="button"
                      onClick={() => void loadSavedDesign(design)}
                      disabled={loadingSavedId !== null}
                      className="min-w-0 flex-1 text-left disabled:opacity-60"
                    >
                      <span className="block truncate text-sm font-semibold">{loadingSavedId === design.id ? "Loading..." : design.name}</span>
                      <span className="mt-1 block text-[11px] text-[#9a9a90]">
                        {ZONES[design.side].label} · {design.color} · {new Date(design.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeSavedDesign(design.id)}
                      disabled={loadingSavedId !== null}
                      className="rounded-lg px-2 py-1 text-xs text-[#c5c4ba] hover:bg-white/10 disabled:opacity-40"
                      aria-label={`Delete saved design ${design.name}`}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sheet === "help" && (
              <div className="space-y-3 text-sm text-[#c3c4d5]">
                <p>Choose a design from the library or upload your own artwork, then drag it into position on the shirt.</p>
                <p>Select artwork to align, resize, rotate, lock, duplicate, or delete it in the Design Placement panel.</p>
                <p>Use Front and Back to edit each side. Save Design stores your work in this browser.</p>
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

              </div>
            )}

            {sheet === "order" && (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-[#aaa99f]">
                  Front aur back ke 3D previews aur shirt par use ki gayi original image(s) ke links owner ko WhatsApp par bheje jayenge. Owner call confirmation ke baad delivery ya shop pickup confirm karega.
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

      </main>

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