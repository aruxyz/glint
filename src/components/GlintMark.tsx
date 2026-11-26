interface GlintMarkProps {
  className?: string;
}

export function GlintMark({ className = "h-4 w-4" }: GlintMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="glint-mark-bg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="url(#glint-mark-bg)" />
      <path
        d="M1.5 7C1.5 3.96243 3.96243 1.5 7 1.5H13.5L9.2 12.5H1.5V7Z"
        fill="#FFFFFF"
        fillOpacity="0.14"
      />
      <path
        d="M8.5 7H6.8C6.08 7 5.5 7.58 5.5 8.3V15.7C5.5 16.42 6.08 17 6.8 17H8.5"
        stroke="#FFFFFF"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 17H17.2C17.92 17 18.5 16.42 18.5 15.7V11.2"
        stroke="#FFFFFF"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 9.45C10.2 8.93 10.78 8.62 11.22 8.9L15.15 11.45C15.55 11.71 15.55 12.29 15.15 12.55L11.22 15.1C10.78 15.38 10.2 15.07 10.2 14.55V9.45Z"
        fill="#FFFFFF"
      />
      <path
        d="M17.5 4.2L18.18 6.02L20 6.7L18.18 7.38L17.5 9.2L16.82 7.38L15 6.7L16.82 6.02L17.5 4.2Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
