"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/field.tsx";
import { Button } from "@/components/ui/button.tsx";

export function SecretInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className="pr-11"
        autoComplete="new-password"
        spellCheck={false}
      />
      <Button
        variant="ghost"
        size="sm"
        className="absolute z-10 right-1 top-1 h-7 w-8 px-0"
        aria-label={`${visible ? "隐藏" : "显示"}${label}`}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}
