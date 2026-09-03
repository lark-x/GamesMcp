type AvatarSource = {
  imageUrl?: string;
  fallbackText: string;
  seed?: string;
};

/**
 * Unified avatar fallback chain: real asset -> local mapping -> initial
 * character -> "?" placeholder. Pages never need to know which tier resolved.
 */
export function ArchiveAvatar({
  imageUrl,
  fallbackText,
  seed,
  label,
  size = 34,
}: AvatarSource & { label?: string; size?: number }) {
  const text = fallbackText?.trim() ? fallbackText.trim().slice(0, 1) : "?";
  const toneIndex = (seed ?? fallbackText ?? "?")
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  const tone = ["a", "b", "c", "d"][toneIndex % 4];
  if (imageUrl) {
    return (
      <img
        className={`archive-avatar archive-avatar-${tone} archive-avatar-image`}
        src={imageUrl}
        alt={label ?? text}
        width={size}
        height={size}
      />
    );
  }
  return (
    <span
      className={`archive-avatar archive-avatar-${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      role="img"
      aria-label={label ?? text}
    >
      {text}
    </span>
  );
}
