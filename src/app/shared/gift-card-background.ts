/**
 * The gift card background used when none has been uploaded, or when the configured upload is
 * missing on disk (2026-10). Mirrors GiftCardBackground.DefaultUrl in the API, which already
 * resolves to it server-side; the frontend only needs it if the config request itself fails.
 * Ships in public/images, so it is served from the build like any other site image.
 */
export const GIFT_CARD_DEFAULT_BACKGROUND = '/images/gift-card-bg-20250710163148.webp';
