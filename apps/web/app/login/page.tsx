import { LoginForm } from "@/components/login-form.tsx";

export const metadata = { title: "登录 · Loop" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2 font-semibold tracking-[-0.01em]">
          <span className="grid size-7 place-items-center rounded-md bg-ink" aria-hidden>
            <span className="size-2.5 rounded-full bg-signal" />
          </span>
          Loop
        </div>
        <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.01em]">登录</h1>
        <p className="mt-2 text-sm text-ink-2">使用你的账号登录。账号由管理员创建，登录后可以在“设置”里修改密码。</p>
        <LoginForm />
      </div>
    </main>
  );
}
