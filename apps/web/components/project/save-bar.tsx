import { Button } from "@/components/ui/button.tsx";
import { InlineError } from "@/components/ui/states.tsx";

/** 表单底部：保存按钮、未保存提示、错误 */
export function SaveBar({ busy, dirty, disabled, error, label = "保存" }: { busy: boolean; dirty: boolean; disabled?: boolean; error: string | null; label?: string }) {
  return (
    <>
      {error && <InlineError>{error}</InlineError>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!dirty || disabled}>
          {label}
        </Button>
        {dirty && <span className="text-xs text-ink-2">有未保存的修改</span>}
      </div>
    </>
  );
}
