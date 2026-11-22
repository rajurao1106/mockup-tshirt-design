import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  shirt: <path d="M8.5 3 3 6l2.2 4.2L7.5 9v11.5h9V9l2.3 1.2L21 6l-5.5-3a3.6 3.6 0 0 1-7 0z" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  grid: <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" />,
  download: <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 17v4h14v-4" />,
  save: <path d="M5 3h12l4 4v14H3V3h2zM7 3v6h10V3M7 21v-8h10v8" />,
  color: (
    <>
      <path d="M12 3a9 9 0 100 18c1.5 0 2.1-1.1 1.6-2.3-.5-1.3.4-2.4 1.7-2.4H17a4 4 0 004-4c0-5-4.1-9.3-9-9.3z" />
      <circle cx="7.5" cy="11" r=".6" />
      <circle cx="10" cy="7" r=".6" />
      <circle cx="15" cy="7.5" r=".6" />
    </>
  ),
  add: <path d="M12 5v14M5 12h14" />,
  text: <path d="M4 5h16M12 5v14M8 19h8" />,
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 0 1 4.8 1c0 1.8-2.4 2-2.4 4M12 17.5v.1" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  cart: <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 9H6M10 21h.01M18 21h.01" />,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M10.5 7.5v6m-3-3h6" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21m-13.5-10h6" /></>,
  fullscreen: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  alignLeft: <path d="M5 3v18M9 7h10v10H9z" />,
  alignCenter: <path d="M12 3v18M6 7h12v10H6z" />,
  alignRight: <path d="M19 3v18M5 7h10v10H5z" />,
  alignTop: <path d="M3 5h18M7 9h10v10H7z" />,
  alignMiddle: <path d="M3 12h18M7 6h10v12H7z" />,
  alignBottom: <path d="M3 19h18M7 5h10v10H7z" />,
  removeBackground: (
    <>
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 13l4-4 3 3 2-2 5 5" />
      <path d="M20 3v5M17.5 5.5h5" />
    </>
  ),
  replace: <path d="M20 7h-5l2-2M4 17h5l-2 2M18 5a7 7 0 00-12 3M6 19a7 7 0 0012-3" />,
  sizePosition: <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8z" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />,
  duplicate: <path d="M8 8h12v12H8zM4 16H3V4h12v1" />,
  delete: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  lock: <path d="M5 11h14v10H5zM8 11V7a4 4 0 118 0v4" />,
  unlock: <path d="M5 11h14v10H5zM8 11V7a4 4 0 017-2.6" />,
  transparency: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  flipHorizontal: <path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4" />,
  flipVertical: <path d="M3 12h18M8 5l4-3 4 3M8 19l4 3 4-3" />,
  designs: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 15-5-5L5 20" />
    </>
  ),
  print: <path d="M8.5 3L3 6l2.2 4.2L7.5 9v11.5h9V9l2.3 1.2L21 6l-5.5-3a3.6 3.6 0 01-7 0z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />,
  flip: <path d="M7 7h13l-3-3M17 17H4l3 3" />,
  plain: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  spin: <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0 fill-none stroke-current`}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}