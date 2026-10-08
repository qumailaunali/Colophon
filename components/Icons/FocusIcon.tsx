import React from "react";

interface FocusIconProps {
  className?: string;
}

/** Viewfinder brackets around a centre point: "focus on the page". */
export function FocusIcon({ className }: FocusIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8V5a2 2 0 0 1 2-2h3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  );
}
