"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** The one box that searches everything. Submits rather than searching as
 *  you type: a cross-board query touches four tables, and firing it on every
 *  keystroke would spend the database on words nobody finished typing. */
export function SearchBox({
  initialQuery = "",
  autoFocus = false,
  placeholder = "搜尋所有看板...",
}: {
  initialQuery?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function submit() {
    const query = value.trim();
    if (query.length < 2) return;
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="relative">
      <Search
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
      />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-blue-500"
      />
    </div>
  );
}
