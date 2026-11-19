// Small line icons, 20px, drawn on a 24 grid with the current text colour.
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Home = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
);

export const Trade = (p) => (
  <svg {...base} {...p}>
    <path d="M7 4v16M7 4 3.5 7.5M7 4l3.5 3.5" />
    <path d="M17 20V4m0 16-3.5-3.5M17 20l3.5-3.5" />
  </svg>
);

export const Move = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="6" width="17" height="12.5" rx="3" />
    <path d="M3.5 10h17M15.5 14.5h2" />
  </svg>
);

// A pair of shades: the agents wear them.
export const Agent = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 9.5h19" />
    <path d="M3.5 9.5c0 3.4 1.4 5.5 4.2 5.5 2.6 0 3.6-2 4.3-4.2.7 2.2 1.7 4.2 4.3 4.2 2.8 0 4.2-2.1 4.2-5.5" />
  </svg>
);

export const EyeOff = (p) => (
  <svg {...base} {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.6A9.8 9.8 0 0 1 12 5.5c5 0 8.5 4.6 9.5 6.5a15 15 0 0 1-2.7 3.5M6.6 6.7C4.5 8 3.1 10.1 2.5 12c1 1.9 4.5 6.5 9.5 6.5 1.7 0 3.2-.5 4.5-1.3" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

export const Lock = (p) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

export const Plus = (p) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ArrowUpRight = (p) => (
  <svg {...base} {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const ArrowDown = (p) => (
  <svg {...base} {...p}>
    <path d="M12 5v14m0 0-5-5m5 5 5-5" />
  </svg>
);

export const Copy = (p) => (
  <svg {...base} {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
  </svg>
);

export const Check = (p) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
