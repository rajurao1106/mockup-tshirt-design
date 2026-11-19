export const DESIGN_CATEGORIES = ["Anime", "Typography", "Minimal", "Streetwear", "Gaming", "Custom"] as const;

export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

export interface CatalogDesign {
  id: string;
  title: string;
  category: DesignCategory;
  imageUrl: string;
  popular: boolean;
  createdAt: string;
}
