import { socialLinks } from "@/config/site";
import { iconByName } from "@/components/icons";

export function SocialLinks({ compact = false }: { compact?: boolean }) {
  return <div className={`social-links ${compact ? "social-links--compact" : ""}`}>{socialLinks.map((social) => { const Icon = iconByName[social.icon as keyof typeof iconByName]; return <a key={social.key} href={social.href as string} target="_blank" rel="noreferrer" aria-label={social.label}><Icon size={compact ? 17 : 19} /><span>{!compact && social.label}</span></a>; })}</div>;
}
