/** Identity of this customized desktop build. */
export const DESKTOP_APP_NAME = "Apex Stock Terminal";
export const LEGACY_DESKTOP_APP_NAME = "Gloomberb";

/** Kept separate from upstream installations. */
export const DESKTOP_APP_IDENTIFIER = "com.apexstockterminal.app";

/** Bundle identifiers recognized as this app. */
export const DESKTOP_APP_IDENTIFIERS: readonly string[] = [DESKTOP_APP_IDENTIFIER];

/** Whether `identifier` is one a build of this app carries. */
export function isDesktopAppIdentifier(identifier: string | null | undefined): boolean {
  return !!identifier && DESKTOP_APP_IDENTIFIERS.includes(identifier);
}
