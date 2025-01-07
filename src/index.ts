import puppeteer from '@cloudflare/puppeteer';

export default {
	async fetch(request, env): Promise<Response> {
		const id = env.BROWSER.idFromName('browser');
		const obj = env.BROWSER.get(id);
		const resp = await obj.fetch(request.url);
		return resp;
		// const { searchParams } = new URL(request.url);
		// let url = searchParams.get('url');

		// if (url) {
		// 	url = new URL(url).toString(); // normalize
		// 	let title = await env.MD_CACHE.get(url);

		// 	if (title === null) {
		// 		const browser = await puppeteer.launch(env.MYBROWSER);
		// 		const page = await browser.newPage();
		// 		await page.goto(url);
		// 		title = await page.title();
		// 		await env.MD_CACHE.put(url, title, {
		// 			expirationTtl: 60 * 60 * 24,
		// 		});
		// 		await browser.close();
		// 	}

		// 	return new Response(title, {
		// 		headers: { 'content-type': 'text/html;charset=UTF-8' },
		// 	});
		// }
		// return new Response('Please add an ?url=https://example.com/ parameter');
	},
} satisfies ExportedHandler<Env>;

const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;

export class Browser {
	state: DurableObjectState;
	env: Env;
	keptAliveInSeconds: number;
	storage: DurableObjectStorage;
	browser: puppeteer.Browser | undefined;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.keptAliveInSeconds = 0;
		this.storage = this.state.storage;
	}

	async fetch(request: Request) {
		const { searchParams } = new URL(request.url);
		const url = searchParams.get('url');

		//if there's a browser session open, re-use it
		if (!this.browser || !this.browser.isConnected()) {
			console.log('Browser DO: Starting new instance');
			try {
				this.browser = await puppeteer.launch(this.env.MYBROWSER);
			} catch (e) {
				console.log(`Browser DO: Could not start browser instance. Error: ${e}`);
			}
		}

		// Reset keptAlive after each call to the DO
		this.keptAliveInSeconds = 0;

		const page = await this.browser.newPage();
		await page.goto(url);
		const title = await page.title();

		// Close tab when there is no more work to be done on the page
		await page.close();

		// Reset keptAlive after performing tasks to the DO.
		this.keptAliveInSeconds = 0;

		// set the first alarm to keep DO alive
		const currentAlarm = await this.storage.getAlarm();
		if (currentAlarm == null) {
			console.log('Browser DO: setting alarm');
			const TEN_SECONDS = 10 * 1000;
			await this.storage.setAlarm(Date.now() + TEN_SECONDS);
		}

		return new Response(title, {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	}

	async alarm() {
		this.keptAliveInSeconds += 10;

		// Extend browser DO life
		if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
			console.log(`Browser DO: has been kept alive for ${this.keptAliveInSeconds} seconds. Extending lifespan.`);
			await this.storage.setAlarm(Date.now() + 10 * 1000);
			// You could ensure the ws connection is kept alive by requesting something
			// or just let it close automatically when there  is no work to be done
			// for example, `await this.browser.version()`
		} else {
			console.log(`Browser DO: exceeded life of ${KEEP_BROWSER_ALIVE_IN_SECONDS}s.`);
			if (this.browser) {
				console.log('Closing browser.');
				await this.browser.close();
			}
		}
	}
}
