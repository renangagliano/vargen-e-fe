import Image from "next/image";
import Link from "next/link";

export function BrandMark() {
  return <Link href="/" className="brand-mark" aria-label="Vargen & Fé — início"><Image className="brand-mark__image" src="/brand/logo-mark.png" alt="" width={40} height={40} priority /><span className="brand-mark__name">Vargen <i>&</i> Fé</span></Link>;
}
