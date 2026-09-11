import http from "http";

/**
 * supertest binds a fresh ephemeral port for every server passed to request() unless that
 * server is already listening. Recreating (and never closing) one server per request/test
 * across a suite this size churns through thousands of ephemeral ports in seconds, which can
 * collide under load. This binds one real listening server per describe block up front, and
 * lets each test swap out which app instance handles incoming requests.
 */
export function createReusableServer() {
	let handler: any;
	const server = http.createServer((req, res) => handler(req, res));
	server.listen(0);

	return {
		server,
		setHandler: (h: any): void => {
			handler = h;
		},
		close: (): Promise<void> => new Promise((resolve) => server.close(() => resolve())),
	};
}
