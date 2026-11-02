// Brand mark and wordmark. The Figma brand sheet (symbol, primary and inverse
// logos) is drawn for "Sentinel"; we keep the Vigilia name and reuse its system:
// a geometric teal letterform on a navy tile, navy or white name, teal "AML".

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Vigilia AML">
      <rect width="48" height="48" rx="11" fill="#0b1a26" />
      <path d="M10 12h9l5 15 5-15h9l-9.5 24h-9z" fill="#5ec4b6" />
    </svg>
  );
}

export function Logo({ tone = "primary", sub }: { tone?: "primary" | "inverse"; sub?: string }) {
  return (
    <span className={`logo ${tone}`}>
      <LogoMark />
      <span>
        <span className="logo-name">Vigilia <span className="logo-aml">AML</span></span>
        {sub && <span className="logo-sub">{sub}</span>}
      </span>
    </span>
  );
}
