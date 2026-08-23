import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "@/components/icons";

type ButtonProps = { href: string; children: React.ReactNode; variant?: "gold" | "outline" | "text"; external?: boolean; className?: string };

export function Button({ href, children, variant = "gold", external = false, className = "" }: ButtonProps) {
  const content = <>{children}<span className="button__icon">{external ? <ArrowUpRight size={16} /> : <ArrowRight size={16} />}</span></>;
  const classes = `button button--${variant} ${className}`;
  return external ? <a className={classes} href={href} target="_blank" rel="noreferrer">{content}</a> : <Link className={classes} href={href}>{content}</Link>;
}
