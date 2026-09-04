declare global {
	namespace App {
		// Deliberately empty. There is no server, so there is no `Locals`, no `PageData` shared
		// across a load boundary and no `Error` shape to extend — see `svelte.config.js`.
	}
}

export {};
