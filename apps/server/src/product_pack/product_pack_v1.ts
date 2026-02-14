import fs from "fs";
import path from "path";

export type ProductPackV1 = {
  schema: "product_pack_v1";
  productName: string;
  oneLiner?: string;
  icp?: string;
  differentiators?: string[];
  proofPoints?: string[];
  integrations?: string[];
  compliance?: string[];
  forbiddenClaims?: string[];
  allowedClaims?: string[];
  languages?: string[];
};

export function productPackDir(): string {
  return process.env.PRODUCT_PACK_DIR?.trim() || "product_packs";
}

export function loadProductPackV1(tenantId: string): ProductPackV1 | null {
  const base = productPackDir();
  const file = path.join(base, tenantId, "product_pack.json");
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || parsed.schema !== "product_pack_v1" || typeof parsed.productName !== "string") return null;
  return parsed as ProductPackV1;
}
