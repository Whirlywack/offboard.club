// The placeholder logo (design/logo-placeholder.png) drawn as SVG: two squares, the second knocked askew. Decorative:
// the wordmark beside it carries the name.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 600" width="28" height="28" aria-hidden="true" focusable="false">
      <rect width="600" height="600" fill="var(--logo-ground)" />
      <rect x="135" y="135" width="155" height="155" fill="var(--logo-squares)" />
      <rect x="323.5" y="323.5" width="155" height="155" fill="var(--logo-squares)" transform="rotate(14 401 401)" />
    </svg>
  );
}
