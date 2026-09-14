"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/**
 * In-app replacements for window.confirm/window.alert/window.prompt.
 *
 * The desktop app's embedded browser has no dialog handler, so native
 * dialogs never render there: alert() is a no-op and confirm() returns false
 * immediately. Every "確定要…?" was therefore read as a cancel and every
 * rejection message was swallowed — silently, which is the worst way for a
 * refused save to fail. These draw the same prompts as page content, so they
 * work in the app and in a normal browser alike.
 */
export type DialogChoice = { key: string; label: string; danger?: boolean };

type ConfirmOptions = { title?: string; confirmLabel?: string; danger?: boolean };

type PromptOptions = {
  title?: string;
  /** Prefilled value — what the box starts with. */
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Refuses to submit while the box is empty, for the reasons that have to
   *  be written down (a waiver, a rejection, a reserve drawdown). */
  required?: boolean;
  /** A numeric entry gets a number field and thousands separators stripped. */
  numeric?: boolean;
};

type Request = {
  title?: string;
  message: string;
  choices: DialogChoice[];
  /** Whether the dialog offers a way out other than picking a choice. */
  cancellable: boolean;
  /** Present for a prompt: the dialog then renders an input and resolves with
   *  what was typed rather than with a choice key. */
  input?: PromptOptions;
  resolve: (key: string | null) => void;
};

const CONFIRM_KEY = "__confirm__";

type Dialogs = {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  notify: (message: string, options?: { title?: string }) => Promise<void>;
  /** More than two outcomes — returns the chosen key, or null if dismissed. */
  choose: (
    message: string,
    options: { title?: string; choices: DialogChoice[] }
  ) => Promise<string | null>;
  /** Asks for a value. Null when dismissed — same contract window.prompt had,
   *  except this one actually renders here. */
  prompt: (message: string, options?: PromptOptions) => Promise<string | null>;
};

const Ctx = createContext<Dialogs | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState("");

  const ask = useCallback(
    (req: Omit<Request, "resolve">) =>
      new Promise<string | null>((resolve) => setRequest({ ...req, resolve })),
    []
  );

  const confirm = useCallback(
    async (message: string, options?: ConfirmOptions) =>
      (await ask({
        title: options?.title ?? "請確認",
        message,
        cancellable: true,
        choices: [{ key: CONFIRM_KEY, label: options?.confirmLabel ?? "確定", danger: options?.danger }],
      })) === CONFIRM_KEY,
    [ask]
  );

  const notify = useCallback(
    async (message: string, options?: { title?: string }) => {
      await ask({
        title: options?.title ?? "提示",
        message,
        cancellable: false,
        choices: [{ key: CONFIRM_KEY, label: "知道了" }],
      });
    },
    [ask]
  );

  const choose = useCallback(
    (message: string, options: { title?: string; choices: DialogChoice[] }) =>
      ask({ title: options.title ?? "請選擇", message, cancellable: true, choices: options.choices }),
    [ask]
  );

  const prompt = useCallback(
    (message: string, options?: PromptOptions) => {
      // Seeded before the dialog opens so the box shows the current value —
      // editing a budget should start from what it already is.
      setValue(options?.defaultValue ?? "");
      return ask({
        title: options?.title ?? "請輸入",
        message,
        cancellable: true,
        choices: [{ key: CONFIRM_KEY, label: options?.confirmLabel ?? "確定" }],
        input: options ?? {},
      });
    },
    [ask]
  );

  function close(key: string | null) {
    request?.resolve(key);
    setRequest(null);
    setValue("");
  }

  /** A prompt resolves with the typed text, not the button's key. */
  function submitInput() {
    if (!request?.input) return;
    const trimmed = value.trim();
    if (request.input.required && !trimmed) return;
    request.resolve(request.input.numeric ? trimmed.replace(/[,s]/g, "") : trimmed);
    setRequest(null);
    setValue("");
  }

  const stacked = (request?.choices.length ?? 0) > 1;

  return (
    <Ctx.Provider value={{ confirm, notify, choose, prompt }}>
      {children}
      <Dialog.Root open={request !== null} onOpenChange={(open) => !open && close(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white dark:bg-neutral-900 p-6 shadow-lg">
            <Dialog.Title className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {request?.title}
            </Dialog.Title>
            <p className="mb-3 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">
              {request?.message}
            </p>
            {request?.input && (
              <input
                autoFocus
                type={request.input.numeric ? "text" : "text"}
                inputMode={request.input.numeric ? "numeric" : undefined}
                value={value}
                placeholder={request.input.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitInput();
                }}
                className="mb-5 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              />
            )}
            <div className={stacked ? "flex flex-col gap-2" : "flex justify-end gap-2"}>
              {request?.choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  disabled={!!request.input?.required && !value.trim()}
                  onClick={() => (request.input ? submitInput() : close(choice.key))}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 ${
                    choice.danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {choice.label}
                </button>
              ))}
              {request?.cancellable && (
                <button
                  type="button"
                  onClick={() => close(null)}
                  className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  取消
                </button>
              )}
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
  choose: async (message, options) =>
    window.confirm(message) ? (options.choices[0]?.key ?? null) : null,
  prompt: async (message, options) => window.prompt(message, options?.defaultValue) ?? null,
};

export function useDialogs(): Dialogs {
  return useContext(Ctx) ?? nativeFallback;
}
