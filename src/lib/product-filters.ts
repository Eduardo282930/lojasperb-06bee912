/**
 * Product filtering utilities
 * Ensures system/internal products don't appear in commercial product listings
 */

import {
  isOrderCategoryName,
  isRepairCategoryName,
  isStoreLogoName,
  type CatalogProduct,
} from "./loyverse.functions";

/**
 * Check if a product is a commercial product (for sale)
 * System products like the store logo should be filtered out
 */
export function isCommercialProduct(product: CatalogProduct): boolean {
  // Currently, all products from Loyverse are commercial
  // This function is a guard for future expansion and to prevent
  // accidental exposure of system products in the catalog
  
  // Safety check: filter out if name matches known system products
  if (isStoreLogoName(product.name)) {
    return false;
  }

  // Encomenda e conserto: controle interno no Loyverse, nunca na vitrine.
  if (isOrderCategoryName(product.categoryName) || isRepairCategoryName(product.categoryName)) {
    return false;
  }
  
  
  return true;
}

/**
 * Filter a list of products to only include commercial products
 */
export function filterCommercialProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter(isCommercialProduct);
}
