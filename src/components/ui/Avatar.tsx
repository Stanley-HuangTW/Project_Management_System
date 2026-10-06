const INITIAL_COLORS = [
  "#579bfc",
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#037f4c",
  "#ff642e",
  "#66ccff",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return INITIAL_COLORS[hash % INITIAL_COLORS.length];
}

export function Avatar({
  name,
  avatarUrl,
  size = 24,
  title,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  /** 滑鼠移上去顯示的文字(只有首字母的頭像,用它把完整姓名透出來)。 */
  title?: string;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data-URI avatars, no benefit from next/image
      <img
        src={avatarUrl}
        alt={name}
        title={title}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      title={title}
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.45, backgroundColor: colorForName(name || "?") }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
