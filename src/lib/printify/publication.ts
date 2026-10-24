/** `visible` alone is true for new drafts in custom API shops. */
export function isPublished(product: { visible: boolean; external?: { id?: string } }): boolean {
  return product.visible === true && Boolean(product.external?.id?.trim());
}
