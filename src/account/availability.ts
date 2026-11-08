declare const __GLOOMBERB_ACCOUNT_UI_ENABLED__: boolean | undefined;

/** Browser builds can offer public research without the provider's account UI. */
export function cloudAccountUiEnabled(): boolean {
  return typeof __GLOOMBERB_ACCOUNT_UI_ENABLED__ === "undefined" || __GLOOMBERB_ACCOUNT_UI_ENABLED__;
}
