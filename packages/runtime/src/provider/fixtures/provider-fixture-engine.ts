import type { ProviderFixtureRouteHandler, ProviderFixtureScenarioOptions, ProviderFixtureWireApi } from "./provider-fixture-types.js";

export interface ProviderFixtureScenario {
  readonly name: string;
  readonly description: string;
  readonly wireApi: ProviderFixtureWireApi;
  handleRequest: ProviderFixtureRouteHandler;
}

export function createProviderFixtureScenario(
  options: ProviderFixtureScenarioOptions,
  handler: ProviderFixtureRouteHandler,
): ProviderFixtureScenario {
  return {
    name: options.name,
    description: options.description,
    wireApi: options.wireApi,
    handleRequest: handler,
  };
}
