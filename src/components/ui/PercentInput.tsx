"use client";

import { useEffect, useRef, useState } from "react";

const MIN = 1;
const MAX = 100;

/** 1–100 的整數才算數,其餘(空白、小數、超出範圍)回 null。 */
function parsePercent(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= MIN && n <= MAX ? n : null;
}

/**
 * 百分比輸入框(1–100,每次加減 1)。游標在框裡時,滾輪往上滾加、往下滾減(跟原生的數字框
 * 一樣要先點進去,免得捲動對話框時滑鼠剛好經過就把值改掉)。
 *
 * onChange 只會收到有效的整數:打到一半(空白、超出範圍)不會送出,移開時還原成外面給的值。
 * delayMs > 0 時,連續變動(滾輪、方向鍵、打字)停下來那一刻才送出一次;用在「改了就立刻存檔」
 * 的地方,不然滾一格就存一次,存檔中輸入框被停用、焦點掉了,後面的滾動就沒了。
 */
export function PercentInput({
  value,
  onChange,
  delayMs = 0,
  disabled,
  className,
}: {
  value: number;
  onChange: (pct: number) => void;
  delayMs?: number;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(value));
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    // 外面的值變了(例如存檔後重新載入)就跟著變。
    setSeenValue(value);
    setText(String(value));
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const latest = useRef({ onChange, text, delayMs });
  useEffect(() => {
    latest.current = { onChange, text, delayMs };
  });

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null) latest.current.onChange(next);
  }

  function propose(nextText: string) {
    setText(nextText);
    const n = parsePercent(nextText);
    if (n === null) return;
    pending.current = n;
    if (latest.current.delayMs <= 0) {
      flush();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, latest.current.delayMs);
  }

  const proposeRef = useRef(propose);
  useEffect(() => {
    proposeRef.current = propose;
  });

  // React 的 onWheel 是 passive,擋不住對話框跟著捲,所以直接掛原生的、可以 preventDefault 的監聽。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el || el.disabled || e.deltaY === 0) return;
      e.preventDefault();
      const base = parsePercent(latest.current.text) ?? MIN;
      const next = Math.min(MAX, Math.max(MIN, base + (e.deltaY < 0 ? 1 : -1)));
      proposeRef.current(String(next));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 畫面關掉時,還沒送出的變動補送出去。
  useEffect(() => () => flush(), []);

  return (
    <input
      ref={inputRef}
      type="number"
      min={MIN}
      max={MAX}
      step={1}
      value={text}
      disabled={disabled}
      onChange={(e) => propose(e.target.value)}
      onBlur={() => {
        flush();
        setText(String(parsePercent(text) ?? value));
      }}
      className={className}
    />
  );
}
