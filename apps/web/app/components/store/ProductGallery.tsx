"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { colorwayImages, type Product } from "../../lib/catalog";

/**
 * PDP image stack. Renders the product's photographed frames and, when the
 * shopper picks an alternate color in <ProductColors>, swaps in the real
 * AI-recolored render of the SAME shot for that colorway — same model, pose,
 * lighting, background; only the garment color changes. No blend-mode tint.
 * The picker and gallery live in different grid cells, so they talk via a
 * `stylique:pdp-color` CustomEvent on `document`.
 */
export default function ProductGallery({
  product,
  name,
}: {
  product: Product;
  name: string;
}) {
  const [color, setColor] = useState<{ index: number; name?: string }>({
    index: 0,
  });

  useEffect(() => {
    function onColor(e: Event) {
      const detail = (e as CustomEvent).detail as {
        index: number;
        color?: string;
      };
      setColor({ index: detail.index, name: detail.color });
    }
    document.addEventListener("stylique:pdp-color", onColor);
    return () => document.removeEventListener("stylique:pdp-color", onColor);
  }, []);

  const images = colorwayImages(product, color.index, color.name);
  const colorLabel = product.colors[color.index] ?? "";

  return (
    <div style={{ display: "grid", gap: 4 }} data-pdp-gallery>
      {images.map((src, i) => (
        <div
          key={`${src}-${i}`}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "3 / 4",
            overflow: "hidden",
            background: "var(--surface)",
          }}
        >
          <Image
            src={src}
            alt={`${name}${colorLabel ? ` — ${colorLabel}` : ""} — view ${i + 1}`}
            fill
            sizes="(max-width: 768px) 100vw, 60vw"
            style={{ objectFit: "cover" }}
            priority={i === 0}
          />
        </div>
      ))}
    </div>
  );
}
