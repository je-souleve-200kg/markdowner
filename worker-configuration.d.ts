// Generated by Wrangler by running `wrangler types`

interface Env {
	MD_CACHE: KVNamespace;
	BROWSER: DurableObjectNamespace<import("./src/index").Browser>;
	MYBROWSER: Fetcher;
}
