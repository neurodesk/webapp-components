// The package version, read from package.json so releases never edit code.
// A JSON import bundles cleanly for the browser and works in Node 22+.
import packageJson from '../package.json' with { type: 'json' };

export const PACKAGE_VERSION = packageJson.version;
