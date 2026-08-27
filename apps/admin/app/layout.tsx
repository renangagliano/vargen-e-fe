import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "Admin Workspace · Vargen & Fé", template: "%s · Vargen & Fé" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
