/**
 * The hosted tool Chat can turn on: `web_fetch`, which voice runs itself
 * for the operator's own requests (spec/openapi.yaml, "Hosted tools"). The
 * model asks for a page by URL; the api fetches it and hands the model its
 * text, and the answer carries each fetch as a step of its own.
 */

/** What Chat reads of the settings (`ToolSettings`) and of a model (`Model`). */
export type ToolSettingsLike = { web_fetch?: { enabled?: boolean } } | undefined;
export type ModelLike = { voice?: { capabilities?: { tools?: boolean } } } | undefined;

/**
 * Whether a chat offers the web fetch toggle: the operator has the tool on
 * (Tools), and a seat that could serve the model carries tool calls
 * (`voice.capabilities.tools`). Unknown (still reading, or unreadable) is
 * not offered.
 */
export function webFetchOffered(settings: ToolSettingsLike, model: ModelLike): boolean {
  if (!settings || settings.web_fetch?.enabled === false) return false;
  return model?.voice?.capabilities?.tools === true;
}

/** The `tools` a request lists for it. */
export const WEB_FETCH_TOOLS = [{ type: 'web_fetch' }];
