"use client";

import { useState } from "react";

/**
 * 一般的單行輸入框,多了一份「建議」:點進去或打字時,在下面列出可以直接選的句子(↑↓ 選、Enter 或點一下
 * 填入、Esc 關掉)。建議由呼叫端算好傳進來(例如這位成員以前登記過的備註);沒有建議就跟普通輸入框一樣。
 */
export function NoteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
  className = "",
  wrapperClassName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  /** 輸入框本身的外觀。 */
  className?: string;
  /** 外層的寬度設定(flex-1、min-w…)。 */
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const visible = open && !disabled && suggestions.length > 0;

  function pick(text: string) {
    onChange(text);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!visible) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0 && !e.nativeEvent.isComposing) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === "Escape") {
            // 只關建議,不要連外面的視窗一起關掉。
            e.stopPropagation();
            setOpen(false);
          }
        }}
        autoComplete="off"
        className={`w-full ${className}`}
      />
      {visible && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-md dark:border-neutral-700 dark:bg-neutral-900"
        >
          <li className="px-2 pb-1 pt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">以前登記過的備註</li>
          {suggestions.map((text, i) => (
            <li key={text} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown 先擋掉:不然輸入框先失焦、清單先關掉,click 就收不到。
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(text)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800 ${
                  i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""
                }`}
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
