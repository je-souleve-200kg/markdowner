import puppeteer from '@cloudflare/puppeteer';

export default {
	async fetch(request, env): Promise<Response> {
		const { searchParams } = new URL(request.url);
		let url = searchParams.get('url');

		if (url) {
			url = new URL(url).toString(); // normalize
			let title = await env.MD_CACHE.get(url);

			if (title === null) {
				const browser = await puppeteer.launch(env.MYBROWSER);
				const page = await browser.newPage();
				await page.goto(url);
				title = await page.title();
				await env.MD_CACHE.put(url, title, {
					expirationTtl: 60 * 60 * 24,
				});
				await browser.close();
			}

			return new Response(title, {
				headers: { 'content-type': 'text/html;charset=UTF-8' },
			});
		}
		return new Response('Please add an ?url=https://example.com/ parameter');
	},
} satisfies ExportedHandler<Env>;
