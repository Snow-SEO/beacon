import { type SafeFetchInit, safeFetch } from "./safe-fetch.js";

export type FetchLike = (
	url: string | URL,
	init?: SafeFetchInit,
) => Promise<Response>;

let impl: FetchLike = safeFetch;

export function setFetchImplementation(fetchImpl: FetchLike): void {
	impl = fetchImpl;
}

export function resetFetchImplementation(): void {
	impl = safeFetch;
}

export function httpFetch(
	url: string | URL,
	init?: SafeFetchInit,
): Promise<Response> {
	return impl(url, init);
}
