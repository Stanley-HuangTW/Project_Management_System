"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/**
 * In-app replacements for window.confirm/window.alert.
 *
 * The desktop app's embedded browser has no dialog handler, so native
 * dialogs never render there: alert() is a no-op and confirm() returns false
 * immediately. Every "確定要…?" was therefore read as a cancel and every
 * rejection message was swallowed — silently, which is the worst way for a
 * refused save to fail. These draw the same prompts as page content, so they
 * work in the app and in a normal browser alike.
 */
type ConfirmOptions = { title?: string; confirmLabel?: string; danger?: boolean };

type Request = ConfirmOptions & {
  message: string;
  kind: "confirm" | "notify";
  resolve: (confirmed: boolean) => void;
};

type Dialogs = {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  notify: (message: string, options?: { title?: string }) => Promise<void>;
};

const Ctx = createContext<Dialogs | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);

  const confirm = useCallback(
    (message: string, options?: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ ...options, message, kind: "confirm", resolve })),
    []
  );
  const notify = useCallback(
    (message: string, options?: { title?: string }) =>
      new Promise<void>((resolve) =>
        setRequest({ ...options, message, kind: "notify", resolve: () => resolve() })
      ),
    []
  );

  function close(confirmed: boolean) {
    request?.resolve(confirmed);
    setRequest(null);
  }

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      <Dialog.Root open={request !== null} onOpenChange={(open) => !open && close(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white dark:bg-neutral-900 p-6 shadow-lg">
            <Dialog.Title className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {request?.title ?? (request?.kind === "confirm" ? "請確認" : "提示")}
            </Dialog.Title>
            <p className="mb-5 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">
              {request?.message}
            </p>
            <div className="flex justify-end gap-2">
              {request?.kind === "confirm" && (
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  取消
                </button>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
                  request?.danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {request?.kind === "confirm" ? (request.confirmLabel ?? "確定") : "知道了"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

/** Falls back to the native dialogs for anything rendered outside the
 *  provider — worse in the desktop app, but never silently nothing. */
const nativeFallback: Dialogs = {
  confirm: async (message) => window.confirm(message),
  notify: async (message) => window.alert(message),
};

export function useDialogs(): Dialogs {
  return useContext(Ctx) ?? nativeFallback;
}
