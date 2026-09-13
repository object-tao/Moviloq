type IconProps = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true
});

export function ArrowIcon({ size = 18, className }: IconProps) {
  return <svg {...base(size, className)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

export function PinIcon({ size = 20, className }: IconProps) {
  return <svg {...base(size, className)}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export function ShieldIcon({ size = 22, className }: IconProps) {
  return <svg {...base(size, className)}><path d="M12 3 4.5 6v5.5c0 4.7 3.2 8 7.5 9.5 4.3-1.5 7.5-4.8 7.5-9.5V6L12 3Z" /><path d="m8.8 12 2.1 2.1 4.5-4.6" /></svg>;
}

export function ClockIcon({ size = 22, className }: IconProps) {
  return <svg {...base(size, className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
}

export function RouteIcon({ size = 22, className }: IconProps) {
  return <svg {...base(size, className)}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18h2.7a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h.3" /></svg>;
}

export function TruckIcon({ size = 26, className }: IconProps) {
  return <svg {...base(size, className)}><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return <svg {...base(size, className)}><path d="m5 12 4 4L19 6" /></svg>;
}

export function MenuIcon({ size = 22, className }: IconProps) {
  return <svg {...base(size, className)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

export function CloseIcon({ size = 22, className }: IconProps) {
  return <svg {...base(size, className)}><path d="m6 6 12 12M18 6 6 18" /></svg>;
}
