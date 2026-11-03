"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Crosshair, HelpCircle, X } from "lucide-react";
import { manualHref } from "@/lib/helpTopics";
import { startElementPicker, useElementPickerAvailable } from "@/components/help/pickerState";
import { ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
  /** 這個視窗在使用手冊裡對應的章節:標題列多一個「?」,點了在新分頁打開。 */
  help?: { label: string; anchor: string };
};

const MAX_WIDTH = { md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" };

export function Modal({ open, onOpenChange, title, children, size = "md", help }: ModalProps) {
  const canPick = useElementPickerAvailable();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full ${MAX_WIDTH[size]} -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white dark:bg-neutral-900 p-6 shadow-lg`}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
            </Dialog.Title>
            <div className="flex items-center gap-3">
              {canPick && (
                // 視窗開著時外面的「?」點不到:從標題列開始選取視窗裡的元素。
                <button
                  type="button"
                  data-modal-pick
                  onClick={startElementPicker}
                  title="選取這個視窗裡有疑問的地方:查手冊或回報問題"
                  aria-label="選取元素:查手冊或回報問題"
                  className="text-neutral-400 hover:text-blue-600 dark:text-neutral-500 dark:hover:text-blue-300"
                >
                  <Crosshair size={18} />
                </button>
              )}
              {help && (
                <a
                  href={manualHref(help.anchor)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-modal-help
                  title={`開啟使用手冊:${help.label}`}
                  aria-label={`開啟使用手冊:${help.label}`}
                  className="text-neutral-400 hover:text-blue-600 dark:text-neutral-500 dark:hover:text-blue-300"
                >
                  <HelpCircle size={18} />
                </a>
              )}
              <Dialog.Close className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100">
                <X size={18} />
              </Dialog.Close>
            </div>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
