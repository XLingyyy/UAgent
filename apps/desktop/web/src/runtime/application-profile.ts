export interface ApplicationProfile {
  readonly isolated: boolean;
  readonly offlineDemo: boolean;
}

const ordinaryProfile: ApplicationProfile = Object.freeze({ isolated: false, offlineDemo: false });
let profile = ordinaryProfile;
let initialized = false;
let initialization: Promise<ApplicationProfile> | undefined;

function nativeHost() {
  return (globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
}

/** Run before importing App or creating application singletons. Native failures
 * reject boot: they never silently select a live transport or a demo profile. */
export function initializeApplicationProfile(): Promise<ApplicationProfile> {
  if (initialization) return initialization;
  initialization = (async () => {
    const host = nativeHost();
    if (host !== undefined) {
      if (!host || typeof host.invoke !== "function") throw Error("application_profile_native_unavailable");
      const value = await host.invoke("get_application_profile");
      if (!value || typeof value !== "object" ||
        !("isolated" in value) || typeof value.isolated !== "boolean" ||
        !("offlineDemo" in value) || typeof value.offlineDemo !== "boolean" ||
        (value.offlineDemo && !value.isolated)) {
        throw Error("application_profile_invalid");
      }
      profile = Object.freeze({ isolated: value.isolated, offlineDemo: value.offlineDemo });
    }
    initialized = true;
    return profile;
  })();
  return initialization;
}

/** This profile is immutable module memory, never a storage/global override. */
export function getApplicationProfile(): ApplicationProfile {
  if (!initialized && nativeHost() !== undefined) throw Error("application_profile_not_initialized");
  return profile;
}
