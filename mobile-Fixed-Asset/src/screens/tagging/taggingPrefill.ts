// What a received-stock row hands to the Tag Items form so it opens on that stock.
export interface TaggingPrefill {
  companyId: string;
  projectId: string;
  godownId: string;
  itemId: string;
  numberOfItems: string;
}
