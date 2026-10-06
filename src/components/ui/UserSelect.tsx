"use client";

import { useMemo } from "react";
import { Avatar } from "./Avatar";
import { SearchableSelect, type SelectOption } from "./SearchableSelect";

/** 選一個人:帶頭像、可以打字搜尋姓名的下拉選單,用法跟原生 <select> 一樣("" = 沒選)。 */
export function UserSelect({
  users,
  extraOptions,
  value,
  onChange,
  placeholder,
  emptyLabel,
  disabled,
  className,
  title,
}: {
  users: { id: string; name: string; avatarUrl?: string | null }[];
  /** 排在人員前面的特殊選項(例如「— 清除 —」)。 */
  extraOptions?: SelectOption[];
  value: string;
  onChange: (userId: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const options = useMemo(
    () => [
      ...(extraOptions ?? []),
      ...users.map((u) => ({
        value: u.id,
        label: u.name,
        icon: <Avatar name={u.name} avatarUrl={u.avatarUrl} size={18} />,
      })),
    ],
    [users, extraOptions]
  );
  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      disabled={disabled}
      className={className}
      title={title}
    />
  );
}
