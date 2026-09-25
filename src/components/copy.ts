/** Shared explanations for the two ways of bringing a sideloaded copy under the catalog. */
export const LINK_EXPLAINED =
  'Link keeps your file as it is and only writes the .fim manifest, so Flipper Lab and the mobile app treat it as a catalog install. Nothing is downloaded.'
export const REPLACE_EXPLAINED =
  'Replace checks your copy first: if it already is the catalog build (same file hash, or the same version for this API), it is only linked. Otherwise it downloads the catalog build for this firmware into apps/<Category>/<alias>.fap and removes your copy (kept in History). Either way the app ends up linked.'
