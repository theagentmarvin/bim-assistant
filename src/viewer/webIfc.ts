// src/viewer/webIfc.ts
//
// Configure the web-ifc WASM path for the IfcImporter (IFC -> fragments
// conversion). Same Cloudflare `%40` workaround as the worker loader:
// unpkg with a literal `@` in the version pin gets mangled.
//
// If you self-host web-ifc, override this URL.

export const WEBIFC_WASM_BASE = "https://unpkg.com/web-ifc%400.0.77/";