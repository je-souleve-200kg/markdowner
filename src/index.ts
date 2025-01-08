import puppeteer from '@cloudflare/puppeteer';
import type { Browser as PuppeteerBrowser } from '@cloudflare/puppeteer';
import { urlToMarkdown } from './processor';

const TEN_SECONDS = 10 * 1000;

export default {
	async fetch(request, env): Promise<Response> {
		console.log(env.BACKEND_SECURITY_TOKEN);
		if (!(env.BACKEND_SECURITY_TOKEN === request.headers.get('Authorization'))) {
			return new Response('Unauthorized', { status: 401 });
		}

		const id = env.BROWSER.idFromName('browser');
		const obj = env.BROWSER.get(id);

		try {
			return await obj.fetch(request);
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		} catch (e: any) {
			return new Response(e.message || e.toString(), { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;

const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;

export class Browser {
	state: DurableObjectState;
	env: Env;
	keptAliveInSeconds: number;
	storage: DurableObjectStorage;
	browser: PuppeteerBrowser | undefined;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.keptAliveInSeconds = 0;
		this.storage = this.state.storage;
	}

	async fetch(request: Request) {
		const { searchParams } = new URL(request.url);
		const url = searchParams.get('url');

		if (!(await this.ensureBrowser())) {
			return new Response('Could not start browser instance', { status: 500 });
		}

		if (!url) {
			return new Response('Please add an ?url=https://example.com/ parameter', { status: 400 });
		}

		if (!this.isValidUrl(url)) {
			return new Response('Invalid URL provided, should be a full URL starting with http:// or https://', { status: 400 });
		}

		// Reset keptAlive after each call to the DO
		this.keptAliveInSeconds = 0;

		// // set the first alarm to keep DO alive
		const currentAlarm = await this.storage.getAlarm();
		if (currentAlarm == null) {
			console.log('Browser DO: setting alarm');
			await this.storage.setAlarm(Date.now() + TEN_SECONDS);
		}

		return await this.processSinglePage(url);
	}

	async processSinglePage(url: string): Promise<Response> {
		this.keptAliveInSeconds = 0;

		await this.ensureBrowser();

		if (!this.browser) {
			return new Response('Browser not available', { status: 500 });
		}

		const id = url;
		const cached = await this.env.MD_CACHE.get(id);

		const markdown = cached ?? (await urlToMarkdown(this.browser, url));

		if (!cached) {
			console.log(`Returning cached markdown for ${url}`);
			await this.env.MD_CACHE.put(id, markdown, { expirationTtl: 3600 });
		}

		// Reset keptAlive after performing tasks to the DO.
		this.keptAliveInSeconds = 0;

		return new Response(markdown, {
			headers: { 'content-type': 'text/html;charset=UTF-8' },
		});
	}

	async ensureBrowser() {
		let retries = 3;
		while (retries) {
			if (!this.browser || !this.browser.isConnected()) {
				try {
					this.browser = await puppeteer.launch(this.env.MYBROWSER);
					return true;
				} catch (e) {
					console.error(`Browser DO: Could not start browser instance. Error: ${e}`);
					retries--;
					if (!retries) {
						return false;
					}

					const sessions = await puppeteer.sessions(this.env.MYBROWSER);

					for (const session of sessions) {
						const b = await puppeteer.connect(this.env.MYBROWSER, session.sessionId);
						await b.close();
					}

					console.log(`Retrying to start browser instance. Retries left: ${retries}`);
				}
			} else {
				return true;
			}
		}
	}

	isValidUrl(url: string): boolean {
		return /^(http|https):\/\/[^ "]+$/.test(url);
	}

	async alarm() {
		this.keptAliveInSeconds += 10;

		// Extend browser DO life
		if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
			console.log(`Browser DO: has been kept alive for ${this.keptAliveInSeconds} seconds. Extending lifespan.`);
			await this.storage.setAlarm(Date.now() + TEN_SECONDS);
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
