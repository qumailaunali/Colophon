import React from "react";

interface HighlightIconProps {
  className?: string;
}

export function HighlightIcon({ className }: HighlightIconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      <g transform="translate(50 50) scale(1.3) translate(-50 -50)">
        {/* Tape Roll with Peeled Strip */}
        <path
          d="M 45,33 
             L 82,33 
             L 78,38 
             L 82,43 
             L 78,48 
             L 82,53 
             L 65,53 
             A 22,22 0 1,1 45,33 Z"
          fill="#FFD000"
          stroke="#000000"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        {/* Inner Cardboard Core */}
        <circle
          cx="45"
          cy="55"
          r="10"
          stroke="#000000"
          strokeWidth="5"
          fill="#D2C3A5"
        />
        {/* Core Hollow Hole */}
        <circle
          cx="45"
          cy="55"
          r="5"
          fill="var(--color-navy-dark)"
        />
      </g>
    </svg>
  );
}
