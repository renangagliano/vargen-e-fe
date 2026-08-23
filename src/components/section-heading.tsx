export function SectionHeading({ eyebrow, title, children, align = "left" }: { eyebrow: string; title: string; children?: React.ReactNode; align?: "left" | "center" }) {
  return <div className={`section-heading section-heading--${align}`}><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children && <p className="section-heading__copy">{children}</p>}</div>;
}
