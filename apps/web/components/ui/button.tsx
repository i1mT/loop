"use client";
import clsx from "clsx";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap select-none transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none cursor-pointer";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-card hover:bg-[#33312c] border border-ink",
  secondary: "bg-card text-ink border border-line-strong hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink border border-transparent",
  danger: "bg-card text-bad border border-bad/40 hover:bg-bad-soft",
};
const sizes: Record<Size, string> = { sm: "h-8 px-2.5 text-[13px]", md: "h-9 px-3.5 text-sm" };

export const buttonClass = (variant: Variant = "secondary", size: Size = "md", extra?: string) => clsx(base, variants[variant], sizes[size], extra);

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; children?: ReactNode }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", size = "md", className, children, external }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; external?: boolean }) {
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={buttonClass(variant, size, className)}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
