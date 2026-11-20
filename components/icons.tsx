import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  grid: <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />,
  share: <path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" />,
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