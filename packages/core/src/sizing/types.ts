export type SizeChartSourceKind =
  | "variant_metafield"
  | "json_metafield"
  | "html_metafield"
  | "description_html"
  | "linked_page"
  | "image_ocr";

export interface NormalizedSizeChart {
  sizes: Array<{
    name: string;
    chest?: number;   // cm
    waist?: number;   // cm
    hip?: number;     // cm
    length?: number;  // cm
    [key: string]: number | string | undefined;
  }>;
  unit: "cm" | "in";
  source: SizeChartSourceKind;
}

export interface SizeChartCandidate {
  source: SizeChartSourceKind;
  confidence: number; // 0-1
  chart: NormalizedSizeChart | null;
}
