/** Public Ship & Return pages share the site-wide dark theme. */
export default function ShipLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark landing-bg min-h-screen text-foreground">{children}</div>;
}
