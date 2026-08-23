export function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "light" }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
