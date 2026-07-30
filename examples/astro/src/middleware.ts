import { createFetchMiddleware } from "@snowseo/beacon";
import { beacon } from "./beacon";

export const onRequest = createFetchMiddleware(beacon);
