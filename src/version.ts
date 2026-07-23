// Injected at compile time via `bun build --define BUILD_VERSION='"x.y.z"'`
// (see Dockerfile and scripts/build-binaries.ts); "dev" when running from source.
declare const BUILD_VERSION: string | undefined;

export const VERSION: string = typeof BUILD_VERSION === "string" ? BUILD_VERSION : "dev";
