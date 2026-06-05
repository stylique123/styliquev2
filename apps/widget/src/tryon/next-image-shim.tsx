// Shim for next/image — the widget bundle has no Next.js runtime, so render a
// plain <img>. Mirrors the subset of next/image's API that MiraWidget uses.
import { h } from "preact";
export default function Image(props: Record<string, unknown>) {
  // Strip next/image-only props so they never hit the DOM, and translate `fill`
  // into the absolute-cover styles next/image applies. WITHOUT this, every Mira
  // card that uses <Image fill> (reco image, look thumbnails) rendered an <img>
  // with no dimensions inside a position:relative/aspect-ratio box → it collapsed
  // to intrinsic/zero size and objectFit was a no-op → "images don't load".
  const {
    src, alt = "", width, height, style, className,
    fill, sizes, priority, quality, placeholder, blurDataURL, loader, unoptimized,
    ...rest
  } = props as {
    src?: string | { src?: string }; alt?: string; width?: number; height?: number;
    style?: Record<string, unknown>; className?: string; fill?: boolean;
    sizes?: string; priority?: boolean; quality?: number; placeholder?: string;
    blurDataURL?: string; loader?: unknown; unoptimized?: boolean;
  };
  const resolved = typeof src === "string" ? src : src?.src;
  const mergedStyle = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...(style ?? {}) }
    : style;
  // When fill is set, width/height must NOT be passed (next/image omits them).
  const dims = fill ? {} : { width, height };
  return h("img", { src: resolved, alt, ...dims, style: mergedStyle, class: className, ...rest });
}
