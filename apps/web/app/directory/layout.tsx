/** Public directory shares the site-wide dark theme. */
export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark landing-bg min-h-screen text-foreground">{children}</div>;
}
