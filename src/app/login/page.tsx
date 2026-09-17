"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "@/lib/actions/auth";

const initialState: LoginState = {};

function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  // OAuth 流程會先把人送來登入,登完要回到原本那個授權頁面。伺服器那邊會
  // 再驗一次這個值只能是本站路徑 —— 這裡只是把它帶過去。
  const next = useSearchParams().get("next") ?? "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-800">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 shadow-sm"
      >
        <h1 className="mb-6 text-xl font-semibold text-neutral-900 dark:text-neutral-100">登入</h1>

        <input type="hidden" name="next" value={next} />

        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-100">
          帳號 (Email)
        </label>
        <input
          name="email"
          type="email"
          required
          autoFocus
          className="mb-4 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />

        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-100">
          密碼
        </label>
        <input
          name="password"
          type="password"
          required
          className="mb-1 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <div className="mb-4 text-right">
          <Link href="/forgot-password" className="text-xs text-blue-600 hover:underline">
            忘記密碼？
          </Link>
        </div>

        {state.error && (
          <p className="mb-4 text-sm text-red-600">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "登入中..." : "登入"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
