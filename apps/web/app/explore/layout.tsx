/**
 * Public explore pages share the site-wide dark theme so they look identical
 * to the landing page and the app console.
 */
export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark landing-bg min-h-screen text-foreground">{children}</div>;
}
