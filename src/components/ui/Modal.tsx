"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { HelpCircle, X } from "lucide-react";
import { manualHref } from "@/lib/helpTopics";
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
