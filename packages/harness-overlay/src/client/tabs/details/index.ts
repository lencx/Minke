export {
  DETAILS_TAB_KEY,
  DETAILS_TAB_KIND,
} from "./controller.ts";
export type {
  DetailsTabPayload,
} from "./controller.ts";
export {
  installDetailsTabs,
} from "./integration.ts";
export type {
  DetailsTabsIntegrationOptions,
  DetailsTabsLayoutHost,
} from "./integration.ts";
export {
  DSH_DETAILS_STATE_EVENT,
  DSH_DETAILS_STATE_KEY,
  MINKE_DETAILS_PORTAL_EVENT,
  MINKE_DETAILS_PORTAL_SELECTOR,
  parseDshDetailsState,
  readDshDetailsState,
} from "./contract.ts";
export type {
  DshDetailsState,
} from "./contract.ts";
export {
  DETAILS_TAB_STYLES,
  installDetailsTabStyles,
} from "./styles.ts";
