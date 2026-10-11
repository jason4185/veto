export function Strands() {
  return (
    <div className="strand-scene" aria-hidden="true">
      <svg className="strand-art" viewBox="0 0 660 620" fill="none">
        <defs>
          <linearGradient
            id="filament"
            x1="60"
            y1="100"
            x2="540"
            y2="510"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--strand-dim)" />
            <stop offset=".35" stopColor="var(--strand-light)" />
            <stop offset=".55" stopColor="var(--strand-mid)" />
            <stop offset=".78" stopColor="var(--strand-light)" />
            <stop offset="1" stopColor="var(--strand-dim)" />
          </linearGradient>
          <linearGradient
            id="edge"
            x1="290"
            y1="120"
            x2="410"
            y2="500"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--strand-dim)" />
            <stop offset=".5" stopColor="var(--pearl-sage)" />
            <stop offset="1" stopColor="var(--strand-dim)" />
          </linearGradient>
        </defs>
        <g className="strand-bundle">
          {Array.from({ length: 64 }, (_, i) => {
            const n = i / 63;
            return (
              <path
                key={i}
                d={`M ${42 + n * 168} ${25 + n * 23} C ${645 - n * 270} ${75 + n * 35}, ${12 + n * 125} ${291 + n * 115}, ${512 - n * 119} ${571 + n * 20}`}
                stroke="url(#filament)"
                strokeWidth={i % 8 === 0 ? 1.05 : 0.65}
                opacity={0.28 + (i % 7) * 0.085}
              />
            );
          })}
          {Array.from({ length: 38 }, (_, i) => {
            const n = i / 37;
            return (
              <path
                key={i}
                d={`M ${610 - n * 132} ${12 + n * 46} C ${76 + n * 118} ${142 + n * 38}, ${640 - n * 96} ${332 + n * 90}, ${176 + n * 128} ${615 - n * 16}`}
                stroke="url(#filament)"
                strokeWidth=".65"
                opacity={0.2 + (i % 5) * 0.1}
              />
            );
          })}
        </g>
        <path
          className="intercept-line"
          d="M 424 142 L 291 472"
          stroke="url(#edge)"
          strokeWidth="2"
        />
        <path d="M 430 140 L 297 470" stroke="var(--strand-dim)" strokeWidth="8" />
      </svg>
      <div className="signal-label">
        <span className="signal-dot" /> INTELLIGENCE AT THE INTERSECTION
      </div>
    </div>
  );
}
